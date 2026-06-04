import { createWorker } from 'tesseract.js';
import type { ExtractionResult } from '../types';
import { parseOCRText } from './parse';

export type OCRProgressCallback = (progress: number, status: string) => void;

// ---------------------------------------------------------------------------
// Canvas-based image preprocessing
// ---------------------------------------------------------------------------
async function preprocessImage(imageSource: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      const srcW = img.naturalWidth;
      const srcH = img.naturalHeight;

      // Scale up to minimum 1800px wide (phone screenshots are ~390px)
      const minWidth = 1800;
      const scale = srcW < minWidth ? minWidth / srcW : 1;
      const dstW = Math.round(srcW * scale);
      const dstH = Math.round(srcH * scale);

      console.log(`[OCR] Image dimensions: ${srcW}x${srcH}, scale: ${scale.toFixed(2)}`);

      const canvas = document.createElement('canvas');
      canvas.width = dstW;
      canvas.height = dstH;
      const ctx = canvas.getContext('2d')!;

      // Draw scaled image
      ctx.drawImage(img, 0, 0, dstW, dstH);

      // Pixel-level processing: grayscale → contrast stretch → threshold
      const imageData = ctx.getImageData(0, 0, dstW, dstH);
      const data = imageData.data;

      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];

        // Luminance grayscale
        const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);

        // Contrast stretch: amplify deviation from 128 by factor 1.4
        const stretched = Math.round(128 + (gray - 128) * 1.4);
        const clamped = Math.max(0, Math.min(255, stretched));

        // Hard threshold at 150 → black (0) or white (255)
        const binary = clamped < 150 ? 0 : 255;

        data[i] = binary;
        data[i + 1] = binary;
        data[i + 2] = binary;
        // alpha unchanged
      }

      ctx.putImageData(imageData, 0, 0);
      resolve(canvas.toDataURL('image/png'));
    };

    img.onerror = () => reject(new Error('Failed to load image for preprocessing'));
    img.src = imageSource;
  });
}

// ---------------------------------------------------------------------------
// Single Tesseract pass with a given PSM
// ---------------------------------------------------------------------------
async function runTesseractPSM(
  imageDataUrl: string,
  psm: number,
  attemptNum: number,
  onProgress: OCRProgressCallback
): Promise<{ text: string; confidences: number[] }> {
  onProgress(5, '⚙️ Loading OCR engine...');

  const worker = await createWorker('eng', 1, {
    logger: (m) => {
      if (m.status === 'recognizing text') {
        onProgress(20 + Math.round(m.progress * 60), '🔍 Reading text...');
      } else if (m.status === 'loading language traineddata') {
        onProgress(10, '📦 Loading language data...');
      } else if (m.status === 'initializing api') {
        onProgress(15, '🔧 Initializing...');
      }
    },
  });

  try {
    await worker.setParameters({ tessedit_pageseg_mode: String(psm) as never });
    const result = await worker.recognize(imageDataUrl);
    const text = result.data.text ?? '';
    const confidences: number[] = result.data.words?.map((w) => w.confidence) ?? [];
    const lineCount = text.split('\n').filter((l) => l.trim().length > 0).length;

    console.log(`[OCR] PSM ${psm} attempt ${attemptNum}, text length: ${text.length}, lines: ${lineCount}`);
    console.log(`[OCR] Raw text:\n${text}`);

    return { text, confidences };
  } finally {
    await worker.terminate();
  }
}

// ---------------------------------------------------------------------------
// Core: OCR with multi-PSM fallback, returns best result
// ---------------------------------------------------------------------------
async function imageToOCR(
  imageSource: string,
  onProgress: OCRProgressCallback
): Promise<{ text: string; confidences: number[] }> {
  // Preprocess image first
  let processedDataUrl: string;
  try {
    processedDataUrl = await preprocessImage(imageSource);
  } catch (e) {
    console.warn('[OCR] Preprocessing failed, using original image:', e);
    processedDataUrl = imageSource;
  }

  const psmSequence = [6, 4, 3]; // uniform block → single column → fully auto
  let bestText = '';
  let bestConf: number[] = [];
  let bestRowCount = -1;

  for (let i = 0; i < psmSequence.length; i++) {
    const psm = psmSequence[i];
    const { text, confidences } = await runTesseractPSM(processedDataUrl, psm, i + 1, onProgress);
    const parsed = parseOCRText(text, confidences);
    const rowCount = parsed.rows.length;

    console.log(`[OCR] PSM ${psm} produced ${rowCount} parsed rows`);

    if (rowCount > bestRowCount) {
      bestRowCount = rowCount;
      bestText = text;
      bestConf = confidences;
    }

    // Stop if we have enough rows — no need to try more PSMs
    if (rowCount >= 2) break;
  }

  return { text: bestText, confidences: bestConf };
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
    const { text, confidences } = await imageToOCR(url, onProgress);
    onProgress(85, '📚 Extracting grades...');
    const result = parseOCRText(text, confidences);
    onProgress(95, '🧠 Calculating GPA...');
    await new Promise((r) => setTimeout(r, 200));
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
    const pageBase = Math.round(((pageNum - 1) / numPages) * 80);
    onProgress(pageBase, `🔍 Scanning page ${pageNum} of ${numPages}...`);

    const page = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: 2.5 }); // hi-res
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: ctx, viewport }).promise;

    // PDF pages are already high-res; still run preprocessing for binarisation
    const imageDataUrl = canvas.toDataURL('image/png');
    const { text, confidences } = await imageToOCR(
      imageDataUrl,
      (p, s) => onProgress(pageBase + Math.round((p / 100) * (80 / numPages)), s)
    );

    onProgress(Math.round((pageNum / numPages) * 80), `📚 Parsing page ${pageNum}...`);
    const result = parseOCRText(text, confidences);
    results.push(result);
  }

  onProgress(95, '🧠 Merging results...');
  await new Promise((r) => setTimeout(r, 200));
  onProgress(100, '✨ All pages processed!');
  return results;
}
