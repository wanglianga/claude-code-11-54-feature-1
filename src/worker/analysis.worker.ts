/// <reference lib="webworker" />
/** WebWorker: owns time-window matching, baselines and large-file parsing. */
import { runAnalysis } from '../lib/engine';
import { ingestFiles } from '../lib/ingest';
import type { ParsedFilePreview, SourceKind } from '../types';
import type {
  AnalyzeRequest,
  ParseRequest,
  WorkerRequest,
  WorkerResponse,
} from './protocol';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

function post(message: WorkerResponse) {
  ctx.postMessage(message);
}

async function handleParse(req: ParseRequest) {
  const ingested = await ingestFiles(
    req.files,
    req.kinds as Record<string, SourceKind>,
    (req.mappingOverride ?? {}) as Record<string, Record<string, string | null>>,
  );
  const outcomes = ingested.map((f, idx) => ({
    fileName: f.fileName,
    ok: f.ok,
    error: f.error,
    text: req.files[idx]?.text ?? f.text,
    batch: f.batch,
    preview: f.preview as ParsedFilePreview | null,
  }));
  post({ type: 'parse-result', requestId: req.requestId, outcomes });
}

function handleAnalyze(req: AnalyzeRequest) {
  const t0 = performance.now();
  post({ type: 'progress', requestId: req.requestId, stage: '窗口匹配', percent: 15, detail: '按供热日切分读数与气象观测' });
  const result = runAnalysis({
    batches: req.batches,
    buildings: req.buildings,
    probes: req.probes,
    assertions: req.assertions,
    config: req.config,
    cutoffTs: req.cutoffTs,
  });
  post({ type: 'progress', requestId: req.requestId, stage: '基线计算', percent: 65, detail: `${result.buildingDays.length} 个楼栋-供热日` });
  post({ type: 'progress', requestId: req.requestId, stage: '结论固化', percent: 95, detail: '写入运行快照' });
  post({
    type: 'analyze-result',
    requestId: req.requestId,
    result,
    durationMs: Math.round(performance.now() - t0),
  });
}

ctx.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  const req = event.data;
  try {
    if (req.type === 'analyze') {
      handleAnalyze(req);
    } else if (req.type === 'parse') {
      void handleParse(req);
    }
  } catch (err) {
    if (req.type === 'analyze') {
      post({
        type: 'analyze-error',
        requestId: req.requestId,
        message: err instanceof Error ? err.message : String(err),
      });
    } else {
      post({
        type: 'parse-result',
        requestId: req.requestId,
        outcomes: req.files.map((f) => ({
          fileName: f.name,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
          text: f.text,
          batch: null,
          preview: null,
        })),
      });
    }
  }
});
