/** Worker protocol for heavy analysis work. UI never blocks on parsing or matching. */
import type { AddressAssertion, AnalysisConfig, Building, ImportBatch, Probe, RunResult } from '../types';

export interface AnalyzeRequest {
  type: 'analyze';
  requestId: string;
  batches: ImportBatch[];
  buildings: Building[];
  probes: Probe[];
  assertions: AddressAssertion[];
  config: AnalysisConfig;
  cutoffTs: number;
}

export interface AnalyzeProgress {
  type: 'progress';
  requestId: string;
  stage: string;
  percent: number;
  detail: string;
}

export interface AnalyzeSuccess {
  type: 'analyze-result';
  requestId: string;
  result: RunResult;
  durationMs: number;
}

export interface AnalyzeFailure {
  type: 'analyze-error';
  requestId: string;
  message: string;
}

export interface ParseFilePayload {
  name: string;
  text: string;
}

export interface ParseRequest {
  type: 'parse';
  requestId: string;
  files: ParseFilePayload[];
  mappingOverride?: Record<string, Record<string, string | null>>;
  kinds: Record<string, string>;
}

export interface ParseFileOutcome {
  fileName: string;
  ok: boolean;
  error?: string;
  text: string;
  batch: ImportBatch | null;
  preview: import('../types').ParsedFilePreview | null;
}

export interface ParseSuccess {
  type: 'parse-result';
  requestId: string;
  outcomes: ParseFileOutcome[];
}

export type WorkerRequest = AnalyzeRequest | ParseRequest;
export type WorkerResponse = AnalyzeProgress | AnalyzeSuccess | AnalyzeFailure | ParseSuccess;
