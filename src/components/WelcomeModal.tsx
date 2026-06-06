import { useEffect } from 'react';
import { motion } from 'framer-motion';
import type { Tab } from './Navbar';

interface WelcomeModalProps {
  onClose: () => void;
  onChoose: (tab: Tab) => void;
}

export default function WelcomeModal({ onClose, onChoose }: WelcomeModalProps) {
  // Dismiss on Escape, and lock body scroll while open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const go = (tab: Tab) => {
    onChoose(tab);
    onClose();
  };

  return (
    <motion.div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      onClick={onClose}
      style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(6px)' }}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby="welcome-title"
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.9, y: 24 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 12 }}
        transition={{ type: 'spring', stiffness: 320, damping: 26 }}
        className="glass relative w-full max-w-lg rounded-3xl p-8 sm:p-10 text-center overflow-hidden"
        style={{
          border: '1px solid rgba(0,0,0,0.14)',
          boxShadow: '0 24px 80px rgba(0,0,0,0.22)',
        }}
      >
        {/* Glow accents */}
        <div className="absolute -top-24 -left-20 w-64 h-64 rounded-full pointer-events-none opacity-[0.04]"
          style={{ background: 'radial-gradient(circle, #0a0a0a, transparent 70%)' }} />
        <div className="absolute -bottom-24 -right-20 w-64 h-64 rounded-full pointer-events-none opacity-[0.03]"
          style={{ background: 'radial-gradient(circle, #0a0a0a, transparent 70%)' }} />

        {/* Close button */}
        <motion.button
          onClick={onClose}
          aria-label="Close"
          whileHover={{ scale: 1.1, rotate: 90 }}
          whileTap={{ scale: 0.9 }}
          transition={{ type: 'spring', stiffness: 400, damping: 18 }}
          className="absolute top-4 right-4 w-9 h-9 rounded-full flex items-center justify-center text-slate-500 hover:text-black cursor-pointer z-10"
          style={{ background: 'rgba(0,0,0,0.04)', border: '1px solid rgba(0,0,0,0.12)' }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </motion.button>

        <div className="relative z-10">
          {/* Logo badge */}
          <motion.div
            initial={{ scale: 0, rotate: -20 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 18, delay: 0.1 }}
            className="mx-auto mb-5 w-16 h-16 rounded-2xl flex items-center justify-center text-3xl"
            style={{
              background: '#0a0a0a',
              boxShadow: '0 8px 20px rgba(0,0,0,0.25)',
            }}
          >
            🎓
          </motion.div>

          <p className="text-xs font-semibold tracking-[0.2em] uppercase text-purple-400 mb-2">
            Welcome to
          </p>
          <h2 id="welcome-title" className="gradient-text text-3xl sm:text-4xl font-extrabold leading-tight mb-3">
            SRM CGPA Calculator
          </h2>
          <p className="text-sm text-slate-400 max-w-sm mx-auto mb-8">
            Calculate your GPA &amp; CGPA instantly, or just upload a screenshot of your
            marksheet and let the AI scanner read your grades — 100% offline.
          </p>

          {/* Action buttons */}
          <div className="flex flex-col gap-3">
            <motion.button
              onClick={() => go('cgpa')}
              whileHover={{ scale: 1.03, boxShadow: '0 12px 36px rgba(0,0,0,0.45)' }}
              whileTap={{ scale: 0.97 }}
              transition={{ type: 'spring', stiffness: 400, damping: 22 }}
              className="w-full py-3.5 rounded-2xl font-bold text-white text-base cursor-pointer flex items-center justify-center gap-2"
              style={{
                background: '#0a0a0a',
                boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
              }}
            >
              <span className="text-lg">🎯</span> Calculate your CGPA
            </motion.button>

            <motion.button
              onClick={() => go('scanner')}
              whileHover={{ scale: 1.03, borderColor: 'rgba(0,0,0,0.6)', backgroundColor: 'rgba(0,0,0,0.10)' }}
              whileTap={{ scale: 0.97 }}
              transition={{ type: 'spring', stiffness: 400, damping: 22 }}
              className="w-full py-3.5 rounded-2xl font-bold text-base cursor-pointer flex items-center justify-center gap-2 text-black"
              style={{
                background: '#ffffff',
                border: '1px solid rgba(0,0,0,0.18)',
              }}
            >
              <span className="text-lg">📸</span> Upload your Screenshot
            </motion.button>
          </div>

          {/* Back / dismiss link */}
          <motion.button
            onClick={onClose}
            whileHover={{ color: '#0a0a0a' }}
            className="mt-6 text-xs font-medium text-slate-500 hover:text-black cursor-pointer"
          >
            ← Maybe later
          </motion.button>
        </div>
      </motion.div>
    </motion.div>
  );
}
