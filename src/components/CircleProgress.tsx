import { motion } from 'framer-motion';

interface CircleProgressProps {
  value: number; // 0–10
  size?: number;
  strokeWidth?: number;
  color?: string;
  label?: string;
  sublabel?: string;
}

export default function CircleProgress({
  value,
  size = 160,
  strokeWidth = 10,
  color = '#a855f7',
  label,
  sublabel,
}: CircleProgressProps) {
  const r = (size - strokeWidth) / 2;
  const circ = 2 * Math.PI * r;
  const pct = Math.min(value / 10, 1);
  const dash = pct * circ;

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none"
          stroke="rgba(255,255,255,0.06)"
          strokeWidth={strokeWidth}
        />
        <motion.circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circ}
          initial={{ strokeDashoffset: circ }}
          animate={{ strokeDashoffset: circ - dash }}
          transition={{ duration: 1.4, ease: [0.34, 1.56, 0.64, 1] }}
          style={{
            filter: `drop-shadow(0 0 8px ${color}80)`,
          }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {label && (
          <span className="text-2xl font-bold text-white" style={{ textShadow: `0 0 20px ${color}` }}>
            {label}
          </span>
        )}
        {sublabel && <span className="text-xs text-slate-400 mt-0.5">{sublabel}</span>}
      </div>
    </div>
  );
}
