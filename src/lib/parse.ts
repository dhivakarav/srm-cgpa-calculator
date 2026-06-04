import type { ExtractedRow, ExtractionResult, GradeKey } from '../types';
import { GRADE_POINTS } from './gpa';
import type { TWord } from './ocr';
import { nanoid } from 'nanoid';

// ─── Valid grade set ──────────────────────────────────────────────────────────
const VALID_GRADES = new Set<string>(['O', 'A+', 'A', 'B+', 'B', 'C', 'U']);

// ─── Grade normalisation ──────────────────────────────────────────────────────
function normalizeGrade(raw: string): GradeKey | '' {
  const s = raw.trim().replace(/\s+/g, '').toUpperCase();
  if (VALID_GRADES.has(s)) return s as GradeKey;
  // OCR substitutions
  const map: Record<string, GradeKey> = {
    '0': 'O', 'O0': 'O', 'Q': 'O',
    'AT': 'A+', 'A-': 'A+', 'A1': 'A+',
    'BT': 'B+', 'B-': 'B+', 'B1': 'B+',
  };
  return map[s] ?? '';
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

// ─── Build result ─────────────────────────────────────────────────────────────
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
// STRATEGY 1 — Layout-based (uses word bounding boxes from Tesseract)
// This is the primary strategy. It matches credit and grade words by their
// Y position in the image — robust against any column layout or text wrapping.
// =============================================================================
function parseByLayout(words: TWord[]): Hit[] {
  if (!words.length) return [];

  // Combine split grade tokens: ["A", "+"] → ["A+"], ["B", "+"] → ["B+"]
  const combined: TWord[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const next = words[i + 1];
    const t = w.text.trim().toUpperCase();
    if ((t === 'A' || t === 'B') && next?.text.trim() === '+') {
      combined.push({
        text: t + '+',
        confidence: Math.min(w.confidence, next.confidence),
        bbox: { x0: w.bbox.x0, y0: Math.min(w.bbox.y0, next.bbox.y0), x1: next.bbox.x1, y1: Math.max(w.bbox.y1, next.bbox.y1) },
      });
      i++; // skip '+'
    } else {
      combined.push(w);
    }
  }

  // Find credit candidates: text is a bare digit 1-6, confidence > 25
  const creditWords = combined.filter(
    (w) => /^[1-6]$/.test(w.text.trim()) && w.confidence > 25
  );

  // Find grade candidates: text normalises to a valid grade, confidence > 25
  const gradeWords = combined.filter((w) => {
    const g = normalizeGrade(w.text);
    return g !== '' && w.confidence > 25;
  });

  console.log(`[Layout] ${creditWords.length} credit candidates, ${gradeWords.length} grade candidates`);
  if (!creditWords.length || !gradeWords.length) return [];

  // Estimate typical line height from credit word bounding boxes
  const heights = creditWords.map((w) => w.bbox.y1 - w.bbox.y0).filter((h) => h > 4);
  const sortedH = [...heights].sort((a, b) => a - b);
  const medianH = sortedH[Math.floor(sortedH.length / 2)] ?? 30;
  const yTolerance = medianH * 2.5; // generous — handles multi-line description rows

  console.log(`[Layout] Line height ≈ ${medianH}px, Y tolerance ≈ ${yTolerance}px`);

  // Sort both by Y (top → bottom)
  const sortedCredits = [...creditWords].sort((a, b) => a.bbox.y0 - b.bbox.y0);
  const sortedGrades = [...gradeWords].sort((a, b) => a.bbox.y0 - b.bbox.y0);

  const usedGrades = new Set<number>();
  const hits: Hit[] = [];

  for (const cw of sortedCredits) {
    const cY = (cw.bbox.y0 + cw.bbox.y1) / 2;
    let bestIdx = -1;
    let bestYDist = Infinity;

    for (let gi = 0; gi < sortedGrades.length; gi++) {
      if (usedGrades.has(gi)) continue;
      const gw = sortedGrades[gi];
      const gY = (gw.bbox.y0 + gw.bbox.y1) / 2;
      const yDist = Math.abs(gY - cY);
      if (yDist <= yTolerance && yDist < bestYDist) {
        bestYDist = yDist;
        bestIdx = gi;
      }
    }

    if (bestIdx >= 0) {
      const gw = sortedGrades[bestIdx];
      const grade = normalizeGrade(gw.text);
      const credits = parseInt(cw.text.trim());
      if (grade && credits > 0) {
        usedGrades.add(bestIdx);
        const conf = Math.round((cw.confidence + gw.confidence) / 2);
        hits.push({ credits, grade, confidence: conf, sourceLine: `layout-y${Math.round(cY)}` });
        console.log(`[Layout] Match: ${credits} ${grade} (credit@y${Math.round(cY)}, grade@y${Math.round((gw.bbox.y0+gw.bbox.y1)/2)}, conf:${conf})`);
      }
    }
  }

  // Sort hits top-to-bottom (document order)
  hits.sort((a, b) => {
    const ya = parseInt(a.sourceLine.replace('layout-y', ''));
    const yb = parseInt(b.sourceLine.replace('layout-y', ''));
    return ya - yb;
  });

  return hits;
}

// =============================================================================
// STRATEGY 2 — Text-based (fallback when layout gives < 2 results)
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

function parseByText(rawText: string, avgConf: number): Hit[] {
  const text = preprocessText(rawText);
  const lines = text.split('\n');
  const hits: Hit[] = [];

  // Pass 1 — same-line: find grade, look back ≤3 tokens for credit
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

  // Pass 1b — cross-line: credit at end of line, grade on a later line
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || SKIP_HEADER_RE.test(line)) continue;
    const lt = line.split(/\s+/).filter(Boolean);
    const lastTok = lt[lt.length - 1] ?? '';
    if (!/^[1-6]$/.test(lastTok)) continue;
    if (lt.some((t) => tokenToGrade(t) !== '')) continue; // Pass 1 handles

    // For bare credit lines (single token): skip if previous non-empty line is also a credit
    if (lt.length === 1) {
      let prevNE = '';
      for (let pi = i - 1; pi >= 0; pi--) {
        const pl = lines[pi].trim();
        if (pl) { prevNE = pl; break; }
      }
      if (/^[1-6]$/.test(prevNE)) continue; // credit-column block → Pass 4
    }

    const credits = parseInt(lastTok);
    const maxAhead = lt.length >= 2 ? 4 : 2;

    for (let j = i + 1; j <= Math.min(i + maxAhead, lines.length - 1); j++) {
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
        found = true;
        break;
      }
      if (found) break;
    }
  }

  // Pass 2 — PASS/FAIL regex on full text
  const PAT_PF = /\b([1-6])\s+(O|A\+|A|B\+|B|C|U)\s+(?:PASS|FAIL)\b/g;
  for (const m of text.matchAll(PAT_PF)) {
    const li = text.slice(0, m.index).split('\n').length - 1;
    hits.push({ credits: parseInt(m[1]), grade: m[2] as GradeKey, confidence: 95, sourceLine: lines[li]?.trim() ?? '' });
  }

  // Pass 3 — grade-point regex on full text
  const PAT_GP = /\b([1-6])\s+(O|A\+|A|B\+|B|C|U)\s+(?:10|[05-9])\b/g;
  for (const m of text.matchAll(PAT_GP)) {
    const gp = parseInt(m[0].split(/\s+/).pop() ?? '0');
    const expected = (GRADE_POINTS as Record<string, number>)[m[2]] ?? -1;
    const li = text.slice(0, m.index).split('\n').length - 1;
    hits.push({ credits: parseInt(m[1]), grade: m[2] as GradeKey, confidence: expected === gp ? 90 : 70, sourceLine: lines[li]?.trim() ?? '' });
  }

  // Pass 4 — column-order pairing (credit block detected or no hits yet)
  const hasCreditsBlock = lines.some(
    (_, i) =>
      i + 2 < lines.length &&
      /^[1-6]$/.test(lines[i].trim()) &&
      /^[1-6]$/.test(lines[i + 1].trim()) &&
      /^[1-6]$/.test(lines[i + 2].trim())
  );
  if (hits.length === 0 || hasCreditsBlock) {
    if (hasCreditsBlock) hits.length = 0;
    const cs: number[] = [], gs: GradeKey[] = [];
    for (const tok of text.split(/\s+/)) {
      if (/^[1-6]$/.test(tok)) cs.push(parseInt(tok));
      const g = tokenToGrade(tok);
      if (g) gs.push(g);
    }
    const n = Math.min(cs.length, gs.length);
    if (n > 0 && n <= 20)
      for (let pi = 0; pi < n; pi++)
        hits.push({ credits: cs[pi], grade: gs[pi], confidence: 50, sourceLine: `col-${pi}` });
  }

  // Deduplicate — keep highest confidence per (credits, grade, sourceLine)
  const seen = new Map<string, Hit>();
  for (const h of hits) {
    const key = `${h.credits}|${h.grade}|${h.sourceLine}`;
    const ex = seen.get(key);
    if (!ex || h.confidence > ex.confidence) seen.set(key, h);
  }

  const deduped = [...seen.values()].filter((h) => h.credits > 0);
  console.log(`[Text] ${deduped.length} rows from text parsing`);
  return deduped;
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

  // ── Strategy 1: layout-based (primary) ──────────────────────────────────
  const layoutHits = parseByLayout(words);
  console.log(`[Parse] Layout strategy: ${layoutHits.length} rows`);

  if (layoutHits.length >= 2) {
    return buildResult(layoutHits, meta);
  }

  // ── Strategy 2: text-based (fallback) ───────────────────────────────────
  const textHits = parseByText(rawText, avgConf);
  console.log(`[Parse] Text strategy: ${textHits.length} rows`);

  // Use whichever found more
  const best = layoutHits.length >= textHits.length ? layoutHits : textHits;
  console.log(`[Parse] Final: ${best.length} rows`);
  best.forEach((h, i) => console.log(`[Parse] Row ${i + 1}: ${h.credits} ${h.grade} (conf:${h.confidence})`));

  return buildResult(best, meta);
}

// Keep old export name as alias for compatibility
export const parseOCRText = (rawText: string, wordConfidences: number[]) =>
  parseOCRResult(rawText, [], wordConfidences);
