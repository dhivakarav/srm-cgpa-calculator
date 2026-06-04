import Tesseract from 'tesseract.js';
import type { ExtractionResult } from '../types';
import { parseOCRText } from './parse';

export type OCRProgressCallback = (progress: number, status: string) => void;

async function imageToOCR(
  imageData: string | ImageData,
  onProgress: OCRProgressCallback
): Promise<{ text: string; confidences: number[] }> {
  const result = await Tesseract.recognize(imageData, 'eng', {
    logger: (m) => {
      if (m.status === 'recognizing text') {
        onProgress(Math.round(m.progress * 80), 'Reading text...');
      } else if (m.status === 'loading tesseract core') {
        onProgress(5, 'Loading OCR engine...');
      } else if (m.status === 'initializing tesseract') {
        onProgress(10, 'Initializing...');
      } else if (m.status === 'loading language traineddata') {
        onProgress(15, 'Loading language data...');
      }
    },
  });

  const confidences: number[] = result.data.words?.map((w) => w.confidence) ?? [];
  return { text: result.data.text, confidences };
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
    await new Promise((r) => setTimeout(r, 300));
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
    onProgress(
      Math.round(((pageNum - 1) / numPages) * 70),
      `🔍 Scanning page ${pageNum} of ${numPages}...`
    );

    const page = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: 2.0 }); // hi-res for better OCR
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    canvas.width = viewport.width;
    canvas.height = viewport.height;

    await page.render({ canvasContext: ctx, viewport }).promise;

    const imageDataUrl = canvas.toDataURL('image/png');
    const { text, confidences } = await imageToOCR(
      imageDataUrl,
      (p, s) => onProgress(Math.round(((pageNum - 1 + p / 100) / numPages) * 70), s)
    );

    onProgress(Math.round((pageNum / numPages) * 80), `📚 Parsing page ${pageNum}...`);
    const result = parseOCRText(text, confidences);
    if (result.rows.length > 0) results.push(result);
  }

  onProgress(90, '🧠 Merging results...');
  await new Promise((r) => setTimeout(r, 300));
  onProgress(100, '✨ All pages processed!');

  return results;
}
