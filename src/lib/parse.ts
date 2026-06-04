import type { ExtractedRow, ExtractionResult, GradeKey } from '../types';
import { nanoid } from 'nanoid';

const VALID_GRADES = new Set<string>(['O', 'A+', 'A', 'B+', 'B', 'C', 'U']);

// Map common OCR misreads → valid grade
const GRADE_OCR_MAP: Record<string, GradeKey> = {
  // O misreads
  '0': 'O', 'o': 'O', 'O0': 'O', 'OO': 'O', '()': 'O',
  // A+ misreads
  'At': 'A+', 'A-': 'A+', 'a+': 'A+', 'A1': 'A+', 'A+1': 'A+',
  'At+': 'A+', 'A¥': 'A+', 'A%': 'A+',
  // B+ misreads
  'Bt': 'B+', 'B-': 'B+', 'b+': 'B+', 'B1': 'B+', 'B+1': 'B+',
  // lowercase variants
  'a': 'A', 'b': 'B', 'c': 'C', 'u': 'U',
};

function normalizeGrade(raw: string): GradeKey | '' {
  const s = raw.trim().replace(/\s+/g, '');
  if (VALID_GRADES.has(s)) return s as GradeKey;
  const upper = s.toUpperCase();
  if (VALID_GRADES.has(upper)) return upper as GradeKey;
  return (GRADE_OCR_MAP[s] ?? GRADE_OCR_MAP[upper]) ?? '';
}

function normalizeCredits(raw: string): number | '' {
  const cleaned = raw.replace(/[^\d]/g, '');
  const n = parseInt(cleaned, 10);
  if (isNaN(n) || n < 1 || n > 6) return '';
  return n;
}

function detectSemester(text: string): number | undefined {
  const m = text.match(/(?:semester|sem)[\s:.\-]*([1-8])|([1-8])(?:st|nd|rd|th)\s*sem/i);
  return m ? parseInt(m[1] ?? m[2]) : undefined;
}

function detectRegisterNumber(text: string): string | undefined {
  const m = text.match(/\b(RA\d{13}|\d{15}|[A-Z]{2}\d{2}[A-Z]{2}\d{4,6})\b/i);
  return m?.[0]?.toUpperCase();
}

// Is this token a subject code? (e.g. 21CSC101J, 18MAT201T, BCSE101)
function isSubjectCode(s: string): boolean {
  return /^[A-Z0-9]{2,4}\d{3,5}[A-Z]?$/.test(s.toUpperCase());
}

// Is this token a grade point (0,5,6,7,8,9,10)?
function isGradePoint(s: string): boolean {
  return /^(10|[056789])$/.test(s);
}

// Is this token a credit value (1-6)?
function isCredit(s: string): boolean {
  return /^[1-6]$/.test(s);
}

// Header / noise line patterns to skip
const SKIP_LINE_RE = /^(sl\.?\s*no|s\.no|course\s*code|subject|credits?|grade|total|result|sgpa|cgpa|semester|register|name|regno|marks|attendance|out of|earned|status|pass|fail|absent)/i;

/**
 * Main entry point. Parses raw OCR text into structured grade rows.
 * Handles SRM marksheet format with tolerance for OCR noise.
 */
export function parseOCRText(rawText: string, wordConfidences: number[]): ExtractionResult {
  const semesterNumber = detectSemester(rawText);
  const registerNumber = detectRegisterNumber(rawText);

  const gpaMatch = rawText.match(/(?:sgpa|gpa|grade\s*point\s*avg?)\s*[:\-=]?\s*([0-9]+\.[0-9]+)/i);
  const rawSemesterGPA = gpaMatch ? parseFloat(gpaMatch[1]) : undefined;

  const avgConfidence = wordConfidences.length
    ? wordConfidences.reduce((a, b) => a + b, 0) / wordConfidences.length
    : 60;

  const rows: ExtractedRow[] = [];
  const lines = rawText.split('\n').map((l) => l.trim()).filter(Boolean);

  for (const line of lines) {
    if (SKIP_LINE_RE.test(line)) continue;
    if (/^[-=*_|#\s]+$/.test(line)) continue;
    if (line.length < 5) continue;

    // Tokenize: split on whitespace
    const tokens = line.split(/\s+/).filter(Boolean);
    if (tokens.length < 2) continue;

    // Strategy 1: find subject code in tokens
    const codeIdx = tokens.findIndex((t) => isSubjectCode(t));

    if (codeIdx >= 0) {
      const row = extractRowWithCode(tokens, codeIdx, avgConfidence);
      if (row) { rows.push(row); continue; }
    }

    // Strategy 2: scan for a grade token and nearby credit
    const row = extractRowByGrade(tokens, line, avgConfidence);
    if (row) rows.push(row);
  }

  // Deduplicate by subject code
  const seen = new Set<string>();
  const deduped = rows.filter((r) => {
    if (!r.subjectCode) return true;
    if (seen.has(r.subjectCode)) return false;
    seen.add(r.subjectCode);
    return true;
  });

  const validRows = deduped.filter((r) => r.isValid);
  const accuracyPercent =
    deduped.length === 0
      ? 0
      : Math.round((validRows.length / deduped.length) * avgConfidence * 10) / 10;

  return { rows: deduped, semesterNumber, registerNumber, rawSemesterGPA, accuracyPercent, rawText };
}

function extractRowWithCode(
  tokens: string[],
  codeIdx: number,
  baseConfidence: number
): ExtractedRow | null {
  const subjectCode = tokens[codeIdx].toUpperCase();

  // Look for a grade token AFTER the subject code
  let gradeIdx = -1;
  let grade: GradeKey = '';
  for (let i = codeIdx + 1; i < tokens.length; i++) {
    const g = normalizeGrade(tokens[i]);
    if (g) {
      grade = g;
      gradeIdx = i;
      break;
    }
  }

  // Credits: integer 1-6 that appears between code and grade (or right before grade)
  let credits: number | '' = '';
  const searchEnd = gradeIdx >= 0 ? gradeIdx : tokens.length;
  for (let i = codeIdx + 1; i < searchEnd; i++) {
    if (isCredit(tokens[i]) && !isGradePoint(tokens[i - 1] ?? '')) {
      credits = parseInt(tokens[i], 10);
      break;
    }
  }
  // If no credit found before grade, check if token right before grade is a credit
  if (credits === '' && gradeIdx > codeIdx + 1) {
    const candidate = tokens[gradeIdx - 1];
    if (isCredit(candidate)) credits = parseInt(candidate, 10);
  }

  // Subject name: tokens between code and first number (credit)
  const nameParts: string[] = [];
  for (let i = codeIdx + 1; i < tokens.length; i++) {
    if (/^\d+$/.test(tokens[i])) break;
    nameParts.push(tokens[i]);
  }
  const subjectName = nameParts.join(' ').trim() || subjectCode;

  const isValid = !!grade && credits !== '';
  const validationError = !grade
    ? 'Grade not detected'
    : credits === ''
    ? 'Credits not detected'
    : undefined;

  // Confidence: base OCR confidence + bonus for having subject code
  const confidence = Math.min(100, Math.round(baseConfidence + 10));

  return {
    id: nanoid(),
    subjectCode,
    subjectName,
    credits,
    grade,
    confidence,
    isValid,
    validationError,
  };
}

function extractRowByGrade(
  tokens: string[],
  line: string,
  baseConfidence: number
): ExtractedRow | null {
  // Find all grade tokens in the line
  for (let i = 0; i < tokens.length; i++) {
    const grade = normalizeGrade(tokens[i]);
    if (!grade) continue;

    // Skip if this token is inside a word like "GRADE" header — already filtered above
    // Look for credit: integer 1-6 before the grade token
    let credits: number | '' = '';
    for (let j = Math.max(0, i - 3); j < i; j++) {
      if (isCredit(tokens[j])) {
        credits = parseInt(tokens[j], 10);
        break;
      }
    }

    // Subject name: tokens before the credit (or before grade if no credit)
    const creditPos = credits !== ''
      ? tokens.findIndex((t, idx) => idx < i && isCredit(t))
      : i;
    const nameParts = tokens.slice(0, creditPos).filter((t) => !/^\d+$/.test(t));
    const subjectName = nameParts.join(' ').trim();

    if (!subjectName && credits === '') continue; // nothing useful

    const isValid = !!grade && credits !== '';

    return {
      id: nanoid(),
      subjectCode: '',
      subjectName: subjectName || `Subject`,
      credits,
      grade,
      confidence: Math.min(100, Math.round(baseConfidence - 5)),
      isValid,
      validationError: credits === '' ? 'Credits not detected' : undefined,
    };
  }

  return null;
}
