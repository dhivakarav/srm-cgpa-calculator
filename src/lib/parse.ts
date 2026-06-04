import type { ExtractedRow, ExtractionResult, GradeKey } from '../types';
import { GRADE_POINTS } from './gpa';
import { nanoid } from 'nanoid';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_GRADES = new Set<string>(['O', 'A+', 'A', 'B+', 'B', 'C', 'U']);

// Headers to skip — lines that begin with these tokens are not data rows
const SKIP_HEADER_RE =
  /^(CODE|DESCRIPTION|CREDIT|GRADE|RESULT|SL|S\.NO|COURSE|SUBJECT|SGPA|CGPA|SEMESTER|REGISTER|NAME|MARKS|PASS|FAIL|DISCLAIMER|LAST|EXAM|PROVISIONAL)/i;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Hit = {
  credits: number;
  grade: GradeKey;
  confidence: number;
  sourceLine: string;
};

// ---------------------------------------------------------------------------
// Text normalisation helpers
// ---------------------------------------------------------------------------

function preprocessText(raw: string): string {
  return (
    raw
      // Uppercase everything
      .toUpperCase()
      // Fix split grades that OCR breaks with a space
      .replace(/\bA\s+\+/g, 'A+')
      .replace(/\bB\s+\+/g, 'B+')
      // Strip pipe/underscore chars
      .replace(/[|_]/g, ' ')
  );
}

/**
 * Normalise a single token to a GradeKey.
 * After uppercasing the whole text, a standalone "0" digit is really the
 * grade "O" (SRM uses O for Outstanding).
 */
function tokenToGrade(token: string): GradeKey | null {
  const t = token.trim();
  // After full uppercase, check direct match first
  if (VALID_GRADES.has(t)) return t as GradeKey;
  // Standalone digit-zero → 'O' grade
  if (t === '0') return 'O';
  return null;
}

// ---------------------------------------------------------------------------
// Metadata helpers
// ---------------------------------------------------------------------------

function detectSemester(text: string): number | undefined {
  const m = text.match(/(?:semester|sem)[\s:.\-]*([1-8])|([1-8])(?:st|nd|rd|th)\s*sem/i);
  return m ? parseInt(m[1] ?? m[2], 10) : undefined;
}

function detectRegisterNumber(text: string): string | undefined {
  const m = text.match(/\b(RA\d{13}|\d{15}|[A-Z]{2}\d{2}[A-Z]{2}\d{4,6})\b/i);
  return m?.[0]?.toUpperCase();
}

// ---------------------------------------------------------------------------
// Main parser
// ---------------------------------------------------------------------------

export function parseOCRText(rawText: string, wordConfidences: number[]): ExtractionResult {
  const semesterNumber = detectSemester(rawText);
  const registerNumber = detectRegisterNumber(rawText);
  const gpaMatch = rawText.match(/(?:sgpa|gpa)\s*[:\-=]?\s*([0-9]+\.[0-9]+)/i);
  const rawSemesterGPA = gpaMatch ? parseFloat(gpaMatch[1]) : undefined;

  const avgConf = wordConfidences.length
    ? wordConfidences.reduce((a, b) => a + b, 0) / wordConfidences.length
    : 65;

  const text = preprocessText(rawText);
  const lines = text.split('\n');

  console.log(`[Parse] Lines scanned: ${lines.length}`);

  const hits: Hit[] = [];

  // ── Pass 1: line-by-line token scan ─────────────────────────────────────
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (SKIP_HEADER_RE.test(line)) continue;

    const tokens = line.split(/\s+/).filter(Boolean);

    // Find all positions of grade tokens in this line
    for (let gi = 0; gi < tokens.length; gi++) {
      const grade = tokenToGrade(tokens[gi]);
      if (!grade) continue;

      // Look for nearest credit token within 3 positions BEFORE this grade
      for (let di = 1; di <= 3; di++) {
        const ci = gi - di;
        if (ci < 0) break;
        const creditVal = parseInt(tokens[ci], 10);
        if (!isNaN(creditVal) && creditVal >= 1 && creditVal <= 6) {
          // Make sure the credit token is actually a pure integer (not part of a code like RA21)
          if (/^[1-6]$/.test(tokens[ci])) {
            hits.push({
              credits: creditVal,
              grade,
              confidence: 80,
              sourceLine: line,
            });
            console.log(
              `[Parse] Matched: credit=${creditVal} grade=${grade} on line: '${line}'`
            );
            // Keep scanning — there may be multiple credit+grade pairs on this line
            break;
          }
        }
      }
    }
  }

  // ── Pass 1b: cross-line — credit at end of line N, grade on line N+1/N+2 ──
  // Handles OCR splits like: "ENGINEERING GRAPHICS AND 2\nDESIGN O"
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || SKIP_HEADER_RE.test(line)) continue;

    // Line must end with a bare single-digit credit (1-6)
    const creditEnd = line.match(/(?:^|\s)([1-6])\s*$/);
    if (!creditEnd) continue;

    // Line must have no grade token (Pass 1 already handles same-line pairs)
    const lineTokens = line.split(/\s+/).filter(Boolean);
    if (lineTokens.some((t) => tokenToGrade(t) !== null)) continue;

    const credits = parseInt(creditEnd[1], 10);

    // Search up to 2 lines ahead for a grade
    for (let j = i + 1; j <= Math.min(i + 2, lines.length - 1); j++) {
      const nextLine = lines[j].trim();
      if (!nextLine) continue;

      const nextTokens = nextLine.split(/\s+/).filter(Boolean);
      let foundGrade = false;
      for (let k = 0; k < nextTokens.length; k++) {
        const grade = tokenToGrade(nextTokens[k]);
        if (!grade) continue;

        // Skip if the token immediately before grade on the SAME next-line is a credit —
        // that means Pass 1 already handles it from the next line itself
        if (k > 0 && /^[1-6]$/.test(nextTokens[k - 1])) continue;

        const srcKey = `${line} / ${nextLine}`;
        hits.push({ credits, grade, confidence: 65, sourceLine: srcKey });
        console.log(`[Parse] Matched (split-line): credit=${credits} grade=${grade} across: '${srcKey}'`);
        foundGrade = true;
        break;
      }
      if (foundGrade) break;
    }
  }

  // ── Pass 2: full-text regex — PASS/FAIL anchor ──────────────────────────
  // Pattern: <credit> <grade> PASS|FAIL
  const PAT_PASSFAIL = /\b([1-6])\s+(O|A\+|A|B\+|B|C|U)\s+(?:PASS|FAIL)\b/g;
  for (const m of text.matchAll(PAT_PASSFAIL)) {
    const credits = parseInt(m[1], 10);
    const grade = m[2] as GradeKey;
    // Find the source line for logging
    const matchPos = m.index ?? 0;
    const beforeMatch = text.slice(0, matchPos);
    const lineIdx = beforeMatch.split('\n').length - 1;
    const sourceLine = lines[lineIdx]?.trim() ?? '';

    hits.push({ credits, grade, confidence: 95, sourceLine });
    console.log(`[Parse] Matched (PASS/FAIL): credit=${credits} grade=${grade} on line: '${sourceLine}'`);
  }

  // ── Pass 3: full-text regex — grade-point anchor ─────────────────────────
  // Pattern: <credit> <grade> <grade_point_number>
  const PAT_GP = /\b([1-6])\s+(O|A\+|A|B\+|B|C|U)\s+(?:10|[05-9])\b/g;
  for (const m of text.matchAll(PAT_GP)) {
    const credits = parseInt(m[1], 10);
    const grade = m[2] as GradeKey;
    const gpStr = m[0].split(/\s+/).pop() ?? '';
    const gp = parseInt(gpStr, 10);
    const expectedGP = (GRADE_POINTS as Record<string, number>)[grade] ?? -1;

    const matchPos = m.index ?? 0;
    const beforeMatch = text.slice(0, matchPos);
    const lineIdx = beforeMatch.split('\n').length - 1;
    const sourceLine = lines[lineIdx]?.trim() ?? '';

    hits.push({
      credits,
      grade,
      confidence: expectedGP === gp ? 90 : 70,
      sourceLine,
    });
    console.log(`[Parse] Matched (GP): credit=${credits} grade=${grade} gp=${gp} on line: '${sourceLine}'`);
  }

  // ── Deduplicate & pick highest confidence per (credits, grade, sourceLine) ─
  // We use a key of credits+grade+sourceLine to avoid double-counting across passes
  const seen = new Map<string, Hit>();
  for (const h of hits) {
    const key = `${h.credits}|${h.grade}|${h.sourceLine}`;
    const existing = seen.get(key);
    if (!existing || h.confidence > existing.confidence) {
      seen.set(key, h);
    }
  }

  const deduped = Array.from(seen.values()).filter((h) => h.credits > 0);

  console.log(`[Parse] Lines scanned: ${lines.length}, rows matched: ${deduped.length}`);
  deduped.forEach((h, i) => {
    console.log(`[Parse] Row ${i + 1}: credits=${h.credits} grade=${h.grade} conf=${h.confidence} from line: '${h.sourceLine}'`);
  });

  return buildResult(deduped, { semesterNumber, registerNumber, rawSemesterGPA, rawText, avgConf });
}

// ---------------------------------------------------------------------------
// Build the ExtractionResult
// ---------------------------------------------------------------------------

function buildResult(
  hits: Hit[],
  meta: {
    semesterNumber?: number;
    registerNumber?: string;
    rawSemesterGPA?: number;
    rawText: string;
    avgConf: number;
  }
): ExtractionResult {
  const rows: ExtractedRow[] = hits.map((h, i) => ({
    id: nanoid(),
    subjectCode: '',
    subjectName: `Subject ${i + 1}`,
    credits: h.credits,
    grade: h.grade,
    confidence: h.confidence,
    isValid: true,
    validationError: undefined,
  }));

  const accuracyPercent = rows.length > 0 ? Math.round(meta.avgConf * 10) / 10 : 0;

  return {
    rows,
    semesterNumber: meta.semesterNumber,
    registerNumber: meta.registerNumber,
    rawSemesterGPA: meta.rawSemesterGPA,
    accuracyPercent,
    rawText: meta.rawText,
  };
}
