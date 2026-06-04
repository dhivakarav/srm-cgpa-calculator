import type { ExtractedRow, ExtractionResult, GradeKey } from '../types';
import { GRADE_POINTS } from './gpa';
import { nanoid } from 'nanoid';

const VALID_GRADES = new Set(['O', 'A+', 'A', 'B+', 'B', 'C', 'U']);

const GRADE_OCR_MAP: Record<string, string> = {
  // O misreads (very common on light backgrounds)
  '0': 'O', 'o': 'O', 'Q': 'O', 'D': 'O',
  // A+ misreads
  'At': 'A+', 'A-': 'A+', 'a+': 'A+', 'A1': 'A+',
  // B+ misreads
  'Bt': 'B+', 'B-': 'B+', 'b+': 'B+', 'B1': 'B+',
  // lowercase
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

// ─── Grade token pattern ─────────────────────────────────────────────────────
// Include OCR variants: 0→O, Q→O, common misreads
const G = '(O|0|Q|A\\+|A|B\\+|B|C|U)';

// ─── Patterns searched globally across the full OCR text ─────────────────────

// Strategy 1 — [credit 0-6] [GRADE] [PASS|FAIL]  (SRM Provisional Result)
const PAT1 = new RegExp(`(?:^|[\\s\\n])([0-6])\\s+${G}\\s+(PASS|FAIL|P(?=\\s|$)|F(?=\\s|$))`, 'gim');

// Strategy 2 — [credit 1-6] [GRADE] [grade_point]  (internal marksheet with GP column)
const PAT2 = new RegExp(`(?:^|[\\s\\n])([1-6])\\s+${G}\\s+(10|[05-9])(?=[\\s\\n]|$)`, 'gm');

// Strategy 3 — [credit 1-6] [GRADE]  (bare — no trailing column)
// Lookahead allows: whitespace, newline, end of string, or non-alphanumeric (table border chars)
const PAT3 = new RegExp(`(?:^|[\\s\\n])([1-6])\\s+${G}(?=[\\s\\n,.|\\-]|$)`, 'gm');

export function parseOCRText(rawText: string, wordConfidences: number[]): ExtractionResult {
  const semesterNumber = detectSemester(rawText);
  const registerNumber = detectRegisterNumber(rawText);
  const gpaMatch = rawText.match(/(?:sgpa|gpa)\s*[:\-=]?\s*([0-9]+\.[0-9]+)/i);
  const rawSemesterGPA = gpaMatch ? parseFloat(gpaMatch[1]) : undefined;

  const avgConf = wordConfidences.length
    ? wordConfidences.reduce((a, b) => a + b, 0) / wordConfidences.length
    : 65;

  // Normalize common OCR noise before matching
  const text = rawText
    .replace(/\bA\s+\+/g, 'A+')
    .replace(/\bB\s+\+/g, 'B+');

  type Hit = { credits: number; grade: GradeKey; confidence: number };
  let hits: Hit[] = [];

  // Strategy 1 — PASS/FAIL anchor (most reliable)
  for (const m of text.matchAll(PAT1)) {
    const credits = parseInt(m[1], 10);
    const grade = normalizeGrade(m[2]);
    if (!grade || credits === 0) continue;
    hits.push({ credits, grade, confidence: Math.min(100, Math.round(avgConf + 20)) });
  }

  // Strategy 2 — grade_point anchor
  if (hits.length === 0) {
    for (const m of text.matchAll(PAT2)) {
      const credits = parseInt(m[1], 10);
      const grade = normalizeGrade(m[2]);
      const gp = parseInt(m[3], 10);
      if (!grade) continue;
      const expected = grade ? (GRADE_POINTS as Record<string, number>)[grade] : -1;
      hits.push({ credits, grade, confidence: Math.min(100, Math.round(avgConf + (expected === gp ? 15 : 5))) });
    }
  }

  // Strategy 3 — bare credit+grade (no trailing column)
  if (hits.length === 0) {
    for (const m of text.matchAll(PAT3)) {
      const credits = parseInt(m[1], 10);
      const grade = normalizeGrade(m[2]);
      if (!grade) continue;
      hits.push({ credits, grade, confidence: Math.min(100, Math.round(avgConf - 5)) });
    }
  }

  // Skip 0-credit audit courses (don't count toward GPA)
  hits = hits.filter((h) => h.credits > 0);

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

  const accuracyPercent = rows.length > 0 ? Math.round(avgConf * 10) / 10 : 0;

  return { rows, semesterNumber, registerNumber, rawSemesterGPA, accuracyPercent, rawText };
}
