import { motion, type HTMLMotionProps } from 'framer-motion';
import { type ReactNode } from 'react';

interface GlassProps extends HTMLMotionProps<'div'> {
  children: ReactNode;
  className?: string;
  hover?: boolean;
}

export default function Glass({ children, className = '', hover = false, ...props }: GlassProps) {
  return (
    <motion.div
      className={`glass rounded-2xl ${className}`}
      whileHover={hover ? { scale: 1.01, borderColor: 'rgba(0,0,0,0.25)' } : undefined}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
      {...props}
    >
      {children}
    </motion.div>
  );
}
