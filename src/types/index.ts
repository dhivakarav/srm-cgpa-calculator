export type GradeKey = 'O' | 'A+' | 'A' | 'B+' | 'B' | 'C' | 'U' | '';

export interface Subject {
  id: string;
  name: string;
  credits: number | '';
  grade: GradeKey;
}

export interface Semester {
  id: string;
  label: string;
  gpa: number | '';
  credits: number | '';
}

export interface ExtractedRow {
  id: string;
  subjectCode: string;
  subjectName: string;
  credits: number | '';
  grade: GradeKey;
  confidence: number; // 0–100
  isValid: boolean;
  validationError?: string;
}

export interface ExtractionResult {
  rows: ExtractedRow[];
  semesterNumber?: number;
  registerNumber?: string;
  rawSemesterGPA?: number;
  accuracyPercent: number;
  rawText: string;
}

export type PerformanceLevel = 'outstanding' | 'excellent' | 'good' | 'needs-improvement';

export interface CalculationResult {
  gpa: number;
  cgpa: number;
  percentage: number;
  level: PerformanceLevel;
  totalCredits: number;
}
