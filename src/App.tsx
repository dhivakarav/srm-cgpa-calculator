import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import ParticleBackground from './components/ParticleBackground';
import Navbar, { type Tab } from './components/Navbar';
import GPACalculator from './components/GPACalculator';
import CGPACalculator from './components/CGPACalculator';
import AIScanner from './components/AIScanner';
import Predictor from './components/Predictor';
import WelcomeModal from './components/WelcomeModal';

export default function App() {
  const [tab, setTab] = useState<Tab>('gpa');
  const [showWelcome, setShowWelcome] = useState(true);

  return (
    <div className="relative min-h-screen">
      <ParticleBackground />

      <AnimatePresence>
        {showWelcome && (
          <WelcomeModal onClose={() => setShowWelcome(false)} onChoose={setTab} />
        )}
      </AnimatePresence>

      {/* Background gradients */}
      <div className="fixed inset-0 pointer-events-none" style={{ zIndex: 0 }}>
        <div className="absolute top-0 left-1/4 w-96 h-96 rounded-full opacity-[0.025]"
          style={{ background: 'radial-gradient(circle, #0a0a0a, transparent)' }} />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 rounded-full opacity-[0.02]"
          style={{ background: 'radial-gradient(circle, #0a0a0a, transparent)' }} />
      </div>

      <div className="relative flex min-h-screen flex-col" style={{ zIndex: 1 }}>
        <Navbar activeTab={tab} onChange={setTab} />

        <main className="flex-1 w-full">
          <AnimatePresence mode="wait">
            {tab === 'gpa' && (
              <motion.div key="gpa" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }} transition={{ duration: 0.25 }}>
                <GPACalculator />
              </motion.div>
            )}
            {tab === 'scanner' && (
              <motion.div key="scanner" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }} transition={{ duration: 0.25 }}>
                <AIScanner />
              </motion.div>
            )}
            
          </AnimatePresence>
        </main>

        {tab !== 'scanner' && (
        <footer className="border-t border-black/[0.06] py-6 text-center">
          <p className="text-xs text-slate-600">
            SRM GPA & CGPA Calculator · 100% offline, no data leaves your browser
          </p>
          <p className="text-xs text-slate-700 mt-1">
            SRM IST grading system: O=10, A+=9, A=8, B+=7, B=6, C=5, U=0
          </p>
        </footer>
        )}
      </div>
    </div>
  );
}
