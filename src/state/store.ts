/** Application store: IndexedDB-backed state, worker orchestration, run lifecycle. */
import { useSyncExternalStore } from 'react';
import type {
  AddressAssertion,
  AnalysisConfig,
  AnalysisRun,
  Building,
  ConflictResolution,
  ImportBatch,
  LateDataNotice,
  MappingVersion,
  Probe,
  RunComparison,
  RunResult,
  SourceKind,
} from '../types';
import { DEFAULT_CONFIG } from '../types';
import * as db from '../db/store';
import { analysisClient } from '../worker/client';
import { createAnalysisRun, compareRuns, findLateData, makeMappingVersion } from '../lib/runs';
import { addressKey, findAssertionConflicts } from '../lib/address';
import { digestOf } from '../lib/hash';
import { ingestFiles } from '../lib/ingest';
import { fmtLocalFull as formatLocal } from '../lib/time';

export interface Toast {
  id: string;
  kind: 'success' | 'error' | 'info' | 'warn';
  title: string;
  detail?: string;
}

export interface BusyState {
  kind: 'import' | 'analyze' | 'mapping' | 'save';
  message: string;
  percent?: number;
  detail?: string;
}

export interface AppState {
  ready: boolean;
  batches: ImportBatch[];
  mappings: MappingVersion[];
  activeMappingId: string | null;
  assertions: AddressAssertion[];
  runs: AnalysisRun[];
  config: AnalysisConfig;
  cutoffMode: 'now' | 'custom';
  customCutoffTs: number | null;
  busy: BusyState | null;
  toasts: Toast[];
  comparison: RunComparison | null;
  lateData: LateDataNotice[];
  storage: { usage: number; quota: number };
}

const initialState: AppState = {
  ready: false,
  batches: [],
  mappings: [],
  activeMappingId: null,
  assertions: [],
  runs: [],
  config: DEFAULT_CONFIG,
  cutoffMode: 'now',
  customCutoffTs: null,
  busy: null,
  toasts: [],
  comparison: null,
  lateData: [],
  storage: { usage: 0, quota: 0 },
};

class Store {
  state: AppState = initialState;
  private listeners = new Set<() => void>();

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = () => this.state;

  private set(patch: Partial<AppState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  private toast(kind: Toast['kind'], title: string, detail?: string) {
    const t: Toast = { id: `t-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, kind, title, detail };
    this.set({ toasts: [...this.state.toasts, t] });
    setTimeout(() => {
      this.set({ toasts: this.state.toasts.filter((x) => x.id !== t.id) });
    }, 6500);
  }

  dismissToast(id: string) {
    this.set({ toasts: this.state.toasts.filter((x) => x.id !== id) });
  }

  async init() {
    const [batches, mappings, assertions, runs, config] = await Promise.all([
      db.listBatches(),
      db.listMappings(),
      db.listAssertions(),
      db.listRuns(),
      db.getConfig(),
    ]);
    let activeMappingId = await db.getActiveMappingId();
    let allMappings = mappings;
    if (!allMappings.length) {
      const seed = makeMappingVersion([], [], 1, '空白登记册', Date.now());
      await db.putMapping(seed);
      await db.setActiveMappingId(seed.id);
      allMappings = [seed];
      activeMappingId = seed.id;
    }
    if (!activeMappingId || !allMappings.some((m) => m.id === activeMappingId)) {
      activeMappingId = allMappings[allMappings.length - 1].id;
    }
    const storage = await db.storageEstimate();
    this.set({
      ready: true,
      batches,
      mappings: allMappings,
      activeMappingId,
      assertions,
      runs,
      config: { ...DEFAULT_CONFIG, ...config },
      storage,
      lateData: this.computeLateData(runs, batches),
      comparison: runs.length >= 2 ? compareRuns(runs[1], runs[0]) : null,
    });
  }

  private computeLateData(runs: AnalysisRun[], batches: ImportBatch[]): LateDataNotice[] {
    if (!batches.length) return [];
    const sorted = [...runs].sort((a, b) => b.createdAt - a.createdAt);
    if (!sorted.length) return [];
    return findLateData(sorted[0], batches);
  }

  async importSampleSubset(batchIds: string[]) {
    this.set({ busy: { kind: 'import', message: '正在追加迟到样例…', percent: 10 } });
    try {
      const byId = new Map(this.state.batches.map((b) => [b.id, b]));
      for (const id of batchIds) {
        const existing = byId.get(id);
        if (!existing) continue;
        const updated = { ...existing, ingestedAt: Date.now() };
        const text = await db.getBatchText(id);
        if (text === null) continue;
        await db.putBatch(updated, text);
      }
      const batches = await db.listBatches();
      this.set({ batches, busy: null });
      const latest = this.state.runs[0];
      this.set({
        lateData: latest ? findLateData(latest, batches) : [],
        comparison: this.state.runs.length >= 2 ? compareRuns(this.state.runs[1], this.state.runs[0]) : null,
      });
      this.toast('info', '已模拟迟到到达', '这些批次现在晚于最新运行的截止时点；结果页会提示覆盖截止，结论保持不变。');
    } catch (err) {
      this.set({ busy: null });
      this.toast('error', '模拟迟到失败', err instanceof Error ? err.message : String(err));
    }
  }

  get activeMapping(): MappingVersion | null {
    const id = this.state.activeMappingId;
    if (!id) return null;
    return this.state.mappings.find((m) => m.id === id) ?? null;
  }

  async importTextFiles(files: { name: string; text: string }[], kinds: Record<string, SourceKind> = {}) {
    if (!files.length) return;
    this.set({ busy: { kind: 'import', message: `正在解析 ${files.length} 个文件…`, percent: 10 } });
    try {
      const outcomes = await ingestFiles(files, kinds);
      const ok = outcomes.filter((o) => o.ok && o.batch);
      for (const o of ok) {
        await db.putBatch(o.batch!, o.text);
        // A registry import updates the mapping only if a building already exists with the same id.
      }
      // Merge registry batches into the active mapping.
      const registryBatches = ok.filter((o) => o.batch!.kind === 'registry');
      if (registryBatches.length) {
        const current = this.activeMapping;
        if (current) {
          const buildings = new Map(current.buildings.map((b) => [b.id, b] as const));
          const probes = new Map(current.probes.map((p) => [p.id, p] as const));
          for (const o of registryBatches) {
            for (const b of o.batch!.data.buildings ?? []) buildings.set(b.id, b);
            for (const p of o.batch!.data.probes ?? []) probes.set(p.id, p);
          }
          await this.saveMapping(
            [...buildings.values()],
            [...probes.values()],
            `导入登记册 ${registryBatches.map((r) => r.fileName).join('、')}`,
            true,
          );
        }
      }
      const batches = await db.listBatches();
      const storage = await db.storageEstimate();
      const failed = outcomes.filter((o) => !o.ok);
      this.set({
        batches,
        storage,
        busy: null,
        lateData: this.computeLateData(this.state.runs, batches),
        comparison: this.state.runs.length >= 2 ? compareRuns(this.state.runs[1], this.state.runs[0]) : null,
      });
      if (ok.length) {
        this.toast('success', `已导入 ${ok.length} 个文件`, ok.map((o) => o.fileName).join('、'));
      }
      for (const f of failed) this.toast('error', `导入失败：${f.fileName}`, f.error);
    } catch (err) {
      this.set({ busy: null });
      this.toast('error', '导入失败', err instanceof Error ? err.message : String(err));
    }
  }

  /** Import sample files with delivery timestamps from the manifest. */
  async importSamples() {
    this.set({ busy: { kind: 'import', message: '正在读取样例包…', percent: 5 } });
    try {
      const base = `${import.meta.env.BASE_URL}samples/`;
      const manifestRes = await fetch(`${base}manifest.json`);
      if (!manifestRes.ok) throw new Error('样例清单 manifest.json 读取失败');
      const manifest = (await manifestRes.json()) as {
        samples: { file: string; kind: SourceKind; delivered_at: string }[];
      };
      const files: { name: string; text: string; ingestedAt: number }[] = [];
      for (const s of manifest.samples) {
        const res = await fetch(`${base}${s.file}`);
        if (!res.ok) throw new Error(`样例文件读取失败：${s.file}`);
        files.push({ name: s.file, text: await res.text(), ingestedAt: Date.parse(s.delivered_at) });
      }
      const existing = new Set(this.state.batches.map((b) => b.fileHash));
      const kinds: Record<string, SourceKind> = {};
      for (const s of manifest.samples) kinds[s.file] = s.kind;
      const outcomes = await ingestFiles(
        files.map((f) => ({ name: f.name, text: f.text })),
        kinds,
      );
      let added = 0;
      for (const [idx, o] of outcomes.entries()) {
        if (!o.ok || !o.batch) {
          this.toast('error', `样例导入失败：${o.fileName}`, o.error);
          continue;
        }
        if (existing.has(o.batch.fileHash)) continue;
        o.batch.ingestedAt = files[idx].ingestedAt;
        await db.putBatch(o.batch, files[idx].text);
        added += 1;
      }
      // Merge the registry into the active mapping.
      const registry = outcomes.find((o) => o.ok && o.batch?.kind === 'registry')?.batch;
      if (registry) {
        const buildings = new Map<string, Building>();
        const probes = new Map<string, Probe>();
        for (const b of registry.data.buildings ?? []) buildings.set(b.id, b);
        for (const p of registry.data.probes ?? []) probes.set(p.id, p);
        await this.saveMapping([...buildings.values()], [...probes.values()], '样例登记册 v1', true);
      }
      const batches = await db.listBatches();
      const storage = await db.storageEstimate();
      this.set({
        batches,
        storage,
        busy: null,
        lateData: this.computeLateData(this.state.runs, batches),
        comparison: this.state.runs.length >= 2 ? compareRuns(this.state.runs[1], this.state.runs[0]) : null,
      });
      this.toast(
        added ? 'success' : 'info',
        added ? `样例数据已导入（${added} 个文件）` : '样例数据此前已导入',
        added ? '现在可以在「对齐检查」查看覆盖，再启动一次分析。' : undefined,
      );
    } catch (err) {
      this.set({ busy: null });
      this.toast('error', '样例数据导入失败', err instanceof Error ? err.message : String(err));
    }
  }

  async remapBatch(batchId: string, kind: SourceKind, mapping: Record<string, string | null>) {
    const batch = this.state.batches.find((b) => b.id === batchId);
    if (!batch) return;
    const text = await db.getBatchText(batchId);
    if (text === null) {
      this.toast('error', '无法重新映射', '原始文件内容已不在本地存储中。');
      return;
    }
    this.set({ busy: { kind: 'import', message: '正在按新字段映射重新解析…' } });
    try {
      const [outcome] = await ingestFiles([{ name: batch.fileName, text }], { [batch.fileName]: kind }, { [batch.fileName]: mapping });
      if (!outcome?.ok || !outcome.batch) throw new Error(outcome?.error ?? '解析失败');
      const updated: ImportBatch = {
        ...outcome.batch,
        id: batch.id,
        importedAt: batch.importedAt,
        ingestedAt: batch.ingestedAt,
      };
      await db.putBatch(updated, text);
      const batches = await db.listBatches();
      this.set({ batches, busy: null, lateData: this.computeLateData(this.state.runs, batches) });
      this.toast('success', '字段映射已更新', `${batch.fileName} 重新解析 ${updated.rowCount} 行。`);
    } catch (err) {
      this.set({ busy: null });
      this.toast('error', '重新映射失败', err instanceof Error ? err.message : String(err));
    }
  }

  async deleteBatch(batchId: string) {
    await db.deleteBatch(batchId);
    const batches = await db.listBatches();
    this.set({
      batches,
      lateData: this.computeLateData(this.state.runs, batches),
      storage: await db.storageEstimate(),
    });
    this.toast('info', '已删除导入批次');
  }

  async saveMapping(buildings: Building[], probes: Probe[], note: string, silent = false) {
    const ids = new Set(buildings.map((b) => b.id));
    const orphan = probes.filter((p) => !ids.has(p.buildingId));
    if (orphan.length) {
      this.toast(
        'error',
        '登记册未保存：探头指向不存在的楼栋',
        orphan.map((p) => `${p.id} → ${p.buildingId || '空'}`).join('、'),
      );
      throw new Error('probe references unknown building');
    }
    if (!buildings.length) {
      this.toast('error', '登记册未保存：至少需要一栋楼');
      throw new Error('empty registry');
    }
    const version = (this.state.mappings.at(-1)?.version ?? 0) + 1;
    const mapping = makeMappingVersion(buildings, probes, version, note, Date.now());
    await db.putMapping(mapping);
    await db.setActiveMappingId(mapping.id);
    const mappings = await db.listMappings();
    this.set({ mappings, activeMappingId: mapping.id });
    if (!silent) this.toast('success', `已保存登记册 v${version}`, '已完成的运行仍引用原登记册快照；新运行将使用此版本。');
    return mapping;
  }

  /** Save edits made to the active registry; used by the editor and by targeted revisions. */
  async applyMappingEdits(next: { buildings: Building[]; probes: Probe[] }, note: string) {
    return this.saveMapping(next.buildings, next.probes, note, false);
  }

  async restoreMapping(mappingId: string) {
    const mapping = this.state.mappings.find((m) => m.id === mappingId);
    if (!mapping) return;
    await this.saveMapping(mapping.buildings, mapping.probes, `从 v${mapping.version} 复制`, true);
    this.toast('info', '已基于历史版本创建新的登记册版本', '历史运行保持不变。');
  }

  /** Existing active assertions for the same address that chose a different set of buildings. */
  assertionConflictsFor(rawAddress: string, chosenBuildingIds: string[]): AddressAssertion[] {
    const key = addressKey(rawAddress);
    const signature = [...chosenBuildingIds].sort().join('+');
    return this.state.assertions.filter(
      (a) =>
        !a.superseded &&
        a.addressKey === key &&
        a.chosenBuildingIds.length > 0 &&
        [...a.chosenBuildingIds].sort().join('+') !== signature,
    );
  }

  async addAssertion(params: {
    rawAddress: string;
    chosenBuildingIds: string[];
    candidates: AddressAssertion['candidates'];
    note: string;
    runId?: string;
    windowLabel: string;
    resolution?: ConflictResolution;
    supersedeIds?: string[];
  }) {
    const key = addressKey(params.rawAddress);
    const now = Date.now();
    const assertion: AddressAssertion = {
      id: `as-${now}-${Math.random().toString(36).slice(2, 6)}`,
      addressKey: key,
      rawAddressSamples: [params.rawAddress],
      chosenBuildingIds: params.chosenBuildingIds,
      candidates: params.candidates,
      windowLabel: params.windowLabel,
      runId: params.runId,
      note: params.note,
      createdAt: now,
      superseded: false,
      resolution: params.resolution,
    };
    if (params.supersedeIds?.length) {
      for (const id of params.supersedeIds) {
        const existing = this.state.assertions.find((a) => a.id === id);
        if (existing) await db.putAssertion({ ...existing, superseded: true });
      }
    }
    await db.putAssertion(assertion);
    const assertions = await db.listAssertions();
    this.set({ assertions });
    this.toast('success', '地址归属已保存', '已完成运行仍使用原判断；新运行会纳入这次确认。');
    return assertion;
  }

  async revokeAssertion(id: string) {
    const existing = this.state.assertions.find((a) => a.id === id);
    if (!existing) return;
    await db.putAssertion({ ...existing, superseded: true });
    const assertions = await db.listAssertions();
    this.set({ assertions });
    this.toast('info', '已撤销人工确认', '新运行将重新按自动匹配处理；历史运行保持不变。');
  }

  conflicts(): ReturnType<typeof findAssertionConflicts> {
    return findAssertionConflicts(this.state.assertions);
  }

  /** Persist a conflict decision (keep one side or merge) before any assertion is active. */
  async resolveConflict(
    conflictAssertions: AddressAssertion[],
    decision: 'keep_existing' | 'adopt_new' | 'merge',
    finalIds: string[],
    note: string,
  ) {
    const sorted = [...conflictAssertions].sort((a, b) => b.createdAt - a.createdAt);
    const newer = sorted[0];
    const older = sorted[1] ?? sorted[0];
    const now = Date.now();
    const base = decision === 'keep_existing' ? older : newer;
    const chosen = [...new Set(finalIds)];
    const keep: AddressAssertion = {
      ...base,
      id: `as-${now}-${Math.random().toString(36).slice(2, 6)}`,
      chosenBuildingIds: chosen,
      createdAt: now,
      note,
      superseded: false,
      resolution: {
        type: decision,
        conflictWith: sorted.map((a) => a.id),
        reason: note,
        resolvedAt: now,
      },
    };
    for (const a of sorted) await db.putAssertion({ ...a, superseded: true });
    await db.putAssertion(keep);
    const assertions = await db.listAssertions();
    this.set({ assertions });
    this.toast('success', '地址归属冲突已处理', '已保留处理结果，历史运行不受影响。');
  }

  async updateConfig(config: AnalysisConfig) {
    await db.setConfig(config);
    this.set({ config });
  }

  setCutoff(mode: 'now' | 'custom', customCutoffTs: number | null) {
    this.set({ cutoffMode: mode, customCutoffTs });
  }

  resolveCutoff(): number {
    if (this.state.cutoffMode === 'custom' && this.state.customCutoffTs !== null) {
      return this.state.customCutoffTs;
    }
    return Date.now();
  }

  async startRun(label?: string) {
    const mapping = this.activeMapping;
    if (!mapping) {
      this.toast('error', '尚未登记楼栋与探头', '请先在「来源登记」导入登记册。');
      return null;
    }
    const cutoffTs = this.resolveCutoff();
    const usable = this.state.batches.filter((b) => b.ingestedAt <= cutoffTs);
    if (!usable.some((b) => b.kind === 'readings')) {
      this.toast('error', '缺少室温读数', '截止时点之前没有可用的室温读数批次。');
      return null;
    }
    this.set({ busy: { kind: 'analyze', message: '正在启动分析…', percent: 2 } });
    try {
      const response = await analysisClient.analyze(
        {
          batches: usable,
          buildings: mapping.buildings,
          probes: mapping.probes,
          assertions: this.state.assertions,
          config: this.state.config,
          cutoffTs,
        },
        (stage, percent, detail) => {
          this.set({ busy: { kind: 'analyze', message: stage, percent, detail } });
        },
      );
      const now = Date.now();
      const run = createAnalysisRun({
        label: label || `运行 ${this.state.runs.length + 1} · ${new Date(now + 8 * 3600_000).toISOString().slice(0, 16).replace('T', ' ')}`,
        batches: usable,
        mapping,
        assertions: this.state.assertions,
        config: this.state.config,
        cutoffTs,
        result: response.result,
        now,
      });
      await db.putRun(run);
      const runs = await db.listRuns();
      const others = runs.filter((r) => r.id !== run.id).sort((a, b) => b.createdAt - a.createdAt);
      // Prefer comparing against the most recent run whose mapping/assertions differ,
      // so a registry revision surfaces its affected complaints even if intermediate
      // runs already used the new registry.
      const prev =
        others.find((r) => r.mappingDigest !== run.mappingDigest || r.assertionsDigest !== run.assertionsDigest) ??
        others[0];
      const comparison = prev ? compareRuns(prev, run) : null;
      const lateData = findLateData(run, this.state.batches);
      this.set({
        runs,
        busy: null,
        comparison,
        lateData,
        storage: await db.storageEstimate(),
      });
      this.toast(
        'success',
        '分析运行已保存',
        `耗时 ${response.durationMs} ms；运行快照固定引用登记册 v${mapping.version} 与截止 ${formatLocal(cutoffTs)}。`,
      );
      return run;
    } catch (err) {
      this.set({ busy: null });
      this.toast('error', '分析失败', err instanceof Error ? err.message : String(err));
      return null;
    }
  }

  async deleteRun(id: string) {
    await db.deleteRun(id);
    const runs = await db.listRuns();
    this.set({
      runs,
      comparison: runs.length >= 2 ? compareRuns(runs[1], runs[0]) : null,
      lateData: this.computeLateData(runs, this.state.batches),
    });
    this.toast('info', '已删除运行快照');
  }

  latestRun(): AnalysisRun | null {
    return this.state.runs[0] ?? null;
  }

  getRun(id: string): AnalysisRun | null {
    return this.state.runs.find((r) => r.id === id) ?? null;
  }

  async clearAll() {
    await db.clearAll();
    this.set({ ...initialState, ready: true });
    await this.init();
    this.toast('info', '工作区已清空', '本地 IndexedDB 中的导入批次、确认记录与运行快照已删除。');
  }

  /** Resolve an evidence ref back to source batches for the evidence drawer. */
  batchesForRefs(refs: { batchId: string; fileHash: string }[]): ImportBatch[] {
    const ids = new Set(refs.map((r) => r.batchId));
    const hashes = new Set(refs.map((r) => r.fileHash));
    return this.state.batches.filter((b) => ids.has(b.id) || hashes.has(b.fileHash));
  }
}

export const store = new Store();

export function useStore(): AppState {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

export function useActiveMapping(): MappingVersion | null {
  const state = useStore();
  return state.mappings.find((m) => m.id === state.activeMappingId) ?? null;
}

export function runResultDigest(run: AnalysisRun): string {
  return digestOf(run.result.totals);
}

export function describeRun(run: AnalysisRun): string {
  return `${run.result.totals.buildings} 栋楼 · ${run.result.totals.complaints} 条投诉 · 截止 ${formatLocal(run.dataCutoffTs)}`;
}

export type { RunResult };
