import type { ExtractedRow, ExtractionResult, GradeKey } from '../types';
import { GRADE_POINTS } from './gpa';
import { nanoid } from 'nanoid';

const VALID_GRADES = new Set(['O', 'A+', 'A', 'B+', 'B', 'C', 'U']);

const GRADE_OCR_MAP: Record<string, string> = {
  '0': 'O', 'o': 'O', 'Q': 'O',
  'At': 'A+', 'A-': 'A+', 'a+': 'A+', 'A1': 'A+',
  'Bt': 'B+', 'B-': 'B+', 'b+': 'B+', 'B1': 'B+',
  'a': 'A', 'b': 'B', 'c': 'C', 'u': 'U',
};

function normalizeGrade(raw: string): GradeKey | '' {
  const s = raw.trim().replace(/\s+/g, '');
  if (VALID_GRADES.has(s)) return s as GradeKey;
  const up = s.toUpperCase();
  if (VALID_GRADES.has(up)) return up as GradeKey;
  return (GRADE_OCR_MAP[s] ?? GRADE_OCR_MAP[up] ?? '') as GradeKey;
}

function detectSemester(text: string): number | undefined {
  const m = text.match(/(?:semester|sem)[\s:.\-]*([1-8])|([1-8])(?:st|nd|rd|th)\s*sem/i);
  return m ? parseInt(m[1] ?? m[2]) : undefined;
}

function detectRegisterNumber(text: string): string | undefined {
  const m = text.match(/\b(RA\d{13}|\d{15}|[A-Z]{2}\d{2}[A-Z]{2}\d{4,6})\b/i);
  return m?.[0]?.toUpperCase();
}

const G = '(O|0|Q|A\\+|A|B\\+|B|C|U)';

// Strategy 1 — [credit] [GRADE] PASS/FAIL  (SRM Provisional Result format)
const PAT1 = new RegExp(`(?:^|[\\s\\n])([0-6])\\s+${G}\\s+(PASS|FAIL|P(?=\\s|$)|F(?=\\s|$))`, 'gim');

// Strategy 2 — [credit] [GRADE] [grade_point]  (internal marksheet with GP column)
const PAT2 = new RegExp(`(?:^|[\\s\\n])([1-6])\\s+${G}\\s+(10|[05-9])(?=[\\s\\n]|$)`, 'gm');

// Strategy 3 — [credit] [GRADE] adjacent in text (same line or only whitespace between)
const PAT3 = new RegExp(`(?:^|[\\s\\n])([1-6])\\s+${G}(?=[\\s\\n,.|\\-]|$)`, 'gm');

// Strategy 4 — Standalone grade check for a line (credit may be absent on same line)
const GRADE_IN_LINE = new RegExp(`(?:^|\\s)${G}(?=\\s|$)`, 'i');

// Line ending with a credit and nothing after (grade must be on next line)
const CREDIT_LINE_END = /(?:^|\s)([1-6])\s*$/;

const SKIP_RE = /^(code|description|credit|grade|result|sl|s\.no|course|subject|sgpa|cgpa|register|name|marks|pass|fail|disclaimer|last\s+updated|exam|semester\s*:|provisional)/i;

type Hit = { credits: number; grade: GradeKey; confidence: number };

export function parseOCRText(rawText: string, wordConfidences: number[]): ExtractionResult {
  const semesterNumber = detectSemester(rawText);
  const registerNumber = detectRegisterNumber(rawText);
  const gpaMatch = rawText.match(/(?:sgpa|gpa)\s*[:\-=]?\s*([0-9]+\.[0-9]+)/i);
  const rawSemesterGPA = gpaMatch ? parseFloat(gpaMatch[1]) : undefined;

  const avgConf = wordConfidences.length
    ? wordConfidences.reduce((a, b) => a + b, 0) / wordConfidences.length
    : 65;

  const text = rawText
    .replace(/\bA\s+\+/g, 'A+')
    .replace(/\bB\s+\+/g, 'B+');

  let hits: Hit[] = [];

  // ── Strategy 1: PASS/FAIL anchor ───────────────────────────────────────────
  for (const m of text.matchAll(PAT1)) {
    const credits = parseInt(m[1], 10);
    const grade = normalizeGrade(m[2]);
    if (!grade || credits === 0) continue;
    hits.push({ credits, grade, confidence: Math.min(100, Math.round(avgConf + 20)) });
  }
  if (hits.length > 0) return buildResult(hits, { semesterNumber, registerNumber, rawSemesterGPA, rawText, avgConf });

  // ── Strategy 2: grade-point anchor ─────────────────────────────────────────
  for (const m of text.matchAll(PAT2)) {
    const credits = parseInt(m[1], 10);
    const grade = normalizeGrade(m[2]);
    const gp = parseInt(m[3], 10);
    if (!grade) continue;
    const expected = (GRADE_POINTS as Record<string, number>)[grade] ?? -1;
    hits.push({ credits, grade, confidence: Math.min(100, Math.round(avgConf + (expected === gp ? 15 : 5))) });
  }
  if (hits.length > 0) return buildResult(hits, { semesterNumber, registerNumber, rawSemesterGPA, rawText, avgConf });

  // ── Strategies 3 + 4 combined: bare credit+grade ────────────────────────────
  // Strategy 3: credit and grade appear close together (same line or adjacent whitespace)
  for (const m of text.matchAll(PAT3)) {
    const credits = parseInt(m[1], 10);
    const grade = normalizeGrade(m[2]);
    if (!grade) continue;
    hits.push({ credits, grade, confidence: Math.min(100, Math.round(avgConf - 5)) });
  }

  // Strategy 4: credit at end of line, grade anywhere in the next 1-2 lines
  // Handles OCR splits like: "ENGINEERING GRAPHICS AND 2\nDESIGN O"
  const lines = text.split('\n').map(l => l.trim());
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || SKIP_RE.test(line)) continue;

    // Must end with a standalone credit digit
    const creditEnd = line.match(CREDIT_LINE_END);
    if (!creditEnd) continue;

    // Must NOT already have a grade on this same line (Strategy 3 handles that)
    if (GRADE_IN_LINE.test(line)) continue;

    const credits = parseInt(creditEnd[1], 10);
    if (credits === 0) continue;

    // Look for a grade in the next 1-2 lines
    for (let j = i + 1; j <= Math.min(i + 2, lines.length - 1); j++) {
      const nextLine = lines[j];
      if (!nextLine) continue;
      const gradeMatch = nextLine.match(GRADE_IN_LINE);
      if (gradeMatch) {
        const grade = normalizeGrade(gradeMatch[1]);
        if (!grade) continue;

        // If the grade is the FIRST token on the next line, PAT3 already matched
        // it via \s+ spanning the newline — skip to avoid duplicate
        const firstToken = nextLine.split(/\s+/).find(Boolean) ?? '';
        if (normalizeGrade(firstToken)) break;

        hits.push({ credits, grade, confidence: Math.min(100, Math.round(avgConf - 10)) });
        break;
      }
    }
  }

  // Filter out 0-credit audit courses
  hits = hits.filter(h => h.credits > 0);

  return buildResult(hits, { semesterNumber, registerNumber, rawSemesterGPA, rawText, avgConf });
}

function buildResult(
  hits: Hit[],
  meta: { semesterNumber?: number; registerNumber?: string; rawSemesterGPA?: number; rawText: string; avgConf: number }
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
