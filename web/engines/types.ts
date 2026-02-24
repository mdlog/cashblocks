export type RunMode = 'mock' | 'chipnet';

export interface StepResult {
  id: string;
  title: string;
  description: string;
  status: 'blocked' | 'success' | 'info' | 'funding' | 'waiting';
  details: Record<string, string>;
  primitives?: string[];
  txid?: string;
  explorerUrl?: string;
}

export interface ScenarioResult {
  scenario: 'dao' | 'escrow' | 'insurance';
  title: string;
  description: string;
  params: Record<string, string>;
  steps: StepResult[];
  summary: Record<string, string>;
  executionTimeMs: number;
  mode?: RunMode;
  explorerBaseUrl?: string;
}
