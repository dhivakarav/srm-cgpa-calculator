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

// Matches: [credit 1-6]  [GRADE]  [grade_point 0/5-10]
// This triplet is structurally unique to SRM grade rows.
const TRIPLET_RE = /(^|\s)([1-6])\s+(O|A\+|A|B\+|B|C|U)\s+(10|[05-9])(\s|$)/;

export function parseOCRText(rawText: string, wordConfidences: number[]): ExtractionResult {
  const semesterNumber = detectSemester(rawText);
  const registerNumber = detectRegisterNumber(rawText);
  const gpaMatch = rawText.match(/(?:sgpa|gpa)\s*[:\-=]?\s*([0-9]+\.[0-9]+)/i);
  const rawSemesterGPA = gpaMatch ? parseFloat(gpaMatch[1]) : undefined;

  const avgConf = wordConfidences.length
    ? wordConfidences.reduce((a, b) => a + b, 0) / wordConfidences.length
    : 65;

  const rows: ExtractedRow[] = [];
  let subjectIndex = 1;

  const lines = rawText
    .split('\n')
    .map((l) =>
      l
        .replace(/\bA\s+\+/g, 'A+')
        .replace(/\bB\s+\+/g, 'B+')
        .replace(/[|_]+/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim()
    )
    .filter(Boolean);

  for (const line of lines) {
    // Skip headers / footers
    if (/^(sl|s\.no|course|subject|credit|grade|total|sgpa|cgpa|register|result|name|marks|pass|fail|absent)/i.test(line)) continue;
    if (line.length < 4) continue;

    const m = line.match(TRIPLET_RE);
    if (!m) continue;

    const credits = parseInt(m[2], 10);
    const grade = normalizeGrade(m[3]);
    const gradePoint = parseInt(m[4], 10);
    if (!grade) continue;

    // Confidence boost when grade point matches the grade
    const expectedGP = (GRADE_POINTS as Record<string, number>)[grade];
    const gpMatch = expectedGP === gradePoint;
    const confidence = Math.min(100, Math.round(avgConf + (gpMatch ? 15 : 0)));

    rows.push({
      id: nanoid(),
      subjectCode: '',
      subjectName: `Subject ${subjectIndex++}`,
      credits,
      grade,
      confidence,
      isValid: true,
      validationError: undefined,
    });
  }

  const accuracyPercent = rows.length === 0
    ? 0
    : Math.round((rows.length / rows.length) * avgConf * 10) / 10;

  return { rows, semesterNumber, registerNumber, rawSemesterGPA, accuracyPercent, rawText };
}
