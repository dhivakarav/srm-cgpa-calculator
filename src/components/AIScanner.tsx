import { useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { nanoid } from 'nanoid';
import Glass from './Glass';
import Pill from './Pill';
import { type ExtractedRow, type ExtractionResult, type GradeKey } from '../types';
import { GRADE_KEYS, calculateGPAWithFailed, GRADE_POINTS } from '../lib/gpa';
import { runOCROnImage, runOCROnPDF } from '../lib/ocr';
import ResultDashboard from './ResultDashboard';

type Stage = 'upload' | 'processing' | 'review' | 'result';

interface UploadedFile {
  id: string;
  file: File;
  preview: string;
  type: 'image' | 'pdf';
}

const GRADE_COLORS: Record<string, string> = {
  O: '#0a0a0a', 'A+': '#0a0a0a', A: '#0a0a0a',
  'B+': '#0a0a0a', B: '#0a0a0a', C: '#0a0a0a', U: '#0a0a0a',
};

export default function AIScanner() {
  const [stage, setStage] = useState<Stage>('upload');
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [ocrStatus, setOcrStatus] = useState('');
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [allResults, setAllResults] = useState<ExtractionResult[]>([]);
  const [editableRows, setEditableRows] = useState<ExtractedRow[]>([]);
  const [accuracy, setAccuracy] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback((newFiles: File[]) => {
    const valid = newFiles.filter((f) =>
      ['image/png', 'image/jpeg', 'image/jpg', 'application/pdf'].includes(f.type)
    );
    const uploads: UploadedFile[] = valid.map((f) => ({
      id: nanoid(),
      file: f,
      preview: f.type === 'application/pdf' ? '' : URL.createObjectURL(f),
      type: f.type === 'application/pdf' ? 'pdf' : 'image',
    }));
    setFiles((prev) => [...prev, ...uploads]);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    addFiles(Array.from(e.dataTransfer.files));
  }, [addFiles]);

  const removeFile = (id: string) => {
    setFiles((prev) => {
      const f = prev.find((x) => x.id === id);
      if (f?.preview) URL.revokeObjectURL(f.preview);
      return prev.filter((x) => x.id !== id);
    });
  };

  const startProcessing = async () => {
    if (files.length === 0) return;
    setStage('processing');
    setOcrProgress(0);
    setOcrError(null);
    const results: ExtractionResult[] = [];

    for (const uf of files) {
      try {
        if (uf.type === 'pdf') {
          const pageResults = await runOCROnPDF(uf.file, (p, s) => {
            setOcrProgress(p);
            setOcrStatus(s);
          });
          results.push(...pageResults);
        } else {
          const r = await runOCROnImage(uf.file, (p, s) => {
            setOcrProgress(p);
            setOcrStatus(s);
          });
          results.push(r);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setOcrError(`OCR failed: ${msg}`);
        setStage('upload');
        return;
      }
    }

    setAllResults(results);
    const merged = results.flatMap((r) => r.rows);
    setEditableRows(merged);
    const avgAcc = results.length
      ? results.reduce((s, r) => s + r.accuracyPercent, 0) / results.length
      : 0;
    setAccuracy(Math.round(avgAcc * 10) / 10);
    setStage('review');
  };

  const updateRow = (id: string, field: keyof ExtractedRow, val: unknown) => {
    setEditableRows((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        const updated = { ...r, [field]: val };
        updated.isValid = !!updated.grade && updated.credits !== '';
        updated.validationError = !updated.grade
          ? 'Select a grade'
          : updated.credits === ''
          ? 'Enter credits'
          : undefined;
        return updated;
      })
    );
  };

  const deleteRow = (id: string) => setEditableRows((prev) => prev.filter((r) => r.id !== id));

  const addRow = () =>
    setEditableRows((prev) => [
      ...prev,
      {
        id: nanoid(), subjectCode: '', subjectName: `Subject ${prev.length + 1}`,
        credits: '', grade: '', confidence: 100, isValid: false,
      },
    ]);

  const liveGPA = calculateGPAWithFailed(
    editableRows.map((r) => ({ id: r.id, name: r.subjectName, credits: r.credits, grade: r.grade }))
  );

  // Build semesters from editableRows (reflects user edits)
  const computedSemesters = allResults.length > 0
    ? allResults.map((r, i) => {
        // find the edited rows that came from this result
        const startIdx = allResults.slice(0, i).reduce((s, x) => s + x.rows.length, 0);
        const sliced = editableRows.slice(startIdx, startIdx + r.rows.length);
        const gpa = calculateGPAWithFailed(
          sliced.map((row) => ({ id: row.id, name: row.subjectName, credits: row.credits, grade: row.grade }))
        );
        const credits = sliced.reduce((s, row) => s + (row.credits === '' ? 0 : Number(row.credits)), 0);
        return {
          id: r.semesterNumber ? `sem-${r.semesterNumber}` : `sem-${i + 1}`,
          label: r.semesterNumber ? `Semester ${r.semesterNumber}` : `Semester ${i + 1}`,
          gpa,
          credits,
        };
      }).filter((s) => Number(s.credits) > 0)
    : [];

  const reset = () => {
    setStage('upload');
    setFiles([]);
    setAllResults([]);
    setEditableRows([]);
    setOcrProgress(0);
    setOcrError(null);
  };

  return (
    <div className="w-full max-w-none px-4 sm:px-8 lg:px-16 py-8 space-y-6">
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="text-center space-y-2">
        <h1 className="text-3xl md:text-4xl font-bold gradient-text">AI Marksheet Scanner</h1>
        <p className="text-slate-400 text-sm">
          Upload your SRM marksheet — AI reads grades automatically. You can always edit before calculating.
        </p>
      </motion.div>

      {/* Error banner */}
      <AnimatePresence>
        {ocrError && (
          <motion.div
            initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="p-4 rounded-xl border border-neutral-800/30 bg-neutral-800/10 text-neutral-600 text-sm flex items-start gap-3"
          >
            <span className="text-lg mt-0.5">⚠️</span>
            <div>
              <p className="font-medium">OCR Error</p>
              <p className="text-neutral-600/70 text-xs mt-0.5">{ocrError}</p>
            </div>
            <button onClick={() => setOcrError(null)} className="ml-auto text-neutral-600/60 hover:text-neutral-600 cursor-pointer">×</button>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait">
        {stage === 'upload' && (
          <motion.div key="upload" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
            <UploadZone
              isDragging={isDragging}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            />
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/jpg,application/pdf"
              multiple
              className="hidden"
              onChange={(e) => addFiles(Array.from(e.target.files ?? []))}
            />

            {files.length > 0 && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mt-4 space-y-3">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {files.map((f) => (
                    <div key={f.id} className="relative rounded-xl overflow-hidden border border-black/[0.08] bg-black/[0.03] aspect-video flex items-center justify-center">
                      {f.type === 'image' ? (
                        <img src={f.preview} alt="preview" className="w-full h-full object-cover" />
                      ) : (
                        <div className="text-center p-4">
                          <div className="text-3xl mb-1">📄</div>
                          <p className="text-xs text-slate-400 truncate max-w-[100px]">{f.file.name}</p>
                        </div>
                      )}
                      <button
                        onClick={() => removeFile(f.id)}
                        className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white text-xs flex items-center justify-center hover:bg-neutral-800/80 transition-colors cursor-pointer"
                      >×</button>
                    </div>
                  ))}
                </div>
                <motion.button
                  whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                  onClick={startProcessing}
                  className="w-full py-4 rounded-2xl font-bold text-white text-sm cursor-pointer"
                  style={{ background: '#0a0a0a', boxShadow: '0 0 30px rgba(0,0,0,0.4)' }}
                >
                  🤖 Analyze with AI
                </motion.button>
              </motion.div>
            )}
          </motion.div>
        )}

        {stage === 'processing' && (
          <motion.div key="processing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <ProcessingOverlay progress={ocrProgress} status={ocrStatus} file={files[0]} />
          </motion.div>
        )}

        {stage === 'review' && (
          <motion.div key="review" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <ReviewScreen
              rows={editableRows}
              accuracy={accuracy}
              liveGPA={liveGPA}
              rawText={allResults[0]?.rawText ?? ''}
              registerNumber={allResults[0]?.registerNumber}
              semesterNumber={allResults[0]?.semesterNumber}
              onUpdate={updateRow}
              onDelete={deleteRow}
              onAdd={addRow}
              onCalculate={() => setStage('result')}
              onReset={reset}
            />
          </motion.div>
        )}

        {stage === 'result' && (
          <motion.div key="result" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <ResultDashboard
              subjects={editableRows.map((r) => ({ id: r.id, name: r.subjectName, credits: r.credits, grade: r.grade }))}
              semesters={computedSemesters}
              onBack={() => setStage('review')}
              onReset={reset}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function UploadZone({ isDragging, onDragOver, onDragLeave, onDrop, onClick }: {
  isDragging: boolean;
  onDragOver: React.DragEventHandler;
  onDragLeave: React.DragEventHandler;
  onDrop: React.DragEventHandler;
  onClick: () => void;
}) {
  return (
    <motion.div
      onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop} onClick={onClick}
      animate={{ borderColor: isDragging ? 'rgba(0,0,0,0.7)' : 'rgba(0,0,0,0.1)', scale: isDragging ? 1.01 : 1 }}
      className="border-2 border-dashed rounded-3xl p-12 text-center cursor-pointer"
      style={{ background: isDragging ? 'rgba(0,0,0,0.08)' : 'rgba(0,0,0,0.02)' }}
    >
      <motion.div className="text-6xl mb-4" animate={{ y: [0, -8, 0] }} transition={{ repeat: Infinity, duration: 2.5, ease: 'easeInOut' }}>
        🤖
      </motion.div>
      <p className="text-xl font-semibold text-black mb-2">Drop your marksheet here</p>
      <p className="text-slate-400 text-sm mb-4">PNG, JPG, JPEG or PDF (multi-page supported)</p>
      <div className="flex items-center justify-center gap-4 flex-wrap">
        <Pill color="#0a0a0a">📷 Screenshot</Pill>
        <Pill color="#0a0a0a">📄 PDF</Pill>
        <Pill color="#0a0a0a">🖼️ Photo</Pill>
        <Pill color="#0a0a0a">🔒 100% Offline</Pill>
      </div>
    </motion.div>
  );
}

function ProcessingOverlay({ progress, status, file }: {
  progress: number;
  status: string;
  file?: UploadedFile;
}) {
  const steps = ['🔍 Reading', '📚 Extracting', '🧠 Calculating', '✨ Finalizing'];
  return (
    <Glass className="p-8 text-center space-y-6">
      <div className="relative mx-auto w-full max-w-sm aspect-video rounded-xl overflow-hidden bg-black/40 border border-black/[0.08]">
        {file?.preview ? (
          <img src={file.preview} alt="scanning" className="w-full h-full object-contain opacity-50" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-4xl">📄</div>
        )}
        <motion.div
          className="absolute left-0 right-0 h-0.5"
          style={{ background: 'linear-gradient(90deg, transparent, #0a0a0a, #0a0a0a, transparent)', boxShadow: '0 0 12px #0a0a0a' }}
          animate={{ top: ['0%', '100%', '0%'] }}
          transition={{ repeat: Infinity, duration: 2, ease: 'linear' }}
        />
        {(['tl', 'tr', 'bl', 'br'] as const).map((pos) => (
          <div key={pos} className={`absolute w-4 h-4 border-black opacity-70 ${
            pos === 'tl' ? 'top-2 left-2 border-t-2 border-l-2'
            : pos === 'tr' ? 'top-2 right-2 border-t-2 border-r-2'
            : pos === 'bl' ? 'bottom-2 left-2 border-b-2 border-l-2'
            : 'bottom-2 right-2 border-b-2 border-r-2'
          }`} />
        ))}
      </div>

      <div className="space-y-2">
        <motion.p key={status} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} className="text-black font-medium">
          {status || 'Initializing...'}
        </motion.p>
        <div className="w-full max-w-sm mx-auto h-2 rounded-full bg-black/[0.06] overflow-hidden">
          <motion.div
            className="h-full rounded-full"
            style={{ background: 'linear-gradient(90deg, #0a0a0a, #0a0a0a)' }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.3 }}
          />
        </div>
        <p className="text-slate-400 text-xs">{progress}% complete</p>
      </div>

      <div className="flex justify-center gap-4 text-xs text-slate-600 flex-wrap">
        {steps.map((step, i) => (
          <span key={step} className="transition-colors" style={{ color: progress > i * 25 ? '#0a0a0a' : undefined }}>
            {step}
          </span>
        ))}
      </div>
    </Glass>
  );
}

function ReviewScreen({ rows, accuracy, liveGPA, rawText, registerNumber, semesterNumber, onUpdate, onDelete, onAdd, onCalculate, onReset }: {
  rows: ExtractedRow[];
  accuracy: number;
  liveGPA: number;
  rawText: string;
  registerNumber?: string;
  semesterNumber?: number;
  onUpdate: (id: string, field: keyof ExtractedRow, val: unknown) => void;
  onDelete: (id: string) => void;
  onAdd: () => void;
  onCalculate: () => void;
  onReset: () => void;
}) {
  const [showRaw, setShowRaw] = useState(false);
  const validCount = rows.filter((r) => r.isValid).length;
  const isEmpty = rows.length === 0;

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Pill color={validCount > 0 ? '#0a0a0a' : '#0a0a0a'}>
            {validCount > 0 ? `✅ ${validCount} subjects found` : '⚠️ No subjects detected'}
          </Pill>
          {accuracy > 0 && <Pill color="#0a0a0a">🎯 {accuracy}% accuracy</Pill>}
          {registerNumber && <Pill color="#0a0a0a">🪪 {registerNumber}</Pill>}
          {semesterNumber && <Pill color="#0a0a0a">📅 Semester {semesterNumber}</Pill>}
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-slate-400">Live GPA:</span>
          <span className="font-bold text-purple-400">{liveGPA.toFixed(2)}</span>
        </div>
      </div>

      {/* Empty state */}
      {isEmpty && (
        <Glass className="p-8 text-center space-y-3">
          <p className="text-4xl">🔎</p>
          <p className="text-black font-semibold">No grade data detected</p>
          <p className="text-slate-400 text-sm max-w-md mx-auto">
            The OCR couldn't extract grades automatically. This can happen with low-res, rotated, or heavily watermarked images.
            You can manually add your subjects below and still use the calculator.
          </p>
          <motion.button
            whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
            onClick={onAdd}
            className="mx-auto px-5 py-2.5 rounded-xl text-sm font-medium border border-black/30 text-purple-400 hover:bg-black/10 transition-colors cursor-pointer"
          >
            + Add Subjects Manually
          </motion.button>
        </Glass>
      )}

      {/* Table */}
      {rows.length > 0 && (
        <Glass className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-black/[0.06]">
                  <th className="text-left px-4 py-3 text-xs text-slate-500 font-medium">Subject</th>
                  <th className="text-center px-3 py-3 text-xs text-slate-500 font-medium w-24">Credits</th>
                  <th className="text-center px-3 py-3 text-xs text-slate-500 font-medium w-32">Grade</th>
                  <th className="text-center px-3 py-3 text-xs text-slate-500 font-medium w-20">GP</th>
                  <th className="text-center px-3 py-3 text-xs text-slate-500 font-medium w-20">Conf.</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                <AnimatePresence>
                  {rows.map((row) => (
                    <motion.tr
                      key={row.id}
                      initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }}
                      className={`border-b border-black/[0.04] ${!row.isValid ? 'bg-neutral-700/5' : ''}`}
                    >
                      <td className="px-4 py-2">
                        <input
                          type="text"
                          value={row.subjectName}
                          onChange={(e) => onUpdate(row.id, 'subjectName', e.target.value)}
                          className="w-full px-2 py-1.5 text-xs rounded-md"
                          placeholder="Subject name"
                        />
                        {row.subjectCode && (
                          <p className="text-[10px] text-slate-600 mt-0.5 pl-1">{row.subjectCode}</p>
                        )}
                        {row.validationError && (
                          <p className="text-neutral-600 text-[10px] mt-0.5 pl-1">⚠ {row.validationError}</p>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number" min={1} max={5}
                          value={row.credits}
                          onChange={(e) => onUpdate(row.id, 'credits', e.target.value === '' ? '' : Number(e.target.value))}
                          className="w-full px-2 py-1.5 text-xs text-center rounded-md"
                          placeholder="Cr"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <select
                          value={row.grade}
                          onChange={(e) => onUpdate(row.id, 'grade', e.target.value as GradeKey)}
                          className="w-full px-2 py-1.5 text-xs rounded-md"
                          style={{ color: row.grade ? GRADE_COLORS[row.grade] : undefined }}
                        >
                          <option value="">– Grade –</option>
                          {GRADE_KEYS.map((g) => (
                            <option key={g} value={g} style={{ color: GRADE_COLORS[g] }}>{g}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2 text-center">
                        <span className="text-xs text-slate-400">
                          {row.grade ? GRADE_POINTS[row.grade as keyof typeof GRADE_POINTS] ?? '–' : '–'}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-center">
                        <span className={`text-xs font-medium ${
                          row.confidence >= 80 ? 'text-neutral-700'
                          : row.confidence >= 50 ? 'text-neutral-600'
                          : 'text-neutral-600'
                        }`}>{row.confidence}%</span>
                      </td>
                      <td className="px-2 py-2 text-center">
                        <button onClick={() => onDelete(row.id)} className="text-slate-500 hover:text-neutral-600 transition-colors cursor-pointer text-lg leading-none">×</button>
                      </td>
                    </motion.tr>
                  ))}
                </AnimatePresence>
              </tbody>
            </table>
          </div>
        </Glass>
      )}

      {/* Raw OCR text — collapsible debug panel */}
      {rawText && (
        <div>
          <button
            onClick={() => setShowRaw(v => !v)}
            className="text-xs text-slate-600 hover:text-slate-400 transition-colors cursor-pointer flex items-center gap-1"
          >
            {showRaw ? '▾' : '▸'} Raw OCR text (debug)
          </button>
          {showRaw && (
            <Glass className="mt-2 p-3 max-h-48 overflow-y-auto">
              <pre className="text-[10px] text-slate-500 whitespace-pre-wrap font-mono leading-relaxed">
                {rawText}
              </pre>
            </Glass>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3 flex-wrap">
        <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={onAdd}
          className="px-4 py-2.5 rounded-xl text-sm font-medium border border-black/30 text-purple-400 hover:bg-black/10 transition-colors cursor-pointer">
          + Add Row
        </motion.button>
        <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={onReset}
          className="px-4 py-2.5 rounded-xl text-sm font-medium border border-black/10 text-slate-400 hover:bg-black/5 transition-colors cursor-pointer">
          ← Rescan
        </motion.button>
        <motion.button
          whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
          onClick={onCalculate}
          disabled={rows.filter((r) => r.isValid).length === 0}
          className="ml-auto px-6 py-2.5 rounded-xl text-sm font-bold text-white cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ background: '#0a0a0a', boxShadow: '0 0 20px rgba(0,0,0,0.4)' }}
        >
          Calculate GPA / CGPA →
        </motion.button>
      </div>
    </div>
  );
}
