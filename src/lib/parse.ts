import type { ExtractedRow, ExtractionResult, GradeKey } from '../types';
import { nanoid } from 'nanoid';

const VALID_GRADES = new Set<string>(['O', 'A+', 'A', 'B+', 'B', 'C', 'U']);

// OCR noise correction: map common misreads to valid grades
function normalizeGrade(raw: string): GradeKey | '' {
  const s = raw.trim().toUpperCase().replace(/\s+/g, '');
  if (VALID_GRADES.has(s)) return s as GradeKey;
  // Common OCR substitutions
  const map: Record<string, GradeKey> = {
    '0': 'O', 'O0': 'O', '00': 'O',
    'A1': 'A+', 'A+1': 'A+', 'At': 'A+',
    'B1': 'B+', 'B+1': 'B+', 'Bt': 'B+',
    'A': 'A', 'B': 'B', 'C': 'C', 'U': 'U',
  };
  return map[s] ?? '';
}

function normalizeCredits(raw: string): number | '' {
  const n = parseFloat(raw.replace(/[^\d.]/g, ''));
  if (isNaN(n) || n < 1 || n > 6) return '';
  return Math.round(n);
}

// Detect semester number from text
function detectSemester(text: string): number | undefined {
  const m = text.match(/semester[\s:\-]*(\d+)|sem[\s:\-]*(\d+)|(\d+)(st|nd|rd|th)\s*semester/i);
  if (m) return parseInt(m[1] || m[2] || m[3]);
  return undefined;
}

// Detect register number
function detectRegisterNumber(text: string): string | undefined {
  const m = text.match(/\b(RA\d{13}|\d{15}|[A-Z]{2}\d{2}[A-Z]{2}\d{4})\b/i);
  return m?.[0]?.toUpperCase();
}

// Extract rows from raw OCR text
export function parseOCRText(rawText: string, wordConfidences: number[]): ExtractionResult {
  const lines = rawText.split('\n').map((l) => l.trim()).filter(Boolean);
  const rows: ExtractedRow[] = [];

  const semesterNumber = detectSemester(rawText);
  const registerNumber = detectRegisterNumber(rawText);

  // Try to detect printed GPA line (e.g. "GPA : 8.45" or "SGPA: 8.45")
  let rawSemesterGPA: number | undefined;
  const gpaMatch = rawText.match(/(?:sgpa|gpa|grade\s+point\s+average)\s*[:\-=]?\s*([0-9]+\.[0-9]+)/i);
  if (gpaMatch) rawSemesterGPA = parseFloat(gpaMatch[1]);

  // Row patterns to try (subject code | subject name | credits | grade)
  // SRM marksheet rows usually follow: CODE  SUBJECT_NAME  CREDITS  GRADE  GP  ...
  const SUBJECT_CODE_RE = /^[A-Z]{2,4}\d{3,5}[A-Z]?$/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const parts = line.split(/\s{2,}|\t/).map((p) => p.trim()).filter(Boolean);

    if (parts.length < 2) continue;

    // Skip obvious header / footer noise
    if (/^(subject|code|name|credit|grade|total|result|sgpa|cgpa|semester|register|sl\.?\s*no|s\.no)/i.test(line)) continue;
    if (/^[\-=*#_]+$/.test(line)) continue;

    // Try to find a subject code pattern somewhere in the row
    const codeIdx = parts.findIndex((p) => SUBJECT_CODE_RE.test(p));

    let subjectCode = '';
    let subjectName = '';
    let creditsRaw = '';
    let gradeRaw = '';

    if (codeIdx >= 0) {
      subjectCode = parts[codeIdx];
      // Subject name is usually right after code (or in the next col)
      subjectName = parts.slice(codeIdx + 1, -2).join(' ').replace(/\d+$/, '').trim();
      // Last two meaningful tokens: credits and grade
      const tail = parts.slice(codeIdx + 1);
      // Find credits (1–6)
      for (let t = tail.length - 1; t >= 0; t--) {
        if (/^\d(\.\d)?$/.test(tail[t])) {
          creditsRaw = tail[t];
          // Grade should be right before credits or right after — try both
          const possibleGrades = [tail[t - 1], tail[t + 1]].filter(Boolean);
          for (const pg of possibleGrades) {
            const g = normalizeGrade(pg);
            if (g) { gradeRaw = pg; break; }
          }
          if (!gradeRaw) {
            // Try scanning tail for grade
            for (const token of tail) {
              const g = normalizeGrade(token);
              if (g) { gradeRaw = token; break; }
            }
          }
          break;
        }
      }
    } else {
      // Try looser: last token is grade, second-last is credits
      gradeRaw = parts[parts.length - 1];
      creditsRaw = parts[parts.length - 2] ?? '';
      subjectName = parts.slice(0, -2).join(' ');
    }

    const grade = normalizeGrade(gradeRaw);
    const credits = normalizeCredits(creditsRaw);

    if (!grade && credits === '') continue; // totally unresolvable line

    const isValid = !!grade && credits !== '';
    let validationError: string | undefined;
    if (!grade) validationError = 'Could not detect grade';
    else if (credits === '') validationError = 'Could not detect credits';

    // Confidence: average of Tesseract word confidences in this region + pattern matching bonus
    const lineConfidence = wordConfidences.length
      ? wordConfidences.reduce((a, b) => a + b, 0) / wordConfidences.length
      : 50;
    const patternBonus = codeIdx >= 0 ? 15 : 0;
    const confidence = Math.min(100, Math.round(lineConfidence + patternBonus));

    rows.push({
      id: nanoid(),
      subjectCode,
      subjectName: subjectName || `Subject ${rows.length + 1}`,
      credits,
      grade,
      confidence,
      isValid,
      validationError,
    });
  }

  // Overall accuracy: fraction of valid rows weighted by confidence
  const validRows = rows.filter((r) => r.isValid);
  const accuracyPercent =
    rows.length === 0
      ? 0
      : Math.round(
          (validRows.reduce((sum, r) => sum + r.confidence, 0) /
            (rows.length * 100)) *
            100 *
            10
        ) / 10;

  return { rows, semesterNumber, registerNumber, rawSemesterGPA, accuracyPercent, rawText };
}
