import { createWorker } from 'tesseract.js';
import type { ExtractionResult } from '../types';
import { parseOCRResult } from './parse';

export type OCRProgressCallback = (progress: number, status: string) => void;

export interface TWord {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

// ---------------------------------------------------------------------------
// Canvas preprocessing — scale up + grayscale + contrast (NO binarization)
// ---------------------------------------------------------------------------
async function preprocessImage(imageSource: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const srcW = img.naturalWidth;
      const srcH = img.naturalHeight;
      const scale = srcW < 1800 ? 1800 / srcW : 1;
      const dstW = Math.round(srcW * scale);
      const dstH = Math.round(srcH * scale);

      console.log(`[OCR] Image: ${srcW}×${srcH} → scaled ${dstW}×${dstH} (×${scale.toFixed(2)})`);

      const canvas = document.createElement('canvas');
      canvas.width = dstW;
      canvas.height = dstH;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, dstW, dstH);

      const id = ctx.getImageData(0, 0, dstW, dstH);
      const d = id.data;
      for (let i = 0; i < d.length; i += 4) {
        const gray = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
        const out = Math.max(0, Math.min(255, Math.round(128 + (gray - 128) * 1.5)));
        d[i] = d[i + 1] = d[i + 2] = out;
      }
      ctx.putImageData(id, 0, 0);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('Image load failed'));
    img.src = imageSource;
  });
}

// ---------------------------------------------------------------------------
// One Tesseract pass — returns text, word-level data with bounding boxes
// ---------------------------------------------------------------------------
async function runTesseractPSM(
  imageDataUrl: string,
  psm: number,
  attemptNum: number,
  onProgress: OCRProgressCallback
): Promise<{ text: string; confidences: number[]; words: TWord[] }> {
  onProgress(5 + attemptNum * 2, '⚙️ Loading OCR engine...');

  const worker = await createWorker('eng', 1, {
    logger: (m) => {
      if (m.status === 'recognizing text')
        onProgress(20 + Math.round(m.progress * 55), '🔍 Reading text...');
      else if (m.status === 'loading language traineddata')
        onProgress(10, '📦 Loading language data...');
    },
  });

  try {
    await worker.setParameters({ tessedit_pageseg_mode: String(psm) as never });
    // tesseract.js v7 only returns word-level data when `blocks` output is enabled.
    const result = await worker.recognize(imageDataUrl, {}, { blocks: true });
    const text = result.data.text ?? '';
    // Flatten block → paragraph → line → word to collect bounding boxes.
    const words: TWord[] = [];
    for (const block of result.data.blocks ?? []) {
      for (const para of block.paragraphs ?? []) {
        for (const line of para.lines ?? []) {
          for (const w of line.words ?? []) {
            words.push({ text: w.text, confidence: w.confidence, bbox: w.bbox });
          }
        }
      }
    }
    const confidences = words.map((w) => w.confidence);

    console.log(`[OCR] PSM ${psm} attempt ${attemptNum}: ${text.length} chars, ${words.length} words`);
    console.log(`[OCR] Raw text:\n${text}`);
    return { text, confidences, words };
  } finally {
    await worker.terminate();
  }
}

// ---------------------------------------------------------------------------
// Multi-PSM fallback — pick the attempt with the most parsed rows
// ---------------------------------------------------------------------------
async function imageToOCR(
  imageSource: string,
  onProgress: OCRProgressCallback
): Promise<{ text: string; confidences: number[]; words: TWord[] }> {
  let processed = imageSource;
  try {
    processed = await preprocessImage(imageSource);
  } catch (e) {
    console.warn('[OCR] Preprocessing failed, using original:', e);
  }

  const psmSequence = [6, 4, 3, 11];
  let best = { text: '', confidences: [] as number[], words: [] as TWord[], rows: -1 };

  for (let i = 0; i < psmSequence.length; i++) {
    const psm = psmSequence[i];
    const result = await runTesseractPSM(processed, psm, i + 1, onProgress);
    const parsed = parseOCRResult(result.text, result.words, result.confidences);
    const rows = parsed.rows.length;
    console.log(`[OCR] PSM ${psm} → ${rows} rows parsed`);
    if (rows > best.rows) {
      best = { ...result, rows };
    }
    if (rows >= 2) break;
  }

  return { text: best.text, confidences: best.confidences, words: best.words };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
export async function runOCROnImage(
  file: File,
  onProgress: OCRProgressCallback
): Promise<ExtractionResult> {
  onProgress(0, '🔍 Reading marksheet...');
  const url = URL.createObjectURL(file);
  try {
    const { text, confidences, words } = await imageToOCR(url, onProgress);
    onProgress(85, '📚 Extracting grades...');
    const result = parseOCRResult(text, words, confidences);
    onProgress(95, '🧠 Calculating...');
    await new Promise((r) => setTimeout(r, 150));
    onProgress(100, '✨ Done!');
    return result;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function runOCROnPDF(
  file: File,
  onProgress: OCRProgressCallback
): Promise<ExtractionResult[]> {
  onProgress(0, '🔍 Loading PDF...');
  const pdfjsLib = await import('pdfjs-dist');
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.mjs',
    import.meta.url
  ).toString();

  const arrayBuffer = await file.arrayBuffer();
  const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const numPages = pdfDoc.numPages;
  const results: ExtractionResult[] = [];

  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    const base = Math.round(((pageNum - 1) / numPages) * 80);
    onProgress(base, `🔍 Page ${pageNum}/${numPages}...`);
    const page = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: 2.5 });
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    const imageDataUrl = canvas.toDataURL('image/png');
    const { text, confidences, words } = await imageToOCR(
      imageDataUrl,
      (p, s) => onProgress(base + Math.round((p / 100) * (80 / numPages)), s)
    );
    results.push(parseOCRResult(text, words, confidences));
  }

  onProgress(100, '✨ Done!');
  return results;
}
