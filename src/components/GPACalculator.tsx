import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { nanoid } from 'nanoid';
import Glass from './Glass';
import CircleProgress from './CircleProgress';
import Pill from './Pill';
import CountUp from './CountUp';
import { type Subject, type GradeKey } from '../types';
import {
  calculateGPAWithFailed,
  GRADE_KEYS,
  GRADE_POINTS,
  PERFORMANCE_META,
  getPerformanceLevel,
} from '../lib/gpa';

const STORAGE_KEY = 'srm-gpa-subjects';

const defaultSubject = (): Subject => ({
  id: nanoid(),
  name: '',
  credits: '',
  grade: '',
});

const GRADE_COLORS: Record<string, string> = {
  O: '#a855f7', 'A+': '#3b82f6', A: '#06b6d4',
  'B+': '#10b981', B: '#84cc16', C: '#f59e0b', U: '#ef4444',
};

export default function GPACalculator() {
  const [subjects, setSubjects] = useState<Subject[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved) : [defaultSubject(), defaultSubject()];
    } catch {
      return [defaultSubject(), defaultSubject()];
    }
  });

  const gpa = calculateGPAWithFailed(subjects);
  const level = getPerformanceLevel(gpa);
  const meta = PERFORMANCE_META[level];

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(subjects));
  }, [subjects]);

  const updateSubject = useCallback((id: string, field: keyof Subject, val: string | number) => {
    setSubjects((prev) =>
      prev.map((s) => s.id === id ? { ...s, [field]: val } : s)
    );
  }, []);

  const addSubject = () => setSubjects((prev) => [...prev, defaultSubject()]);
  const removeSubject = (id: string) =>
    setSubjects((prev) => prev.length > 1 ? prev.filter((s) => s.id !== id) : prev);
  const reset = () => setSubjects([defaultSubject(), defaultSubject()]);

  // Grade distribution chart data
  const gradeCounts = GRADE_KEYS.reduce<Record<string, number>>((acc, g) => ({ ...acc, [g]: 0 }), {});
  for (const s of subjects) {
    if (s.grade && s.grade in gradeCounts) gradeCounts[s.grade]++;
  }
  const chartData = GRADE_KEYS.map((g) => ({ grade: g, count: gradeCounts[g] })).filter((d) => d.count > 0);

  const validCount = subjects.filter((s) => s.credits !== '' && s.grade).length;
  const totalCredits = subjects.reduce((sum, s) => sum + (s.credits === '' ? 0 : Number(s.credits)), 0);

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center space-y-2"
      >
        <h1 className="text-3xl md:text-4xl font-bold gradient-text">Semester GPA Calculator</h1>
        <p className="text-slate-400 text-sm">Add subjects, pick grades — your GPA updates instantly.</p>
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Subject Table */}
        <div className="lg:col-span-2 space-y-3">
          <Glass className="p-4 md:p-6">
            {/* Column headers */}
            <div className="grid grid-cols-[1fr_80px_110px_36px] gap-2 mb-3 px-1">
              <span className="text-xs text-slate-500 font-medium">Subject Name</span>
              <span className="text-xs text-slate-500 font-medium text-center">Credits</span>
              <span className="text-xs text-slate-500 font-medium text-center">Grade</span>
              <span />
            </div>

            <AnimatePresence initial={false}>
              {subjects.map((s, i) => (
                <motion.div
                  key={s.id}
                  initial={{ opacity: 0, x: -20, height: 0 }}
                  animate={{ opacity: 1, x: 0, height: 'auto' }}
                  exit={{ opacity: 0, x: 20, height: 0 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 40 }}
                  className="grid grid-cols-[1fr_80px_110px_36px] gap-2 mb-2 items-center"
                >
                  <input
                    type="text"
                    placeholder={`Subject ${i + 1}`}
                    value={s.name}
                    onChange={(e) => updateSubject(s.id, 'name', e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg"
                  />
                  <input
                    type="number"
                    min={1} max={5}
                    placeholder="Cr"
                    value={s.credits}
                    onChange={(e) => {
                      const v = e.target.value;
                      updateSubject(s.id, 'credits', v === '' ? '' : Math.min(5, Math.max(1, Number(v))));
                    }}
                    className="w-full px-2 py-2 text-sm text-center rounded-lg"
                  />
                  <select
                    value={s.grade}
                    onChange={(e) => updateSubject(s.id, 'grade', e.target.value as GradeKey)}
                    className="w-full px-2 py-2 text-sm rounded-lg"
                    style={{ color: s.grade ? GRADE_COLORS[s.grade] : undefined }}
                  >
                    <option value="">Grade</option>
                    {GRADE_KEYS.map((g) => (
                      <option key={g} value={g} style={{ color: GRADE_COLORS[g] }}>
                        {g} ({GRADE_POINTS[g]})
                      </option>
                    ))}
                  </select>
                  <motion.button
                    whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}
                    onClick={() => removeSubject(s.id)}
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
                onClick={addSubject}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium border border-purple-500/30 text-purple-400 hover:bg-purple-500/10 transition-colors cursor-pointer"
              >
                + Add Subject
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

          {/* Grade legend */}
          <Glass className="p-4">
            <p className="text-xs text-slate-500 mb-3 font-medium">Grade Point Reference</p>
            <div className="flex flex-wrap gap-2">
              {GRADE_KEYS.map((g) => (
                <Pill key={g} color={GRADE_COLORS[g]}>
                  {g} = {GRADE_POINTS[g]}
                </Pill>
              ))}
            </div>
          </Glass>

          {/* Chart */}
          {chartData.length > 0 && (
            <Glass className="p-4">
              <p className="text-xs text-slate-500 mb-3 font-medium">Grade Distribution</p>
              <ResponsiveContainer width="100%" height={120}>
                <BarChart data={chartData} barSize={32}>
                  <XAxis dataKey="grade" tick={{ fill: '#94a3b8', fontSize: 12 }} axisLine={false} tickLine={false} />
                  <YAxis hide allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#e2e8f0' }}
                    cursor={{ fill: 'rgba(255,255,255,0.03)' }}
                  />
                  <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                    {chartData.map((entry) => (
                      <Cell key={entry.grade} fill={GRADE_COLORS[entry.grade] ?? '#a855f7'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Glass>
          )}
        </div>

        {/* Right panel */}
        <div className="space-y-4">
          {/* GPA Ring */}
          <Glass className="p-6 flex flex-col items-center gap-4">
            <p className="text-xs text-slate-500 font-medium uppercase tracking-widest">Your GPA</p>
            <CircleProgress
              value={gpa}
              size={160}
              color={meta.color}
              label={gpa > 0 ? gpa.toFixed(2) : '–'}
              sublabel="/ 10.0"
            />
            <Pill color={meta.color}>{meta.emoji} {meta.label}</Pill>
            <div className="text-center space-y-1">
              <p className="text-xs text-slate-500">{validCount} subject{validCount !== 1 ? 's' : ''} · {totalCredits} credits</p>
            </div>
          </Glass>

          {/* Stats */}
          <Glass className="p-4 space-y-3">
            <StatRow label="GPA" value={<CountUp value={gpa} />} color={meta.color} />
            <StatRow label="Percentage" value={<CountUp value={Math.max(0, gpa * 10 - 7.5)} />} color={meta.color} suffix="%" />
            <StatRow label="Total Credits" value={<span>{totalCredits}</span>} color="#06b6d4" />
          </Glass>

          {/* Study tip */}
          <Glass className="p-4">
            <p className="text-xs text-slate-500 font-medium mb-2">💡 Study Tip</p>
            <p className="text-sm text-slate-300 leading-relaxed">{meta.tip}</p>
          </Glass>
        </div>
      </div>
    </div>
  );
}

function StatRow({ label, value, color, suffix }: { label: string; value: React.ReactNode; color: string; suffix?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-slate-400">{label}</span>
      <span className="text-sm font-bold" style={{ color }}>
        {value}{suffix}
      </span>
    </div>
  );
}
