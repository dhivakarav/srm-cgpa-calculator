import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis,
  Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import Glass from './Glass';
import Pill from './Pill';
import CountUp from './CountUp';
import { type Subject, type Semester } from '../types';
import {
  calculateCGPA, calculateGPAWithFailed, cgpaToPercentage,
  getPerformanceLevel, PERFORMANCE_META, GRADE_KEYS, GRADE_POINTS,
} from '../lib/gpa';

interface Props {
  subjects: Subject[];
  semesters: Semester[];
  onBack?: () => void;
  onReset?: () => void;
}

const GRADE_COLORS: Record<string, string> = {
  O: '#0a0a0a', 'A+': '#0a0a0a', A: '#0a0a0a',
  'B+': '#0a0a0a', B: '#0a0a0a', C: '#0a0a0a', U: '#0a0a0a',
};

function useConfetti(trigger: boolean) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!trigger) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const particles = Array.from({ length: 120 }, () => ({
      x: Math.random() * canvas.width,
      y: -10,
      vx: (Math.random() - 0.5) * 4,
      vy: Math.random() * 4 + 2,
      color: ['#0a0a0a', '#0a0a0a', '#0a0a0a', '#0a0a0a', '#0a0a0a', '#0a0a0a'][Math.floor(Math.random() * 6)],
      size: Math.random() * 6 + 4,
      rotation: Math.random() * 360,
      rotSpeed: (Math.random() - 0.5) * 8,
    }));

    let animId: number;
    let tick = 0;
    const draw = () => {
      tick++;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.08;
        p.rotation += p.rotSpeed;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate((p.rotation * Math.PI) / 180);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = Math.max(0, 1 - tick / 180);
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size / 2);
        ctx.restore();
      }
      if (tick < 180) animId = requestAnimationFrame(draw);
      else ctx.clearRect(0, 0, canvas.width, canvas.height);
    };
    animId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animId);
  }, [trigger]);
  return canvasRef;
}

export default function ResultDashboard({ subjects, semesters, onBack, onReset }: Props) {
  const [showModal, setShowModal] = useState(true);
  const [whatIfGPAs, setWhatIfGPAs] = useState<Record<number, number>>({});

  const gpa = calculateGPAWithFailed(subjects);
  const cgpa = calculateCGPA(semesters.length > 0 ? semesters : [{ id: '0', label: 'S1', gpa, credits: subjects.reduce((s, x) => s + (x.credits === '' ? 0 : Number(x.credits)), 0) }]);
  const percentage = cgpaToPercentage(cgpa > 0 ? cgpa : gpa);
  const level = getPerformanceLevel(cgpa > 0 ? cgpa : gpa);
  const meta = PERFORMANCE_META[level];
  const confettiRef = useConfetti(showModal);

  // Grade distribution
  const gradeCounts = GRADE_KEYS.reduce<Record<string, number>>((a, g) => ({ ...a, [g]: 0 }), {});
  for (const s of subjects) if (s.grade) gradeCounts[s.grade]++;
  const pieData = GRADE_KEYS.map((g) => ({ name: g, value: gradeCounts[g] })).filter((d) => d.value > 0);

  // Semester chart
  const semChartData = semesters
    .filter((s) => s.gpa !== '' && s.credits !== '')
    .map((s, i) => ({
      name: s.label || `Sem ${i + 1}`,
      gpa: Number(s.gpa),
    }));

  // What-if predictor semesters
  const whatIfSemesters = semesters.map((s, i) =>
    i in whatIfGPAs ? { ...s, gpa: whatIfGPAs[i] } : s
  );
  const whatIfCGPA = calculateCGPA(whatIfSemesters.length > 0 ? whatIfSemesters : semesters);

  const targets = [8.5, 9.0, 9.5];

  return (
    <>
      {/* Confetti */}
      <canvas ref={confettiRef} className="confetti-canvas" />

      {/* Result Modal */}
      <AnimatePresence>
        {showModal && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(12px)' }}
            onClick={() => setShowModal(false)}
          >
            <motion.div
              initial={{ scale: 0.7, opacity: 0, y: 40 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.85, opacity: 0, y: -20 }}
              transition={{ type: 'spring', stiffness: 300, damping: 25 }}
              onClick={(e) => e.stopPropagation()}
              className="relative w-full max-w-md"
            >
              <Glass className="p-8 text-center space-y-5 border-black/30">
                {/* Glow */}
                <div className="absolute inset-0 rounded-2xl pointer-events-none" style={{ background: `radial-gradient(ellipse at 50% 0%, ${meta.color}20, transparent 60%)` }} />
                <h2 className="text-2xl font-black text-black">Congratulations!</h2>
                <Pill color={meta.color} className="text-sm">{meta.label}</Pill>

                <div className="grid grid-cols-3 gap-4 my-2">
                  <div>
                    <p className="text-xs text-slate-500 mb-1">GPA</p>
                    <p className="text-2xl font-black" style={{ color: meta.color }}>
                      <CountUp value={gpa} />
                    </p>
                  </div>
                  {cgpa > 0 && (
                    <div>
                      <p className="text-xs text-slate-500 mb-1">CGPA</p>
                      <p className="text-2xl font-black" style={{ color: '#0a0a0a' }}>
                        <CountUp value={cgpa} />
                      </p>
                    </div>
                  )}
                  <div>
                    <p className="text-xs text-slate-500 mb-1">%</p>
                    <p className="text-2xl font-black" style={{ color: '#0a0a0a' }}>
                      <CountUp value={Math.max(0, percentage)} />
                    </p>
                  </div>
                </div>

                <motion.button
                  whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
                  onClick={() => setShowModal(false)}
                  className="w-full py-3 rounded-xl font-bold text-white text-sm cursor-pointer"
                  style={{ background: `linear-gradient(135deg, ${meta.color}, #0a0a0a)` }}
                >
                  View Full Dashboard →
                </motion.button>
              </Glass>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Dashboard */}
      <div className="space-y-6">
        {/* Stat cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Semester GPA', value: gpa.toFixed(2), color: meta.color, icon: '' },
            { label: 'CGPA', value: (cgpa > 0 ? cgpa : gpa).toFixed(2), color: '#0a0a0a', icon: '' },
            { label: 'Percentage', value: `${Math.max(0, percentage).toFixed(1)}%`, color: '#0a0a0a', icon: '' },
            { label: 'Performance', value: meta.label, color: meta.color, icon: meta.emoji },
          ].map((card) => (
            <Glass key={card.label} className="p-4 text-center" hover>
              <p className="text-xs text-slate-500 mb-1">{card.label}</p>
              <p className="font-bold text-sm" style={{ color: card.color }}>{card.value}</p>
            </Glass>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Grade Distribution Pie */}
          {pieData.length > 0 && (
            <Glass className="p-5">
              <p className="text-xs text-slate-500 font-medium mb-4">Grade Distribution</p>
              <div className="flex items-center gap-4">
                <ResponsiveContainer width={160} height={160}>
                  <PieChart>
                    <Pie data={pieData} cx="50%" cy="50%" innerRadius={45} outerRadius={72} dataKey="value" paddingAngle={2} animationBegin={0} animationDuration={1000}>
                      {pieData.map((entry) => (
                        <Cell key={entry.name} fill={GRADE_COLORS[entry.name] ?? '#0a0a0a'} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ background: '#ffffff', border: '1px solid rgba(0,0,0,0.1)', borderRadius: 8, fontSize: 12, color: '#0a0a0a' }} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex-1 space-y-1.5">
                  {pieData.map((d) => (
                    <div key={d.name} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: GRADE_COLORS[d.name] }} />
                        <span className="text-slate-300">{d.name} ({GRADE_POINTS[d.name as keyof typeof GRADE_POINTS]})</span>
                      </div>
                      <span className="text-slate-400">{d.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </Glass>
          )}

          {/* Semester trend */}
          {semChartData.length >= 2 && (
            <Glass className="p-5">
              <p className="text-xs text-slate-500 font-medium mb-4">Semester GPA Trend</p>
              <ResponsiveContainer width="100%" height={160}>
                <LineChart data={semChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.04)" />
                  <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis domain={[0, 10]} tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ background: '#ffffff', border: '1px solid rgba(0,0,0,0.1)', borderRadius: 8, color: '#0a0a0a', fontSize: 12 }} />
                  <Line type="monotone" dataKey="gpa" stroke="#0a0a0a" strokeWidth={2.5} dot={{ fill: '#0a0a0a', r: 4 }} animationDuration={1000} />
                </LineChart>
              </ResponsiveContainer>
            </Glass>
          )}
        </div>

        {/* What-If Predictor */}
        {semesters.length > 0 && (
          <Glass className="p-5">
            <p className="text-xs text-slate-500 font-medium mb-1">What-If Predictor</p>
            <p className="text-[11px] text-slate-600 mb-4">Drag sliders to see how improving a semester changes your CGPA</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-3">
                {semesters.filter((s) => s.gpa !== '' && s.credits !== '').map((s, i) => {
                  const current = Number(s.gpa);
                  const whatIf = whatIfGPAs[i] ?? current;
                  return (
                    <div key={s.id}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-slate-400">{s.label}</span>
                        <span className="text-purple-400 font-medium">{whatIf.toFixed(2)}</span>
                      </div>
                      <input
                        type="range" min={0} max={10} step={0.1}
                        value={whatIf}
                        onChange={(e) => setWhatIfGPAs((prev) => ({ ...prev, [i]: parseFloat(e.target.value) }))}
                        className="w-full accent-black cursor-pointer"
                      />
                    </div>
                  );
                })}
              </div>
              <div className="flex flex-col items-center justify-center gap-3 p-4 rounded-xl bg-black/[0.03] border border-black/[0.06]">
                <p className="text-xs text-slate-500">Predicted CGPA</p>
                <p className="text-4xl font-black" style={{ color: '#0a0a0a', textShadow: '0 0 30px rgba(0,0,0,0.5)' }}>
                  {whatIfCGPA.toFixed(2)}
                </p>
                {whatIfCGPA !== cgpa && (
                  <Pill color={whatIfCGPA > cgpa ? '#0a0a0a' : '#0a0a0a'}>
                    {whatIfCGPA > cgpa ? '+' : ''}{(whatIfCGPA - cgpa).toFixed(2)} vs current
                  </Pill>
                )}
                <div className="w-full space-y-2 mt-2">
                  {targets.map((t) => {
                    const prog = Math.min((whatIfCGPA / t) * 100, 100);
                    return (
                      <div key={t}>
                        <div className="flex justify-between text-[10px] mb-0.5">
                          <span className="text-slate-500">Target {t}</span>
                          <span className="text-slate-400">{prog.toFixed(0)}%</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-black/[0.06] overflow-hidden">
                          <motion.div
                            className="h-full rounded-full"
                            style={{ background: prog >= 100 ? '#0a0a0a' : 'linear-gradient(90deg,#0a0a0a,#0a0a0a)' }}
                            animate={{ width: `${prog}%` }}
                            transition={{ duration: 0.5 }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </Glass>
        )}

        {/* Action buttons */}
        <div className="flex gap-3 flex-wrap">
          {onBack && (
            <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={onBack}
              className="px-4 py-2.5 rounded-xl text-sm font-medium border border-black/10 text-slate-400 hover:bg-black/5 transition-colors cursor-pointer">
              ← Edit Data
            </motion.button>
          )}
          {onReset && (
            <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={onReset}
              className="px-4 py-2.5 rounded-xl text-sm font-medium border border-black/10 text-slate-400 hover:bg-black/5 transition-colors cursor-pointer">
              Start Over
            </motion.button>
          )}
          <motion.button
            whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
            onClick={() => setShowModal(true)}
            className="px-4 py-2.5 rounded-xl text-sm font-medium border border-black/30 text-purple-400 hover:bg-black/10 transition-colors cursor-pointer">
            Show Result Card
          </motion.button>
        </div>
      </div>
    </>
  );
}
