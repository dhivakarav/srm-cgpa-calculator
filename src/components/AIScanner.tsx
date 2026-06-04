import { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { nanoid } from 'nanoid';
import Glass from './Glass';
import Pill from './Pill';
import { type ExtractedRow, type ExtractionResult, type GradeKey } from '../types';
import { GRADE_KEYS, calculateGPAWithFailed } from '../lib/gpa';
import { runOCROnImage, runOCROnPDF } from '../lib/ocr';
import ResultDashboard from './ResultDashboard';

type Stage = 'upload' | 'processing' | 'review' | 'result';

interface UploadedFile {
  id: string;
  file: File;
  preview: string;
  type: 'image' | 'pdf';
}

export default function AIScanner() {
  const [stage, setStage] = useState<Stage>('upload');
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [ocrStatus, setOcrStatus] = useState('');
  const [allResults, setAllResults] = useState<ExtractionResult[]>([]);
  const [editableRows, setEditableRows] = useState<ExtractedRow[]>([]);
  const [accuracy, setAccuracy] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scanLineRef = useRef<HTMLDivElement>(null);

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
        console.error('OCR failed:', err);
      }
    }

    setAllResults(results);
    const merged = results.flatMap((r) => r.rows);
    setEditableRows(merged);
    const avgAcc =
      results.length ? results.reduce((s, r) => s + r.accuracyPercent, 0) / results.length : 0;
    setAccuracy(Math.round(avgAcc * 10) / 10);
    setStage('review');
  };

  const updateRow = (id: string, field: keyof ExtractedRow, val: unknown) => {
    setEditableRows((prev) => prev.map((r) => r.id === id ? { ...r, [field]: val } : r));
  };

  const deleteRow = (id: string) => setEditableRows((prev) => prev.filter((r) => r.id !== id));

  const addRow = () =>
    setEditableRows((prev) => [
      ...prev,
      { id: nanoid(), subjectCode: '', subjectName: `Subject ${prev.length + 1}`, credits: '', grade: '', confidence: 100, isValid: false },
    ]);

  const liveGPA = calculateGPAWithFailed(
    editableRows.map((r) => ({ id: r.id, name: r.subjectName, credits: r.credits, grade: r.grade }))
  );

  const reset = () => {
    setStage('upload');
    setFiles([]);
    setAllResults([]);
    setEditableRows([]);
    setOcrProgress(0);
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="text-center space-y-2">
        <h1 className="text-3xl md:text-4xl font-bold gradient-text">AI Marksheet Scanner</h1>
        <p className="text-slate-400 text-sm">Upload your SRM marksheet. Our AI extracts grades automatically — no typing needed.</p>
      </motion.div>

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
                    <div key={f.id} className="relative rounded-xl overflow-hidden border border-white/[0.08] bg-white/[0.03] aspect-video flex items-center justify-center">
                      {f.type === 'image' ? (
                        <img src={f.preview} alt="preview" className="w-full h-full object-cover" />
                      ) : (
                        <div className="text-center p-4">
                          <div className="text-3xl mb-1">📄</div>
                          <p className="text-xs text-slate-400 truncate max-w-[80px]">{f.file.name}</p>
                        </div>
                      )}
                      <button
                        onClick={() => removeFile(f.id)}
                        className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white text-xs flex items-center justify-center hover:bg-red-500/80 transition-colors cursor-pointer"
                      >×</button>
                    </div>
                  ))}
                </div>

                <motion.button
                  whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                  onClick={startProcessing}
                  className="w-full py-4 rounded-2xl font-bold text-white text-sm cursor-pointer"
                  style={{
                    background: 'linear-gradient(135deg, #a855f7, #3b82f6)',
                    boxShadow: '0 0 30px rgba(168,85,247,0.4)',
                  }}
                >
                  🤖 Analyze with AI
                </motion.button>
              </motion.div>
            )}
          </motion.div>
        )}

        {stage === 'processing' && (
          <motion.div key="processing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <ProcessingOverlay
              progress={ocrProgress}
              status={ocrStatus}
              file={files[0]}
              scanLineRef={scanLineRef}
            />
          </motion.div>
        )}

        {stage === 'review' && (
          <motion.div key="review" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <ReviewScreen
              rows={editableRows}
              accuracy={accuracy}
              liveGPA={liveGPA}
              results={allResults}
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
              semesters={allResults.map((r, i) => ({
                id: nanoid(),
                label: r.semesterNumber ? `Semester ${r.semesterNumber}` : `Semester ${i + 1}`,
                gpa: calculateGPAWithFailed(r.rows.map((row) => ({ id: row.id, name: row.subjectName, credits: row.credits, grade: row.grade }))),
                credits: r.rows.reduce((s, row) => s + (row.credits === '' ? 0 : Number(row.credits)), 0),
              }))}
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
      animate={{ borderColor: isDragging ? 'rgba(168,85,247,0.7)' : 'rgba(255,255,255,0.1)', scale: isDragging ? 1.01 : 1 }}
      className="border-2 border-dashed rounded-3xl p-12 text-center cursor-pointer transition-all"
      style={{ background: isDragging ? 'rgba(168,85,247,0.08)' : 'rgba(255,255,255,0.02)' }}
    >
      <motion.div className="text-6xl mb-4" animate={{ y: [0, -8, 0] }} transition={{ repeat: Infinity, duration: 2.5, ease: 'easeInOut' }}>
        🤖
      </motion.div>
      <p className="text-xl font-semibold text-white mb-2">Drop your marksheet here</p>
      <p className="text-slate-400 text-sm mb-4">PNG, JPG, JPEG or PDF — supports multi-page PDFs</p>
      <div className="flex items-center justify-center gap-4">
        <Pill color="#a855f7">📷 Screenshot</Pill>
        <Pill color="#3b82f6">📄 PDF</Pill>
        <Pill color="#06b6d4">🖼️ Photo</Pill>
      </div>
    </motion.div>
  );
}

function ProcessingOverlay({ progress, status, file, scanLineRef }: {
  progress: number;
  status: string;
  file?: UploadedFile;
  scanLineRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <Glass className="p-8 text-center space-y-6">
      <div className="relative mx-auto w-full max-w-sm aspect-video rounded-xl overflow-hidden bg-black/40 border border-white/[0.08]">
        {file?.preview ? (
          <img src={file.preview} alt="scanning" className="w-full h-full object-contain opacity-60" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-4xl">📄</div>
        )}
        {/* Scan line */}
        <motion.div
          className="absolute left-0 right-0 h-0.5"
          style={{ background: 'linear-gradient(90deg, transparent, #a855f7, #3b82f6, transparent)', boxShadow: '0 0 12px #a855f7' }}
          animate={{ top: ['0%', '100%', '0%'] }}
          transition={{ repeat: Infinity, duration: 2, ease: 'linear' }}
          ref={scanLineRef}
        />
        {/* Corner brackets */}
        {['tl', 'tr', 'bl', 'br'].map((pos) => (
          <div key={pos} className={`absolute w-4 h-4 border-purple-500 ${pos === 'tl' ? 'top-2 left-2 border-t-2 border-l-2' : pos === 'tr' ? 'top-2 right-2 border-t-2 border-r-2' : pos === 'bl' ? 'bottom-2 left-2 border-b-2 border-l-2' : 'bottom-2 right-2 border-b-2 border-r-2'}`} />
        ))}
      </div>

      <div className="space-y-2">
        <motion.p
          key={status}
          initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }}
          className="text-white font-medium"
        >{status || 'Initializing...'}</motion.p>
        <div className="w-full max-w-sm mx-auto h-2 rounded-full bg-white/[0.06] overflow-hidden">
          <motion.div
            className="h-full rounded-full"
            style={{ background: 'linear-gradient(90deg, #a855f7, #3b82f6)' }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.4 }}
          />
        </div>
        <p className="text-slate-400 text-xs">{progress}% complete</p>
      </div>

      <div className="flex justify-center gap-3 text-xs text-slate-500">
        {['🔍 Reading', '📚 Extracting', '🧠 Calculating', '✨ Finalizing'].map((step, i) => (
          <span key={step} style={{ color: progress > i * 25 ? '#a855f7' : undefined }}>{step}</span>
        ))}
      </div>
    </Glass>
  );
}

function ReviewScreen({ rows, accuracy, liveGPA, results, onUpdate, onDelete, onAdd, onCalculate, onReset }: {
  rows: ExtractedRow[];
  accuracy: number;
  liveGPA: number;
  results: ExtractionResult[];
  onUpdate: (id: string, field: keyof ExtractedRow, val: unknown) => void;
  onDelete: (id: string) => void;
  onAdd: () => void;
  onCalculate: () => void;
  onReset: () => void;
}) {
  const GRADE_COLORS: Record<string, string> = {
    O: '#a855f7', 'A+': '#3b82f6', A: '#06b6d4', 'B+': '#10b981', B: '#84cc16', C: '#f59e0b', U: '#ef4444',
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Pill color="#10b981">✅ {rows.filter((r) => r.isValid).length} valid rows</Pill>
          <Pill color="#a855f7">🎯 {accuracy}% accuracy</Pill>
          {results[0]?.registerNumber && <Pill color="#3b82f6">🪪 {results[0].registerNumber}</Pill>}
        </div>
        <div className="flex gap-2">
          <span className="text-sm text-slate-400">Live GPA:</span>
          <span className="text-sm font-bold text-purple-400">{liveGPA.toFixed(2)}</span>
        </div>
      </div>

      <Glass className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/[0.06]">
                <th className="text-left px-4 py-3 text-xs text-slate-500 font-medium">Subject</th>
                <th className="text-center px-3 py-3 text-xs text-slate-500 font-medium w-20">Credits</th>
                <th className="text-center px-3 py-3 text-xs text-slate-500 font-medium w-28">Grade</th>
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
                    className={`border-b border-white/[0.04] ${!row.isValid ? 'bg-amber-500/5' : ''}`}
                  >
                    <td className="px-4 py-2">
                      <input
                        type="text"
                        value={row.subjectName}
                        onChange={(e) => onUpdate(row.id, 'subjectName', e.target.value)}
                        className="w-full px-2 py-1 text-xs rounded-md"
                        placeholder="Subject name"
                      />
                      {row.validationError && (
                        <p className="text-amber-400 text-[10px] mt-0.5">{row.validationError}</p>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number" min={1} max={5}
                        value={row.credits}
                        onChange={(e) => onUpdate(row.id, 'credits', e.target.value === '' ? '' : Number(e.target.value))}
                        className="w-full px-2 py-1 text-xs text-center rounded-md"
                        placeholder="Cr"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={row.grade}
                        onChange={(e) => {
                          const g = e.target.value as GradeKey;
                          onUpdate(row.id, 'grade', g);
                          onUpdate(row.id, 'isValid', !!g && row.credits !== '');
                          onUpdate(row.id, 'validationError', !g ? 'Select a grade' : undefined);
                        }}
                        className="w-full px-2 py-1 text-xs rounded-md"
                        style={{ color: row.grade ? GRADE_COLORS[row.grade] : undefined }}
                      >
                        <option value="">–</option>
                        {GRADE_KEYS.map((g) => (
                          <option key={g} value={g} style={{ color: GRADE_COLORS[g] }}>{g}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span className={`text-xs font-medium ${row.confidence >= 80 ? 'text-emerald-400' : row.confidence >= 50 ? 'text-amber-400' : 'text-red-400'}`}>
                        {row.confidence}%
                      </span>
                    </td>
                    <td className="px-2 py-2 text-center">
                      <button onClick={() => onDelete(row.id)} className="text-slate-500 hover:text-red-400 transition-colors cursor-pointer text-lg leading-none">×</button>
                    </td>
                  </motion.tr>
                ))}
              </AnimatePresence>
            </tbody>
          </table>
        </div>
      </Glass>

      <div className="flex gap-3 flex-wrap">
        <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={onAdd}
          className="px-4 py-2.5 rounded-xl text-sm font-medium border border-purple-500/30 text-purple-400 hover:bg-purple-500/10 transition-colors cursor-pointer">
          + Add Row
        </motion.button>
        <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={onReset}
          className="px-4 py-2.5 rounded-xl text-sm font-medium border border-white/10 text-slate-400 hover:bg-white/5 transition-colors cursor-pointer">
          ← Rescan
        </motion.button>
        <motion.button
          whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
          onClick={onCalculate}
          className="ml-auto px-6 py-2.5 rounded-xl text-sm font-bold text-white cursor-pointer"
          style={{ background: 'linear-gradient(135deg, #a855f7, #3b82f6)', boxShadow: '0 0 20px rgba(168,85,247,0.4)' }}
        >
          Calculate CGPA →
        </motion.button>
      </div>
    </div>
  );
}

// Silence unused warning
void useEffect;
