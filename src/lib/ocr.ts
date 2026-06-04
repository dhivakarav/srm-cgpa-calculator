import { createWorker } from 'tesseract.js';
import type { ExtractionResult } from '../types';
import { parseOCRText } from './parse';

export type OCRProgressCallback = (progress: number, status: string) => void;

async function imageToOCR(
  imageData: string,
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
    // PSM 3 = fully automatic page segmentation — handles multi-column tables better
    await worker.setParameters({ tessedit_pageseg_mode: '3' as never });
    const result = await worker.recognize(imageData);
    const confidences: number[] = result.data.words?.map((w) => w.confidence) ?? [];
    console.log('[OCR raw text]\n', result.data.text); // debug — shows in browser console
    return { text: result.data.text, confidences };
  } finally {
    await worker.terminate();
  }
}

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

    const imageDataUrl = canvas.toDataURL('image/png');
    const { text, confidences } = await imageToOCR(
      imageDataUrl,
      (p, s) => onProgress(pageBase + Math.round((p / 100) * (80 / numPages)), s)
    );

    onProgress(Math.round((pageNum / numPages) * 80), `📚 Parsing page ${pageNum}...`);
    const result = parseOCRText(text, confidences);
    results.push(result); // push even if 0 rows — caller decides
  }

  onProgress(95, '🧠 Merging results...');
  await new Promise((r) => setTimeout(r, 200));
  onProgress(100, '✨ All pages processed!');
  return results;
}
