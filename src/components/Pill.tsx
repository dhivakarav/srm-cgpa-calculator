import { type ReactNode } from 'react';

interface PillProps {
  children: ReactNode;
  color?: string;
  className?: string;
}

export default function Pill({ children, color = '#0a0a0a', className = '' }: PillProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold ${className}`}
      style={{
        background: `${color}20`,
        border: `1px solid ${color}40`,
        color,
      }}
    >
      {children}
    </span>
  );
}
