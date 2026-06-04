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

const GRADE_PAT = '(O|A\\+|A|B\\+|B|C|U)';

// Pattern 1 — SRM Provisional Result format: [credit 0-6] [GRADE] [PASS|FAIL]
const PAT_PASS_FAIL = new RegExp(`\\b([0-6])\\s+${GRADE_PAT}\\s+(PASS|FAIL|P|F)\\b`, 'i');

// Pattern 2 — SRM internal marksheet format: [credit 1-6] [GRADE] [grade_point 0/5-10]
const PAT_WITH_GP = new RegExp(`\\b([1-6])\\s+${GRADE_PAT}\\s+(10|[05-9])\\b`);

// Pattern 3 — bare fallback: [credit 1-6] [GRADE] at end of line or before spaces
const PAT_BARE = new RegExp(`\\b([1-6])\\s+${GRADE_PAT}(?:\\s|$)`);

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
        .replace(/\bA\s+\+/g, 'A+')   // fix OCR space: "A +" → "A+"
        .replace(/\bB\s+\+/g, 'B+')
        .replace(/[|_]+/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim()
    )
    .filter(Boolean);

  const SKIP_RE = /^(code|description|credit|grade|result|sl|s\.no|course|subject|sgpa|cgpa|register|name|marks|pass|fail|disclaimer|last\s+updated|exam\s+month|semester\s*:|provisional)/i;

  for (const line of lines) {
    if (SKIP_RE.test(line)) continue;
    if (/^[-=*_#\s]+$/.test(line)) continue;
    if (line.length < 3) continue;

    let credits: number | null = null;
    let grade: GradeKey | '' = '';
    let confidence = Math.round(avgConf);

    // Try each pattern in priority order
    const m1 = line.match(PAT_PASS_FAIL);
    if (m1) {
      credits = parseInt(m1[1], 10);
      grade = normalizeGrade(m1[2]);
      confidence = Math.min(100, Math.round(avgConf + 20)); // high confidence — pass/fail confirms it
    } else {
      const m2 = line.match(PAT_WITH_GP);
      if (m2) {
        credits = parseInt(m2[1], 10);
        grade = normalizeGrade(m2[2]);
        const gp = parseInt(m2[3], 10);
        const expectedGP = grade ? (GRADE_POINTS as Record<string, number>)[grade] : -1;
        confidence = Math.min(100, Math.round(avgConf + (expectedGP === gp ? 15 : 5)));
      } else {
        const m3 = line.match(PAT_BARE);
        if (m3) {
          credits = parseInt(m3[1], 10);
          grade = normalizeGrade(m3[2]);
          confidence = Math.min(100, Math.round(avgConf - 5));
        }
      }
    }

    if (credits === null || !grade) continue;

    // Skip 0-credit courses (non-credit audit courses — don't affect GPA)
    if (credits === 0) continue;

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

  const accuracyPercent = rows.length > 0
    ? Math.round(avgConf * 10) / 10
    : 0;

  return { rows, semesterNumber, registerNumber, rawSemesterGPA, accuracyPercent, rawText };
}
