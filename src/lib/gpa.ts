import type { GradeKey, PerformanceLevel, Subject, Semester } from '../types';

export const GRADE_POINTS: Record<Exclude<GradeKey, ''>, number> = {
  O: 10,
  'A+': 9,
  A: 8,
  'B+': 7,
  B: 6,
  C: 5,
  U: 0,
};

export const GRADE_KEYS: Exclude<GradeKey, ''>[] = ['O', 'A+', 'A', 'B+', 'B', 'C', 'U'];

export function gradeToPoint(grade: GradeKey): number {
  if (!grade) return 0;
  return GRADE_POINTS[grade as Exclude<GradeKey, ''>] ?? 0;
}

export function calculateGPA(subjects: Subject[]): number {
  let totalWeighted = 0;
  let totalCredits = 0;
  for (const s of subjects) {
    if (!s.grade || s.credits === '' || s.grade === 'U') {
      if (s.grade === 'U' && s.credits !== '') {
        totalCredits += Number(s.credits);
      }
      continue;
    }
    const c = Number(s.credits);
    if (c <= 0) continue;
    totalWeighted += c * gradeToPoint(s.grade);
    totalCredits += c;
  }
  if (totalCredits === 0) return 0;
  return Math.round((totalWeighted / totalCredits) * 100) / 100;
}

export function calculateGPAWithFailed(subjects: Subject[]): number {
  let totalWeighted = 0;
  let totalCredits = 0;
  for (const s of subjects) {
    if (!s.grade || s.credits === '') continue;
    const c = Number(s.credits);
    if (c <= 0) continue;
    totalWeighted += c * gradeToPoint(s.grade);
    totalCredits += c;
  }
  if (totalCredits === 0) return 0;
  return Math.round((totalWeighted / totalCredits) * 100) / 100;
}

export function calculateCGPA(semesters: Semester[]): number {
  let totalWeighted = 0;
  let totalCredits = 0;
  for (const s of semesters) {
    if (s.gpa === '' || s.credits === '') continue;
    const c = Number(s.credits);
    const g = Number(s.gpa);
    if (c <= 0 || g < 0 || g > 10) continue;
    totalWeighted += c * g;
    totalCredits += c;
  }
  if (totalCredits === 0) return 0;
  return Math.round((totalWeighted / totalCredits) * 100) / 100;
}

export function cgpaToPercentage(cgpa: number): number {
  return Math.round((cgpa * 10 - 7.5) * 100) / 100;
}

export function getPerformanceLevel(gpa: number): PerformanceLevel {
  if (gpa >= 9.5) return 'outstanding';
  if (gpa >= 8.5) return 'excellent';
  if (gpa >= 7.0) return 'good';
  return 'needs-improvement';
}

export const PERFORMANCE_META: Record<
  PerformanceLevel,
  { label: string; emoji: string; color: string; gradient: string; tip: string }
> = {
  outstanding: {
    label: 'Outstanding',
    emoji: '',
    color: '#0a0a0a',
    gradient: 'from-neutral-900 to-neutral-700',
    tip: 'Phenomenal work! You\'re in the top tier. Consider research internships or higher studies abroad.',
  },
  excellent: {
    label: 'Excellent',
    emoji: '',
    color: '#262626',
    gradient: 'from-neutral-800 to-neutral-600',
    tip: 'Great performance! Push for a 9.5+ by targeting O grades in your strongest subjects.',
  },
  good: {
    label: 'Good Progress',
    emoji: '',
    color: '#404040',
    gradient: 'from-neutral-700 to-neutral-500',
    tip: 'Solid foundation. Focus on upgrading B+ and B grades to A and A+ to jump into Excellent.',
  },
  'needs-improvement': {
    label: 'Needs Improvement',
    emoji: '',
    color: '#525252',
    gradient: 'from-neutral-600 to-neutral-400',
    tip: 'Don\'t worry — consistency beats intensity. Aim to clear arrears and target at least C in all subjects.',
  },
};

export function predictCGPA(
  currentSemesters: Semester[],
  targetSemIndex: number,
  newGPA: number
): number {
  const updated = currentSemesters.map((s, i) =>
    i === targetSemIndex ? { ...s, gpa: newGPA } : s
  );
  return calculateCGPA(updated);
}

export function semestersNeededForTarget(
  currentSemesters: Semester[],
  targetCGPA: number,
  avgCreditsPerSem: number
): number | null {
  const current = calculateCGPA(currentSemesters);
  if (current >= targetCGPA) return 0;
  const totalCredits = currentSemesters.reduce(
    (sum, s) => sum + (s.credits === '' ? 0 : Number(s.credits)),
    0
  );
  const totalWeighted = current * totalCredits;
  // Solve: (totalWeighted + n * avgCreditsPerSem * 10) / (totalCredits + n * avgCreditsPerSem) >= targetCGPA
  // n >= (targetCGPA * totalCredits - totalWeighted) / (avgCreditsPerSem * (10 - targetCGPA))
  const denom = avgCreditsPerSem * (10 - targetCGPA);
  if (denom <= 0) return null;
  const n = (targetCGPA * totalCredits - totalWeighted) / denom;
  return Math.ceil(Math.max(0, n));
}
