import { useState } from 'react';
import { motion } from 'framer-motion';
import Glass from './Glass';
import Pill from './Pill';
import { type Semester } from '../types';
import { calculateCGPA, getPerformanceLevel, PERFORMANCE_META } from '../lib/gpa';
import { nanoid } from 'nanoid';

const TARGETS = [7.0, 8.0, 8.5, 9.0, 9.5];

export default function Predictor() {
  const [semesters, setSemesters] = useState<Semester[]>([
    { id: nanoid(), label: 'Semester 1', gpa: 8.0, credits: 22 },
    { id: nanoid(), label: 'Semester 2', gpa: 7.5, credits: 22 },
  ]);
  const [whatIfGPAs, setWhatIfGPAs] = useState<Record<string, number>>({});
  const [targetCredits, setTargetCredits] = useState(22);

  const currentCGPA = calculateCGPA(semesters);
  const whatIfSemesters = semesters.map((s) =>
    s.id in whatIfGPAs ? { ...s, gpa: whatIfGPAs[s.id] } : s
  );
  const predictedCGPA = calculateCGPA(whatIfSemesters);
  const level = getPerformanceLevel(predictedCGPA);
  const meta = PERFORMANCE_META[level];

  const addSem = () => setSemesters((p) => [...p, { id: nanoid(), label: `Semester ${p.length + 1}`, gpa: 8.0, credits: 22 }]);
  const removeSem = (id: string) => setSemesters((p) => p.filter((s) => s.id !== id));

  // Semesters needed to reach target (with perfect 10 GPA)
  function semsToTarget(target: number): number | null {
    if (currentCGPA >= target) return 0;
    const totalC = semesters.reduce((s, x) => s + (x.credits === '' ? 0 : Number(x.credits)), 0);
    const totalW = currentCGPA * totalC;
    const denom = targetCredits * (10 - target);
    if (denom <= 0) return null;
    return Math.ceil((target * totalC - totalW) / denom);
  }

  return (
    <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6">
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="text-center space-y-2">
        <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold gradient-text">What-If Predictor</h1>
        <p className="text-slate-400 text-sm">Simulate GPA changes and see your predicted CGPA instantly.</p>
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <Glass className="p-5">
            <p className="text-xs text-slate-500 font-medium mb-4">Semester GPAs — drag sliders to simulate</p>
            {semesters.map((s) => {
              const current = Number(s.gpa);
              const wi = whatIfGPAs[s.id] ?? current;
              return (
                <div key={s.id} className="mb-5">
                  <div className="flex items-center gap-3 mb-2">
                    <input
                      type="text" value={s.label}
                      onChange={(e) => setSemesters((p) => p.map((x) => x.id === s.id ? { ...x, label: e.target.value } : x))}
                      className="flex-1 px-3 py-1.5 text-xs rounded-lg"
                    />
                    <input
                      type="number" min={1} max={40} value={s.credits}
                      onChange={(e) => setSemesters((p) => p.map((x) => x.id === s.id ? { ...x, credits: Number(e.target.value) } : x))}
                      className="w-20 px-2 py-1.5 text-xs text-center rounded-lg"
                      placeholder="Credits"
                    />
                    <button onClick={() => removeSem(s.id)} className="text-slate-500 hover:text-neutral-600 cursor-pointer text-lg leading-none">×</button>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] text-slate-500 w-12 text-right">{current.toFixed(1)} →</span>
                    <input
                      type="range" min={0} max={10} step={0.1}
                      value={wi}
                      onChange={(e) => setWhatIfGPAs((p) => ({ ...p, [s.id]: parseFloat(e.target.value) }))}
                      className="flex-1 accent-black cursor-pointer"
                    />
                    <span className="text-sm font-bold text-purple-400 w-10">{wi.toFixed(1)}</span>
                    {wi !== current && (
                      <Pill color={wi > current ? '#0a0a0a' : '#0a0a0a'} className="text-[10px]">
                        {wi > current ? '+' : ''}{(wi - current).toFixed(1)}
                      </Pill>
                    )}
                  </div>
                </div>
              );
            })}
            <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={addSem}
              className="w-full py-2 rounded-xl text-xs font-medium border border-black/30 text-purple-400 hover:bg-black/10 transition-colors cursor-pointer">
              + Add Semester
            </motion.button>
          </Glass>

          {/* Target progress */}
          <Glass className="p-5">
            <p className="text-xs text-slate-500 font-medium mb-1">Target Milestones</p>
            <div className="flex items-center gap-2 mb-4 text-[11px] text-slate-500">
              Avg credits/sem:
              <input
                type="number" min={1} max={40} value={targetCredits}
                onChange={(e) => setTargetCredits(Number(e.target.value))}
                className="w-16 px-2 py-1 rounded-lg text-center text-xs"
              />
            </div>
            <div className="space-y-4">
              {TARGETS.map((t) => {
                const prog = Math.min((predictedCGPA / t) * 100, 100);
                const sems = semsToTarget(t);
                return (
                  <div key={t}>
                    <div className="flex justify-between text-xs mb-1">
                      <div className="flex items-center gap-2">
                        <span className="text-black font-medium">CGPA {t}</span>
                        {sems === 0 && <Pill color="#0a0a0a" className="text-[10px]">Achieved ✓</Pill>}
                        {sems !== null && sems > 0 && (
                          <span className="text-slate-500">({sems} sem{sems !== 1 ? 's' : ''} with 10.0)</span>
                        )}
                      </div>
                      <span className="text-slate-400 font-medium">{prog.toFixed(0)}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-black/[0.06] overflow-hidden">
                      <motion.div
                        className="h-full rounded-full"
                        style={{ background: prog >= 100 ? '#0a0a0a' : 'linear-gradient(90deg,#0a0a0a,#0a0a0a)' }}
                        animate={{ width: `${prog}%` }}
                        transition={{ duration: 0.6 }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </Glass>
        </div>

        {/* Right panel */}
        <div className="space-y-4">
          <Glass className="p-6 text-center space-y-4">
            <p className="text-xs text-slate-500 uppercase tracking-widest font-medium">Current CGPA</p>
            <p className="text-4xl font-black text-black">{currentCGPA.toFixed(2)}</p>
            <div className="border-t border-black/[0.06] pt-4">
              <p className="text-xs text-slate-500 uppercase tracking-widest font-medium mb-2">Predicted CGPA</p>
              <p className="text-5xl font-black" style={{ color: meta.color, textShadow: `0 0 30px ${meta.color}60` }}>
                {predictedCGPA.toFixed(2)}
              </p>
              <p className="text-xs text-slate-500 mt-1">
                {predictedCGPA > currentCGPA ? '📈 ' : predictedCGPA < currentCGPA ? '📉 ' : '—'}
                {predictedCGPA !== currentCGPA ? `${Math.abs(predictedCGPA - currentCGPA).toFixed(2)} change` : 'No change'}
              </p>
            </div>
            <Pill color={meta.color}>{meta.emoji} {meta.label}</Pill>
          </Glass>

          <Glass className="p-4 space-y-2">
            <p className="text-xs text-slate-500 font-medium">Quick Scenarios</p>
            {[
              { label: 'All 10 (O)', val: 10 },
              { label: 'All 9 (A+)', val: 9 },
              { label: 'All 8 (A)', val: 8 },
              { label: 'Reset', val: null },
            ].map(({ label, val }) => (
              <motion.button
                key={label}
                whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                onClick={() => {
                  if (val === null) {
                    setWhatIfGPAs({});
                  } else {
                    const m: Record<string, number> = {};
                    semesters.forEach((s) => { m[s.id] = val; });
                    setWhatIfGPAs(m);
                  }
                }}
                className="w-full py-2 rounded-lg text-xs font-medium border border-black/10 text-slate-400 hover:bg-black/5 hover:text-black transition-colors cursor-pointer"
              >{label}</motion.button>
            ))}
          </Glass>

          <Glass className="p-4">
            <p className="text-xs text-slate-500 font-medium mb-2">💡 Insight</p>
            <p className="text-xs text-slate-300 leading-relaxed">{meta.tip}</p>
          </Glass>
        </div>
      </div>
    </div>
  );
}
