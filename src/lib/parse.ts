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
      .toUpperCase()
      .replace(/\bA\s+\+/g, 'A+')
      .replace(/\bB\s+\+/g, 'B+')
      // Tabs and pipes → space
      .replace(/[\t|_]/g, ' ')
      // Collapse multiple spaces on a line (but keep newlines)
      .replace(/[^\S\n]+/g, ' ')
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

  // ── Pass 1b: cross-line — credit on one line, grade on a following line ──────
  // Handles two sub-cases:
  //   A) Description line ending with credit: "ENGINEERING GRAPHICS AND 2\nDESIGN O"
  //   B) Bare credit line preceded by description (not a credit block):
  //      e.g. "ADVANCED CALCULUS AND COMPLEX ANALYSIS\n4\nB"
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || SKIP_HEADER_RE.test(line)) continue;

    const lineTokens = line.split(/\s+/).filter(Boolean);
    const lastTok = lineTokens[lineTokens.length - 1] ?? '';

    // Line must end with a bare credit digit
    if (!/^[1-6]$/.test(lastTok)) continue;

    // Line must have no grade (Pass 1 already handles same-line pairs)
    if (lineTokens.some((t) => tokenToGrade(t) !== null)) continue;

    // For bare credit-only lines (single token), check whether we are inside a
    // credits-column block by looking at the previous non-empty line.
    // If the previous non-empty line is also a bare credit digit → block → skip.
    if (lineTokens.length === 1) {
      let prevNonEmpty = '';
      for (let pi = i - 1; pi >= 0; pi--) {
        const pl = lines[pi].trim();
        if (pl) { prevNonEmpty = pl; break; }
      }
      if (/^[1-6]$/.test(prevNonEmpty)) continue; // inside credit-column block → Pass 4
    }

    const credits = parseInt(lastTok, 10);
    // Description lines look ahead up to 4; bare-credit lines up to 2
    const maxAhead = lineTokens.length >= 2 ? 4 : 2;

    for (let j = i + 1; j <= Math.min(i + maxAhead, lines.length - 1); j++) {
      const nextLine = lines[j].trim();
      if (!nextLine) continue;
      // Stop if we hit another bare credit line (entered credit block territory)
      if (/^[1-6]$/.test(nextLine)) break;

      const nextTokens = nextLine.split(/\s+/).filter(Boolean);
      let foundGrade = false;
      for (let k = 0; k < nextTokens.length; k++) {
        const grade = tokenToGrade(nextTokens[k]);
        if (!grade) continue;
        if (k > 0 && /^[1-6]$/.test(nextTokens[k - 1])) continue;
        hits.push({ credits, grade, confidence: 65, sourceLine: line });
        console.log(`[Parse] Matched (split-line): credit=${credits} grade=${grade} across: '${line}' → '${nextLine}'`);
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

  // ── Pass 4: column-order pairing ────────────────────────────────────────────
  // Detects column-by-column OCR output (credits block + grades block separate).
  // Heuristic: 3+ consecutive bare credit-digit lines → column layout detected.
  // In that case, ignore any Pass-1b hits and re-pair all credits with all grades.
  const hasCreditsBlock = lines.some(
    (_, i) =>
      i + 2 < lines.length &&
      /^[1-6]$/.test(lines[i].trim()) &&
      /^[1-6]$/.test(lines[i + 1].trim()) &&
      /^[1-6]$/.test(lines[i + 2].trim())
  );
  if (hits.length === 0 || hasCreditsBlock) {
    if (hasCreditsBlock) hits.length = 0; // discard wrong Pass-1b pairings
    const allCredits: number[] = [];
    const allGrades: GradeKey[] = [];
    for (const tok of text.split(/\s+/)) {
      if (/^[1-6]$/.test(tok)) allCredits.push(parseInt(tok, 10));
      const g = tokenToGrade(tok);
      if (g) allGrades.push(g);
    }
    const pairCount = Math.min(allCredits.length, allGrades.length);
    if (pairCount > 0 && pairCount <= 20) {
      console.log(`[Parse] Pass 4 (column pairing): ${allCredits.length} credits, ${allGrades.length} grades → ${pairCount} pairs`);
      for (let pi = 0; pi < pairCount; pi++) {
        hits.push({
          credits: allCredits[pi],
          grade: allGrades[pi],
          confidence: 50,
          sourceLine: `col-pair-${pi}`,
        });
        console.log(`[Parse] Matched (col-pair): credit=${allCredits[pi]} grade=${allGrades[pi]}`);
      }
    }
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
