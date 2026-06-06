import { motion } from 'framer-motion';

export type Tab = 'gpa' | 'cgpa' | 'scanner' | 'predictor';

interface NavbarProps {
  activeTab: Tab;
  onChange: (tab: Tab) => void;
}

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'gpa', label: 'GPA Calc', icon: '📊' },
  { id: 'cgpa', label: 'CGPA Calc', icon: '🎓' },
  { id: 'scanner', label: 'AI Scanner', icon: '🤖' },
  { id: 'predictor', label: 'Predictor', icon: '🔮' },
];

export default function Navbar({ activeTab, onChange }: NavbarProps) {
  return (
    <header className="sticky top-0 z-50 w-full">
      <div
        className="glass border-b border-black/[0.06]"
        style={{ backdropFilter: 'blur(24px)' }}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between gap-4">
          {/* Logo */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center text-base"
              style={{
                background: '#0a0a0a',
                boxShadow: '0 0 16px rgba(0,0,0,0.4)',
              }}>
              🎓
            </div>
            <div className="hidden sm:block">
              <div className="text-sm font-bold text-black leading-none">SRM</div>
              <div className="text-[10px] text-slate-500 leading-none">GPA Calculator</div>
            </div>
          </div>

          {/* Tabs */}
          <nav className="flex items-center gap-1 bg-black/[0.03] rounded-xl p-1 border border-black/[0.06]">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => onChange(tab.id)}
                aria-label={tab.label}
                className="relative px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-medium transition-colors outline-none cursor-pointer"
                style={{ color: activeTab === tab.id ? '#fff' : 'rgba(0,0,0,0.5)' }}
              >
                {activeTab === tab.id && (
                  <motion.div
                    layoutId="tab-bg"
                    className="absolute inset-0 rounded-lg"
                    style={{ background: '#0a0a0a', border: '1px solid rgba(0,0,0,0.3)' }}
                    transition={{ type: 'spring', stiffness: 500, damping: 40 }}
                  />
                )}
                <span className="relative z-10 flex items-center gap-1.5">
                  <span>{tab.icon}</span>
                  <span className="hidden md:inline">{tab.label}</span>
                </span>
              </button>
            ))}
          </nav>

          {/* Badge */}
          <div className="hidden md:flex items-center gap-1.5 text-[10px] text-slate-500 flex-shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-black animate-pulse" />
            100% Offline
          </div>
        </div>
      </div>
    </header>
  );
}
