/// <reference lib="webworker" />
/** Typed worker client with promise-based request/response mapping. */
import type {
  AnalyzeRequest,
  ParseRequest,
  WorkerResponse,
} from './protocol';

type Pending = {
  resolve: (value: WorkerResponse) => void;
  reject: (err: Error) => void;
  onProgress?: (stage: string, percent: number, detail: string) => void;
};

export class AnalysisClient {
  private worker: Worker | null = null;
  private pending = new Map<string, Pending>();
  private seq = 0;

  private ensure(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' });
      this.worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
        const msg = event.data;
        if (msg.type === 'progress') {
          this.pending.get(msg.requestId)?.onProgress?.(msg.stage, msg.percent, msg.detail);
          return;
        }
        const entry = this.pending.get(msg.requestId);
        if (!entry) return;
        this.pending.delete(msg.requestId);
        if (msg.type === 'analyze-error') entry.reject(new Error(msg.message));
        else entry.resolve(msg);
      });
      this.worker.addEventListener('error', (event) => {
        const err = new Error(event.message || '分析 Worker 运行失败');
        for (const [, entry] of this.pending) entry.reject(err);
        this.pending.clear();
        this.worker?.terminate();
        this.worker = null;
      });
    }
    return this.worker;
  }

  analyze(
    req: Omit<AnalyzeRequest, 'type' | 'requestId'>,
    onProgress?: (stage: string, percent: number, detail: string) => void,
  ) {
    const requestId = `a-${++this.seq}`;
    const worker = this.ensure();
    return new Promise<Extract<WorkerResponse, { type: 'analyze-result' }>>((resolve, reject) => {
      this.pending.set(requestId, {
        resolve: (m) => resolve(m as Extract<WorkerResponse, { type: 'analyze-result' }>),
        reject,
        onProgress,
      });
      worker.postMessage({ ...req, type: 'analyze', requestId });
    });
  }

  parse(req: Omit<ParseRequest, 'type' | 'requestId'>) {
    const requestId = `p-${++this.seq}`;
    const worker = this.ensure();
    return new Promise<Extract<WorkerResponse, { type: 'parse-result' }>>((resolve, reject) => {
      this.pending.set(requestId, {
        resolve: (m) => resolve(m as Extract<WorkerResponse, { type: 'parse-result' }>),
        reject,
      });
      worker.postMessage({ ...req, type: 'parse', requestId });
    });
  }

  dispose() {
    this.worker?.terminate();
    this.worker = null;
    this.pending.clear();
  }
}

export const analysisClient = new AnalysisClient();
