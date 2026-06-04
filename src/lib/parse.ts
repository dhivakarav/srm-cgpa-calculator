import type { ExtractedRow, ExtractionResult, GradeKey } from '../types';
import { GRADE_POINTS } from './gpa';
import { nanoid } from 'nanoid';

const VALID_GRADES = new Set(['O', 'A+', 'A', 'B+', 'B', 'C', 'U']);

const GRADE_OCR_MAP: Record<string, string> = {
  '0': 'O', 'o': 'O',
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

// ─── Three pattern strategies, searched globally across the full OCR text ─────

// Strategy 1 — SRM Provisional Result: [credit 0-6] [GRADE] [PASS|FAIL]
// Highest confidence — PASS/FAIL is a strong structural anchor
const PAT_PASS_FAIL = /(^|[\s\n])([0-6])\s+(O|A\+|A|B\+|B|C|U)\s+(PASS|FAIL|P(?=\s)|F(?=\s))/gi;

// Strategy 2 — Internal marksheet: [credit 1-6] [GRADE] [grade_point 0/5-10]
const PAT_WITH_GP = /(^|[\s\n])([1-6])\s+(O|A\+|A|B\+|B|C|U)\s+(10|[05-9])(?=\s|$)/g;

// Strategy 3 — Bare: [credit 1-6] [GRADE] at end of a token group
const PAT_BARE = /(^|[\s\n])([1-6])\s+(O|A\+|A|B\+|B|C|U)(?=\s|$)/g;

export function parseOCRText(rawText: string, wordConfidences: number[]): ExtractionResult {
  const semesterNumber = detectSemester(rawText);
  const registerNumber = detectRegisterNumber(rawText);
  const gpaMatch = rawText.match(/(?:sgpa|gpa)\s*[:\-=]?\s*([0-9]+\.[0-9]+)/i);
  const rawSemesterGPA = gpaMatch ? parseFloat(gpaMatch[1]) : undefined;

  const avgConf = wordConfidences.length
    ? wordConfidences.reduce((a, b) => a + b, 0) / wordConfidences.length
    : 65;

  // Normalize OCR noise before scanning
  const text = rawText
    .replace(/\bA\s+\+/g, 'A+')
    .replace(/\bB\s+\+/g, 'B+');

  let matches: Array<{ credits: number; grade: GradeKey; confidence: number }> = [];

  // Try Strategy 1 first — most reliable for SRM provisional result screenshots
  const s1: typeof matches = [];
  for (const m of text.matchAll(PAT_PASS_FAIL)) {
    const credits = parseInt(m[2], 10);
    const grade = normalizeGrade(m[3]);
    if (!grade || credits === 0) continue; // skip 0-credit audit courses
    s1.push({ credits, grade, confidence: Math.min(100, Math.round(avgConf + 20)) });
  }

  if (s1.length > 0) {
    matches = s1;
  } else {
    // Strategy 2 — internal marksheet with grade points
    const s2: typeof matches = [];
    for (const m of text.matchAll(PAT_WITH_GP)) {
      const credits = parseInt(m[2], 10);
      const grade = normalizeGrade(m[3]);
      const gp = parseInt(m[4], 10);
      if (!grade) continue;
      const expectedGP = grade ? (GRADE_POINTS as Record<string, number>)[grade] : -1;
      s2.push({ credits, grade, confidence: Math.min(100, Math.round(avgConf + (expectedGP === gp ? 15 : 5))) });
    }

    if (s2.length > 0) {
      matches = s2;
    } else {
      // Strategy 3 — bare fallback
      for (const m of text.matchAll(PAT_BARE)) {
        const credits = parseInt(m[2], 10);
        const grade = normalizeGrade(m[3]);
        if (!grade) continue;
        matches.push({ credits, grade, confidence: Math.min(100, Math.round(avgConf - 5)) });
      }
    }
  }

  const rows: ExtractedRow[] = matches.map((m, i) => ({
    id: nanoid(),
    subjectCode: '',
    subjectName: `Subject ${i + 1}`,
    credits: m.credits,
    grade: m.grade,
    confidence: m.confidence,
    isValid: true,
    validationError: undefined,
  }));

  const accuracyPercent = rows.length > 0 ? Math.round(avgConf * 10) / 10 : 0;

  return { rows, semesterNumber, registerNumber, rawSemesterGPA, accuracyPercent, rawText };
}
