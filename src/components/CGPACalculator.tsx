import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, ReferenceLine,
} from 'recharts';
import { nanoid } from 'nanoid';
import Glass from './Glass';
import Pill from './Pill';
import CountUp from './CountUp';
import { type Semester } from '../types';
import { calculateCGPA, cgpaToPercentage, getPerformanceLevel, PERFORMANCE_META } from '../lib/gpa';

const STORAGE_KEY = 'srm-cgpa-semesters';

const defaultSem = (i: number): Semester => ({
  id: nanoid(),
  label: `Semester ${i}`,
  gpa: '',
  credits: '',
});

export default function CGPACalculator() {
  const [semesters, setSemesters] = useState<Semester[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved) : [defaultSem(1), defaultSem(2)];
    } catch {
      return [defaultSem(1), defaultSem(2)];
    }
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(semesters));
  }, [semesters]);

  const cgpa = calculateCGPA(semesters);
  const percentage = cgpaToPercentage(cgpa);
  const level = getPerformanceLevel(cgpa);
  const meta = PERFORMANCE_META[level];

  const update = useCallback((id: string, field: 'label' | 'gpa' | 'credits', val: string) => {
    setSemesters((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s;
        if (field === 'label') return { ...s, label: val };
        const num = val === '' ? '' : parseFloat(val);
        return { ...s, [field]: num };
      })
    );
  }, []);

  const addSem = () =>
    setSemesters((prev) => [...prev, defaultSem(prev.length + 1)]);

  const removeSem = (id: string) =>
    setSemesters((prev) => prev.length > 1 ? prev.filter((s) => s.id !== id) : prev);

  const reset = () => setSemesters([defaultSem(1), defaultSem(2)]);

  const validSems = semesters.filter((s) => s.gpa !== '' && s.credits !== '');
  const totalCredits = validSems.reduce((sum, s) => sum + Number(s.credits), 0);

  const chartData = semesters.map((s, i) => ({
    name: s.label || `Sem ${i + 1}`,
    gpa: s.gpa === '' ? null : Number(s.gpa),
    cgpa: calculateCGPA(semesters.slice(0, i + 1)),
  }));

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center space-y-2"
      >
        <h1 className="text-3xl md:text-4xl font-bold gradient-text">CGPA Calculator</h1>
        <p className="text-slate-400 text-sm">Enter your semester GPAs to compute your cumulative CGPA.</p>
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Semester table */}
        <div className="lg:col-span-2 space-y-4">
          <Glass className="p-4 md:p-6">
            <div className="grid grid-cols-[1fr_100px_100px_36px] gap-2 mb-3 px-1">
              <span className="text-xs text-slate-500 font-medium">Semester</span>
              <span className="text-xs text-slate-500 font-medium text-center">GPA</span>
              <span className="text-xs text-slate-500 font-medium text-center">Credits</span>
              <span />
            </div>

            <AnimatePresence initial={false}>
              {semesters.map((s) => (
                <motion.div
                  key={s.id}
                  initial={{ opacity: 0, x: -20, height: 0 }}
                  animate={{ opacity: 1, x: 0, height: 'auto' }}
                  exit={{ opacity: 0, x: 20, height: 0 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 40 }}
                  className="grid grid-cols-[1fr_100px_100px_36px] gap-2 mb-2 items-center"
                >
                  <input
                    type="text"
                    value={s.label}
                    onChange={(e) => update(s.id, 'label', e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg"
                  />
                  <input
                    type="number"
                    min={0} max={10} step={0.01}
                    placeholder="GPA"
                    value={s.gpa}
                    onChange={(e) => update(s.id, 'gpa', e.target.value)}
                    className="w-full px-2 py-2 text-sm text-center rounded-lg"
                  />
                  <input
                    type="number"
                    min={1} max={30}
                    placeholder="Cr"
                    value={s.credits}
                    onChange={(e) => update(s.id, 'credits', e.target.value)}
                    className="w-full px-2 py-2 text-sm text-center rounded-lg"
                  />
                  <motion.button
                    whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}
                    onClick={() => removeSem(s.id)}
                    className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
                  >
                    ×
                  </motion.button>
                </motion.div>
              ))}
            </AnimatePresence>

            <div className="flex gap-3 mt-4">
              <motion.button
                whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                onClick={addSem}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium border border-purple-500/30 text-purple-400 hover:bg-purple-500/10 transition-colors cursor-pointer"
              >
                + Add Semester
              </motion.button>
              <motion.button
                whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                onClick={reset}
                className="px-4 py-2.5 rounded-xl text-sm font-medium border border-white/10 text-slate-400 hover:bg-white/5 transition-colors cursor-pointer"
              >
                Reset
              </motion.button>
            </div>
          </Glass>

          {/* Chart */}
          {validSems.length >= 2 && (
            <Glass className="p-4">
              <p className="text-xs text-slate-500 mb-4 font-medium">CGPA Growth Trend</p>
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                  <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis domain={[0, 10]} tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={{ background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#e2e8f0', fontSize: 12 }}
                    cursor={{ stroke: 'rgba(255,255,255,0.1)' }}
                  />
                  <ReferenceLine y={8.5} stroke="rgba(168,85,247,0.3)" strokeDasharray="4 4" />
                  <Line
                    type="monotone" dataKey="gpa" name="Sem GPA"
                    stroke="#3b82f6" strokeWidth={2} dot={{ fill: '#3b82f6', r: 4 }}
                    connectNulls
                    animationDuration={1000}
                  />
                  <Line
                    type="monotone" dataKey="cgpa" name="CGPA"
                    stroke="#a855f7" strokeWidth={2.5} dot={{ fill: '#a855f7', r: 4 }}
                    animationDuration={1200}
                  />
                </LineChart>
              </ResponsiveContainer>
              <div className="flex gap-4 mt-2 justify-center">
                <LegendDot color="#3b82f6" label="Sem GPA" />
                <LegendDot color="#a855f7" label="CGPA" />
              </div>
            </Glass>
          )}
        </div>

        {/* Stats panel */}
        <div className="space-y-4">
          <Glass className="p-6 text-center space-y-3">
            <p className="text-xs text-slate-500 font-medium uppercase tracking-widest">Cumulative CGPA</p>
            <div
              className="text-6xl font-black"
              style={{ color: meta.color, textShadow: `0 0 40px ${meta.color}60` }}
            >
              <CountUp value={cgpa} decimals={2} />
            </div>
            <Pill color={meta.color}>{meta.emoji} {meta.label}</Pill>
          </Glass>

          <div className="grid grid-cols-2 gap-3">
            <StatCard label="Percentage" value={percentage > 0 ? percentage.toFixed(1) + '%' : '–'} color="#06b6d4" />
            <StatCard label="Total Credits" value={totalCredits > 0 ? String(totalCredits) : '–'} color="#10b981" />
            <StatCard label="Semesters" value={String(validSems.length)} color="#f59e0b" />
            <StatCard label="Best GPA" value={validSems.length ? Math.max(...validSems.map((s) => Number(s.gpa))).toFixed(2) : '–'} color="#a855f7" />
          </div>

          <Glass className="p-4">
            <p className="text-xs text-slate-500 font-medium mb-2">💡 Tip</p>
            <p className="text-sm text-slate-300 leading-relaxed">{meta.tip}</p>
          </Glass>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <Glass className="p-3 text-center hover:border-white/[0.12] transition-colors" hover>
      <p className="text-xs text-slate-500 mb-1">{label}</p>
      <p className="text-lg font-bold" style={{ color }}>{value}</p>
    </Glass>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-3 h-3 rounded-full" style={{ background: color }} />
      <span className="text-xs text-slate-400">{label}</span>
    </div>
  );
}
