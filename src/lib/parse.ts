import type { ExtractedRow, ExtractionResult, GradeKey } from '../types';
import { GRADE_POINTS } from './gpa';
import type { TWord } from './ocr';
import { nanoid } from 'nanoid';

// ─── Grade set & normalisation ────────────────────────────────────────────────
const VALID_GRADES = new Set<string>(['O', 'A+', 'A', 'B+', 'B', 'C', 'U']);

function normalizeGrade(raw: string): GradeKey | '' {
  const s = raw.trim().replace(/\s+/g, '').toUpperCase();
  if (VALID_GRADES.has(s)) return s as GradeKey;
  const map: Record<string, GradeKey> = {
    '0': 'O', 'Q': 'O', 'O0': 'O', 'D': 'O',
    'AT': 'A+', 'A-': 'A+', 'A1': 'A+', 'A+1': 'A+',
    'BT': 'B+', 'B-': 'B+', 'B1': 'B+', 'B+1': 'B+',
    // single-char misreads
    'L': 'C', 'E': 'C',
  };
  return map[s] ?? '';
}

// ─── Metadata ─────────────────────────────────────────────────────────────────
function detectSemester(text: string): number | undefined {
  const m = text.match(/(?:semester|sem)[\s:.-]*([1-8])|([1-8])(?:st|nd|rd|th)\s*sem/i);
  return m ? parseInt(m[1] ?? m[2]) : undefined;
}
function detectRegisterNumber(text: string): string | undefined {
  const m = text.match(/\b(RA\d{13}|\d{15}|[A-Z]{2}\d{2}[A-Z]{2}\d{4,6})\b/i);
  return m?.[0]?.toUpperCase();
}

// ─── Result builder ───────────────────────────────────────────────────────────
type Hit = { credits: number; grade: GradeKey; confidence: number; sourceLine: string };

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
  return {
    rows,
    semesterNumber: meta.semesterNumber,
    registerNumber: meta.registerNumber,
    rawSemesterGPA: meta.rawSemesterGPA,
    accuracyPercent: rows.length > 0 ? Math.round(meta.avgConf * 10) / 10 : 0,
    rawText: meta.rawText,
  };
}

// =============================================================================
// STRATEGY 1 — Layout-based  (primary)
// Uses Tesseract word bounding boxes. Matches each credit word to the grade
// word with the closest Y-coordinate. Works for any column arrangement.
// =============================================================================
function parseByLayout(words: TWord[]): Hit[] {
  if (!words.length) return [];

  // Pre-combine split grade pairs: ["A","+"] → "A+",  ["B","+"] → "B+"
  const combined: TWord[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const next = words[i + 1];
    const t = w.text.trim().toUpperCase();
    if ((t === 'A' || t === 'B') && next?.text.trim() === '+') {
      combined.push({
        text: t + '+',
        confidence: Math.min(w.confidence, next.confidence),
        bbox: {
          x0: w.bbox.x0, y0: Math.min(w.bbox.y0, next.bbox.y0),
          x1: next.bbox.x1, y1: Math.max(w.bbox.y1, next.bbox.y1),
        },
      });
      i++;
    } else {
      combined.push(w);
    }
  }

  // Use very low confidence threshold — marksheet text is usually clear,
  // but Tesseract sometimes assigns low confidence to short single chars (O, B, A)
  const CONF_THRESHOLD = 10;

  const creditWords = combined.filter(
    (w) => /^[1-6]$/.test(w.text.trim()) && w.confidence >= CONF_THRESHOLD
  );
  const gradeWords = combined.filter((w) => {
    const g = normalizeGrade(w.text);
    return g !== '' && w.confidence >= CONF_THRESHOLD;
  });

  console.log(`[Layout] ${creditWords.length} credits, ${gradeWords.length} grades (threshold=${CONF_THRESHOLD})`);
  console.log(`[Layout] Credits:`, creditWords.map(w => `${w.text}@y${Math.round((w.bbox.y0+w.bbox.y1)/2)}`).join(', '));
  console.log(`[Layout] Grades:`, gradeWords.map(w => `${w.text}@y${Math.round((w.bbox.y0+w.bbox.y1)/2)}`).join(', '));

  if (!creditWords.length || !gradeWords.length) return [];

  // Estimate line height from word heights (use 75th percentile for robustness)
  const heights = combined
    .filter(w => w.bbox.y1 - w.bbox.y0 > 4 && w.bbox.y1 - w.bbox.y0 < 200)
    .map(w => w.bbox.y1 - w.bbox.y0);
  heights.sort((a, b) => a - b);
  const p75H = heights[Math.floor(heights.length * 0.75)] ?? 40;
  // Use 3.5× line height as Y tolerance — generous for multi-line description rows
  const yTol = p75H * 3.5;

  console.log(`[Layout] p75 line height=${p75H}px, Y tolerance=${yTol.toFixed(0)}px`);

  const sortedCredits = [...creditWords].sort((a, b) => a.bbox.y0 - b.bbox.y0);
  const sortedGrades  = [...gradeWords].sort((a, b) => a.bbox.y0 - b.bbox.y0);
  const usedGrades = new Set<number>();
  const hits: Hit[] = [];

  // First pass — match within normal tolerance
  for (const cw of sortedCredits) {
    const cY = (cw.bbox.y0 + cw.bbox.y1) / 2;
    let bestIdx = -1, bestDist = Infinity;
    for (let gi = 0; gi < sortedGrades.length; gi++) {
      if (usedGrades.has(gi)) continue;
      const gY = (sortedGrades[gi].bbox.y0 + sortedGrades[gi].bbox.y1) / 2;
      const d = Math.abs(gY - cY);
      if (d <= yTol && d < bestDist) { bestDist = d; bestIdx = gi; }
    }
    if (bestIdx >= 0) {
      const gw = sortedGrades[bestIdx];
      const grade = normalizeGrade(gw.text);
      const credits = parseInt(cw.text.trim());
      if (grade && credits > 0) {
        usedGrades.add(bestIdx);
        const conf = Math.round((cw.confidence + gw.confidence) / 2);
        hits.push({ credits, grade, confidence: conf, sourceLine: `ly${Math.round(cY)}` });
        console.log(`[Layout] ✓ ${credits} ${grade}  creditY=${Math.round(cY)} gradeY=${Math.round((gw.bbox.y0+gw.bbox.y1)/2)} dist=${Math.round(bestDist)} conf=${conf}`);
      }
    } else {
      console.log(`[Layout] ✗ credit ${cw.text} @y${Math.round(cY)} — no grade within ${yTol.toFixed(0)}px`);
    }
  }

  // Rescue pass — any remaining unmatched grades: pair with nearest unmatched credit
  // (handles cases where Y positions drift due to multi-line descriptions)
  const unmatchedCredits = sortedCredits.filter(cw => {
    const cY = Math.round((cw.bbox.y0 + cw.bbox.y1) / 2);
    return !hits.some(h => h.sourceLine === `ly${cY}`);
  });
  for (const cw of unmatchedCredits) {
    const cY = (cw.bbox.y0 + cw.bbox.y1) / 2;
    let bestIdx = -1, bestDist = Infinity;
    for (let gi = 0; gi < sortedGrades.length; gi++) {
      if (usedGrades.has(gi)) continue;
      const gY = (sortedGrades[gi].bbox.y0 + sortedGrades[gi].bbox.y1) / 2;
      const d = Math.abs(gY - cY);
      if (d < bestDist) { bestDist = d; bestIdx = gi; }
    }
    if (bestIdx >= 0 && bestDist < yTol * 3) { // 3× wider rescue tolerance
      const gw = sortedGrades[bestIdx];
      const grade = normalizeGrade(gw.text);
      const credits = parseInt(cw.text.trim());
      if (grade && credits > 0) {
        usedGrades.add(bestIdx);
        const conf = Math.max(30, Math.round((cw.confidence + gw.confidence) / 2) - 10);
        hits.push({ credits, grade, confidence: conf, sourceLine: `rescue-ly${Math.round(cY)}` });
        console.log(`[Layout] ✓ RESCUE ${credits} ${grade}  dist=${Math.round(bestDist)}`);
      }
    }
  }

  // Sort results top-to-bottom
  hits.sort((a, b) => {
    const ya = parseInt(a.sourceLine.replace(/[^\d]/g, '') || '0');
    const yb = parseInt(b.sourceLine.replace(/[^\d]/g, '') || '0');
    return ya - yb;
  });

  return hits;
}

// =============================================================================
// STRATEGY 2 — Text-based  (fallback when layout gives < 2 results)
// =============================================================================
const SKIP_HEADER_RE =
  /^(CODE|DESCRIPTION|CREDIT|GRADE|RESULT|SL|S\.NO|COURSE|SUBJECT|SGPA|CGPA|SEMESTER|REGISTER|NAME|MARKS|PASS|FAIL|DISCLAIMER|LAST|EXAM|PROVISIONAL)/i;

function tokenToGrade(token: string): GradeKey | '' {
  const t = token.trim().toUpperCase();
  if (VALID_GRADES.has(t)) return t as GradeKey;
  if (t === '0' || t === 'Q') return 'O';
  return '';
}

function preprocessText(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/\bA\s+\+/g, 'A+')
    .replace(/\bB\s+\+/g, 'B+')
    .replace(/[\t|_]/g, ' ')
    .replace(/[^\S\n]+/g, ' ');
}

function parseByText(rawText: string): Hit[] {
  const text = preprocessText(rawText);
  const lines = text.split('\n');
  const hits: Hit[] = [];

  // Pass 1 — same-line token scan
  for (const rl of lines) {
    const line = rl.trim();
    if (!line || SKIP_HEADER_RE.test(line)) continue;
    const tokens = line.split(/\s+/).filter(Boolean);
    for (let gi = 0; gi < tokens.length; gi++) {
      const grade = tokenToGrade(tokens[gi]);
      if (!grade) continue;
      for (let di = 1; di <= 3; di++) {
        const ci = gi - di;
        if (ci < 0) break;
        if (/^[1-6]$/.test(tokens[ci])) {
          hits.push({ credits: parseInt(tokens[ci]), grade, confidence: 80, sourceLine: line });
          break;
        }
      }
    }
  }

  // Pass 1b — cross-line
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || SKIP_HEADER_RE.test(line)) continue;
    const lt = line.split(/\s+/).filter(Boolean);
    const last = lt[lt.length - 1] ?? '';
    if (!/^[1-6]$/.test(last)) continue;
    if (lt.some((t) => tokenToGrade(t) !== '')) continue;
    if (lt.length === 1) {
      let pne = '';
      for (let pi = i - 1; pi >= 0; pi--) { const pl = lines[pi].trim(); if (pl) { pne = pl; break; } }
      if (/^[1-6]$/.test(pne)) continue;
    }
    const credits = parseInt(last);
    const maxA = lt.length >= 2 ? 4 : 2;
    for (let j = i + 1; j <= Math.min(i + maxA, lines.length - 1); j++) {
      const nl = lines[j].trim();
      if (!nl) continue;
      if (/^[1-6]$/.test(nl)) break;
      const nts = nl.split(/\s+/).filter(Boolean);
      let found = false;
      for (let k = 0; k < nts.length; k++) {
        const grade = tokenToGrade(nts[k]);
        if (!grade) continue;
        if (k > 0 && /^[1-6]$/.test(nts[k - 1])) continue;
        hits.push({ credits, grade, confidence: 65, sourceLine: line });
        found = true; break;
      }
      if (found) break;
    }
  }

  // Pass 2 — PASS/FAIL regex
  const PAT_PF = /\b([1-6])\s+(O|A\+|A|B\+|B|C|U)\s+(?:PASS|FAIL)\b/g;
  for (const m of text.matchAll(PAT_PF)) {
    const li = text.slice(0, m.index).split('\n').length - 1;
    hits.push({ credits: parseInt(m[1]), grade: m[2] as GradeKey, confidence: 95, sourceLine: lines[li]?.trim() ?? '' });
  }

  // Pass 3 — grade-point regex
  const PAT_GP = /\b([1-6])\s+(O|A\+|A|B\+|B|C|U)\s+(?:10|[05-9])\b/g;
  for (const m of text.matchAll(PAT_GP)) {
    const gp = parseInt(m[0].split(/\s+/).pop() ?? '0');
    const expected = (GRADE_POINTS as Record<string, number>)[m[2]] ?? -1;
    const li = text.slice(0, m.index).split('\n').length - 1;
    hits.push({ credits: parseInt(m[1]), grade: m[2] as GradeKey, confidence: expected === gp ? 90 : 70, sourceLine: lines[li]?.trim() ?? '' });
  }

  // Pass 4 — column-order pairing
  const hasBlock = lines.some(
    (_, i) => i + 2 < lines.length &&
      /^[1-6]$/.test(lines[i].trim()) &&
      /^[1-6]$/.test(lines[i + 1].trim()) &&
      /^[1-6]$/.test(lines[i + 2].trim())
  );
  if (hits.length === 0 || hasBlock) {
    if (hasBlock) hits.length = 0;
    const cs: number[] = [], gs: GradeKey[] = [];
    for (const tok of text.split(/\s+/)) {
      if (/^[1-6]$/.test(tok)) cs.push(parseInt(tok));
      const g = tokenToGrade(tok); if (g) gs.push(g);
    }
    const n = Math.min(cs.length, gs.length);
    if (n > 0 && n <= 20)
      for (let pi = 0; pi < n; pi++)
        hits.push({ credits: cs[pi], grade: gs[pi], confidence: 50, sourceLine: `col-${pi}` });
  }

  // Deduplicate
  const seen = new Map<string, Hit>();
  for (const h of hits) {
    const key = `${h.credits}|${h.grade}|${h.sourceLine}`;
    const ex = seen.get(key);
    if (!ex || h.confidence > ex.confidence) seen.set(key, h);
  }
  return [...seen.values()].filter((h) => h.credits > 0);
}

// =============================================================================
// Main entry point
// =============================================================================
export function parseOCRResult(
  rawText: string,
  words: TWord[],
  wordConfidences: number[]
): ExtractionResult {
  const semesterNumber = detectSemester(rawText);
  const registerNumber = detectRegisterNumber(rawText);
  const gpaMatch = rawText.match(/(?:sgpa|gpa)\s*[:\-=]?\s*([0-9]+\.[0-9]+)/i);
  const rawSemesterGPA = gpaMatch ? parseFloat(gpaMatch[1]) : undefined;
  const avgConf = wordConfidences.length
    ? wordConfidences.reduce((a, b) => a + b, 0) / wordConfidences.length
    : 65;

  const meta = { semesterNumber, registerNumber, rawSemesterGPA, rawText, avgConf };

  const layoutHits = parseByLayout(words);
  console.log(`[Parse] Layout: ${layoutHits.length} | Text fallback threshold: 2`);

  if (layoutHits.length >= 2) {
    return buildResult(layoutHits, meta);
  }

  const textHits = parseByText(rawText);
  console.log(`[Parse] Text: ${textHits.length}`);

  const best = layoutHits.length >= textHits.length ? layoutHits : textHits;
  console.log(`[Parse] Final: ${best.length} rows`);
  best.forEach((h, i) =>
    console.log(`[Parse] Row ${i + 1}: ${h.credits} ${h.grade} conf=${h.confidence}`)
  );

  return buildResult(best, meta);
}

export const parseOCRText = (rawText: string, wordConfidences: number[]) =>
  parseOCRResult(rawText, [], wordConfidences);
