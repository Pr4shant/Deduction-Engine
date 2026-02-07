
export enum DeductionStatus {
  UNCERTAIN = 'UNCERTAIN',
  PROVEN = 'PROVEN',
  REFUTED = 'REFUTED'
}

export interface ProbabilityPoint {
  timestamp: number;
  value: number;
}

export interface Deduction {
  id: string;
  title: string;
  description: string;
  probability: number;
  history: ProbabilityPoint[];
  status: DeductionStatus;
  evidence: string[];
  createdAt: number;
  updatedAt: number;
}

export interface AppState {
  isAnalyzing: boolean;
  deductions: Deduction[];
  activeTab: 'field' | 'palace';
  lastObservation: string;
}
