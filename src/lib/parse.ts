import type { ExtractedRow, ExtractionResult, GradeKey } from '../types';
import { GRADE_POINTS } from './gpa';
import { nanoid } from 'nanoid';

// ─── Grade normalization ──────────────────────────────────────────────────────

const VALID_GRADES = new Set<string>(['O', 'A+', 'A', 'B+', 'B', 'C', 'U']);

const GRADE_OCR_MAP: Record<string, string> = {
  // O misreads
  '0': 'O', 'o': 'O', 'O0': 'O', 'OO': 'O',
  // A+ misreads
  'At': 'A+', 'A-': 'A+', 'a+': 'A+', 'A1': 'A+', 'A+1': 'A+', 'At+': 'A+', 'A¥': 'A+',
  // B+ misreads
  'Bt': 'B+', 'B-': 'B+', 'b+': 'B+', 'B1': 'B+', 'B+1': 'B+',
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

// ─── Subject code detection ───────────────────────────────────────────────────
// SRM codes: 21CSC101J, 21MAT201T, BCSE101L, CSE3001, 18PHY201T, etc.
const SUBJECT_CODE_RE = /\b(\d{0,2}[A-Z]{2,5}\d{3,5}[A-Z]?)\b/i;

function extractSubjectCode(text: string): string {
  const m = text.match(SUBJECT_CODE_RE);
  return m ? m[1].toUpperCase() : '';
}

// ─── Metadata extraction ──────────────────────────────────────────────────────

function detectSemester(text: string): number | undefined {
  const m = text.match(/(?:semester|sem)[\s:.\-]*([1-8])|([1-8])(?:st|nd|rd|th)\s*sem/i);
  return m ? parseInt(m[1] ?? m[2]) : undefined;
}

function detectRegisterNumber(text: string): string | undefined {
  const m = text.match(/\b(RA\d{13}|\d{15}|[A-Z]{2}\d{2}[A-Z]{2}\d{4,6})\b/i);
  return m?.[0]?.toUpperCase();
}

// ─── Preprocessing ────────────────────────────────────────────────────────────

function preprocessLine(line: string): string {
  return line
    // Fix OCR spaces inside grade tokens: "A +" → "A+", "B +" → "B+"
    .replace(/\bA\s+\+/g, 'A+')
    .replace(/\bB\s+\+/g, 'B+')
    // Normalize pipe/underscore separators to spaces
    .replace(/[|_]+/g, ' ')
    // Collapse multiple spaces
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ─── Header / noise skip ──────────────────────────────────────────────────────

const SKIP_RE = /^(sl\.?\s*no|s\.?\s*no|course\s*code|course\s*title|credits?|grade|total|result|sgpa|cgpa|register|name|regno|marks|attendance|out\s+of|earned|status|pass|fail|absent|academic|semester\s+grade|sl\s+no)/i;

// ─── Core triplet pattern ─────────────────────────────────────────────────────
// Matches: <credit 1-6>  <GRADE>  <grade_point 0/5-10>
// This sequence is structurally unique to SRM grade rows.
// Allow optional separators (spaces, dots, colons) between fields.
const GRADE_VALUES = '(?:O|A\\+|A|B\\+|B|C|U)';
const GP_VALUES = '(?:10|[05-9])';
// e.g. "4 A+ 9" or "3 O 10" or "4 A+9" or "3O10"
const TRIPLET_RE = new RegExp(
  `\\b([1-6])\\s+(?:${GRADE_VALUES.slice(4, -1).replace(/\\/g, '\\')})`,
  'g'
);

// More explicit: [credit] [space] [grade] [space] [gradepoint]
const TRIPLET_FULL_RE = new RegExp(
  `([1-6])\\s+(${GRADE_VALUES})\\s+(${GP_VALUES})\\b`
);

// ─── Main parser ──────────────────────────────────────────────────────────────

export function parseOCRText(rawText: string, wordConfidences: number[]): ExtractionResult {
  const semesterNumber = detectSemester(rawText);
  const registerNumber = detectRegisterNumber(rawText);
  const gpaMatch = rawText.match(/(?:sgpa|gpa)\s*[:\-=]?\s*([0-9]+\.[0-9]+)/i);
  const rawSemesterGPA = gpaMatch ? parseFloat(gpaMatch[1]) : undefined;

  const avgConf = wordConfidences.length
    ? wordConfidences.reduce((a, b) => a + b, 0) / wordConfidences.length
    : 65;

  const rows: ExtractedRow[] = [];
  const lines = rawText.split('\n').map((l) => preprocessLine(l)).filter(Boolean);

  for (const raw of lines) {
    if (SKIP_RE.test(raw)) continue;
    if (/^[-=*_#\s]+$/.test(raw)) continue;
    if (raw.length < 4) continue;

    // ── Strategy 1: full triplet [credit] [grade] [gradepoint] ──────────────
    const triplet = raw.match(TRIPLET_FULL_RE);
    if (triplet) {
      const credits = parseInt(triplet[1], 10);
      const grade = normalizeGrade(triplet[2]);
      const gradePoint = parseInt(triplet[3], 10);
      if (!grade) continue;

      // Verify grade point matches expected value (extra confidence check)
      const expectedGP = grade ? (GRADE_POINTS as Record<string, number>)[grade] : -1;
      const gpMatch = expectedGP === gradePoint;

      // Everything before the triplet is serial + code + name
      const before = raw.slice(0, triplet.index ?? 0).trim();
      const subjectCode = extractSubjectCode(before);

      // Remove serial number (leading digits) and subject code from name
      let subjectName = before
        .replace(new RegExp(`\\b${subjectCode}\\b`, 'i'), '')
        .replace(/^\d+\s*/, '')   // strip leading serial
        .replace(/\s+/g, ' ')
        .trim();
      if (!subjectName) subjectName = subjectCode || `Subject ${rows.length + 1}`;

      rows.push({
        id: nanoid(),
        subjectCode,
        subjectName,
        credits,
        grade,
        confidence: Math.min(100, Math.round(avgConf + (gpMatch ? 15 : 5))),
        isValid: true,
        validationError: undefined,
      });
      continue;
    }

    // ── Strategy 2: [credit] [grade] without confirmed grade_point ──────────
    // Looser: just find credit immediately before a grade token
    const tokens = raw.split(/\s+/).filter(Boolean);
    if (tokens.length < 3) continue;

    for (let i = 1; i < tokens.length; i++) {
      const grade = normalizeGrade(tokens[i]);
      if (!grade) continue;

      // Credit must be the token immediately before the grade (or 1 before that)
      const creditToken = isCredit(tokens[i - 1])
        ? tokens[i - 1]
        : i >= 2 && isCredit(tokens[i - 2])
        ? tokens[i - 2]
        : null;

      if (!creditToken) continue;

      const credits = parseInt(creditToken, 10);
      const creditIdx = tokens.lastIndexOf(creditToken, i - 1);

      // Subject code anywhere in the tokens before credit
      const beforeCredit = tokens.slice(0, creditIdx).join(' ');
      const subjectCode = extractSubjectCode(beforeCredit);

      // Subject name: between code and credit, strip leading serial
      let subjectName = beforeCredit
        .replace(new RegExp(`\\b${subjectCode}\\b`, 'i'), '')
        .replace(/^\d+\s*/, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (!subjectName) subjectName = subjectCode || `Subject ${rows.length + 1}`;

      rows.push({
        id: nanoid(),
        subjectCode,
        subjectName,
        credits,
        grade,
        confidence: Math.min(100, Math.round(avgConf - 5)),
        isValid: true,
        validationError: undefined,
      });
      break; // one row per line
    }
  }

  // Deduplicate by subject code (keep first occurrence)
  const seen = new Set<string>();
  const deduped = rows.filter((r) => {
    if (!r.subjectCode) return true;
    if (seen.has(r.subjectCode)) return false;
    seen.add(r.subjectCode);
    return true;
  });

  const validRows = deduped.filter((r) => r.isValid);
  const accuracyPercent = deduped.length === 0
    ? 0
    : Math.round((validRows.length / deduped.length) * avgConf * 10) / 10;

  return { rows: deduped, semesterNumber, registerNumber, rawSemesterGPA, accuracyPercent, rawText };
}

function isCredit(s: string): boolean {
  return /^[1-6]$/.test(s);
}
