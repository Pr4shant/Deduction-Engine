
export enum DeductionStatus {
  UNCERTAIN = 'UNCERTAIN',
  PROVEN = 'PROVEN',
  REFUTED = 'REFUTED'
}

export interface ProbabilityPoint {
  timestamp: number;
  value: number;
}

export interface Observation {
  id: string;
  timestamp: number;
  content: string;
  type: 'visual' | 'auditory' | 'logical' | 'system';
}

export interface TranscriptItem {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: number;
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
  isAuditing: boolean;
  deductions: Deduction[];
  observations: Observation[];
  transcripts: TranscriptItem[];
  activeTab: 'field' | 'palace';
  lastObservation: string;
}
