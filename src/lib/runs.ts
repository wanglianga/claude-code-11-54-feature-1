/** Run orchestration: snapshots, comparisons, late-data notices, report snapshots. */
import type {
  AddressAssertion,
  AnalysisConfig,
  AnalysisRun,
  Building,
  ComplaintResult,
  DayClass,
  ImportBatch,
  LateDataNotice,
  MappingVersion,
  Probe,
  RiskLevel,
  RunComparison,
  RunResult,
} from '../types';
import { buildInputRefs } from './engine';
import { digestOf } from './hash';
import { fmtLocalFull, heatingDayKey } from './time';

export interface StartRunInput {
  label: string;
  batches: ImportBatch[];
  mapping: MappingVersion;
  assertions: AddressAssertion[];
  config: AnalysisConfig;
  cutoffTs: number;
  result: RunResult;
  now: number;
}

export function createAnalysisRun(input: StartRunInput): AnalysisRun {
  const inputRefs = buildInputRefs(input.batches, input.cutoffTs);
  const activeAssertions = input.assertions.filter((a) => !a.superseded);
  const result: RunResult = {
    ...input.result,
    generatedAt: input.now,
    bias: input.result.bias ? { ...input.result.bias, generatedAt: input.now } : null,
    mappingUsed: {
      buildings: input.mapping.buildings.map((b) => ({ ...b })),
      probes: input.mapping.probes.map((p) => ({ ...p })),
    },
    assertionsUsed: activeAssertions.map((a) => ({ ...a })),
  };
  return {
    id: `run-${input.now}-${Math.random().toString(36).slice(2, 8)}`,
    label: input.label,
    createdAt: input.now,
    dataCutoffTs: input.cutoffTs,
    config: { ...input.config },
    inputRefs,
    mappingVersionId: input.mapping.id,
    mappingDigest: digestOf({ buildings: input.mapping.buildings, probes: input.mapping.probes }),
    assertionsDigest: digestOf(activeAssertions.map((a) => ({ k: a.addressKey, c: a.chosenBuildingIds }))),
    assertionsSnapshot: activeAssertions.map((a) => ({ ...a })),
    mappingSnapshot: {
      buildings: input.mapping.buildings.map((b) => ({ ...b })),
      probes: input.mapping.probes.map((p) => ({ ...p })),
    },
    result,
    status: 'complete',
    engineVersion: input.result.engineVersion,
  };
}

/** Batches that arrived after the run's cutoff but carry events inside the analysis window. */
export function findLateData(
  run: AnalysisRun,
  batches: ImportBatch[],
): LateDataNotice[] {
  const notices: LateDataNotice[] = [];
  const startTs = Date.parse(`${run.config.windowStartDay}T00:00:00Z`);
  const endTs = Date.parse(`${run.config.windowEndDay}T23:59:59Z`);
  const cutoff = run.dataCutoffTs;
  const known = new Set(run.inputRefs.map((r) => r.batchId));
  for (const batch of batches) {
    if (known.has(batch.id)) continue;
    if (batch.ingestedAt <= cutoff) continue;
    let rowsInWindow = 0;
    let eventStart: number | null = null;
    let eventEnd: number | null = null;
    const note = (ts: number) => {
      if (eventStart === null || ts < eventStart) eventStart = ts;
      if (eventEnd === null || ts > eventEnd) eventEnd = ts;
    };
    if (batch.kind === 'readings') {
      for (const r of batch.data.readings ?? []) {
        const day = heatingDayKey(r.ts, run.config.heatingDayStartHour);
        if (day >= run.config.windowStartDay && day <= run.config.windowEndDay) {
          rowsInWindow += 1;
          note(r.ts);
        }
      }
    } else if (batch.kind === 'work_orders') {
      for (const o of batch.data.workOrders ?? []) {
        const day = heatingDayKey(o.startTs, run.config.heatingDayStartHour);
        if (day >= run.config.windowStartDay && day <= run.config.windowEndDay) {
          rowsInWindow += 1;
          note(o.startTs);
          note(o.endTs);
        }
      }
    } else if (batch.kind === 'weather') {
      for (const w of batch.data.weather ?? []) {
        if (w.ts >= startTs && w.ts <= endTs) {
          rowsInWindow += 1;
          note(w.ts);
        }
      }
    } else if (batch.kind === 'complaints') {
      for (const c of batch.data.complaints ?? []) {
        const day = heatingDayKey(c.windowStartTs, run.config.heatingDayStartHour);
        if (day >= run.config.windowStartDay && day <= run.config.windowEndDay) {
          rowsInWindow += 1;
          note(c.windowStartTs);
        }
      }
    }
    if (rowsInWindow === 0) continue;
    notices.push({
      batchId: batch.id,
      fileName: batch.fileName,
      kind: batch.kind,
      ingestedAt: batch.ingestedAt,
      rowsInWindow,
      eventStartTs: eventStart,
      eventEndTs: eventEnd,
      message: `${batch.fileName} 在运行截止（${fmtLocalFull(cutoff)}）之后于 ${fmtLocalFull(batch.ingestedAt)} 到达，含 ${rowsInWindow} 条落在分析窗口内的记录。本次运行的图表与结论均保持截止时点的数据，不做局部刷新。`,
    });
  }
  return notices.sort((a, b) => b.ingestedAt - a.ingestedAt);
}

const CONFIG_LABELS: Record<string, string> = {
  windowStartDay: '窗口起',
  windowEndDay: '窗口止',
  heatingDayStartHour: '供热日起点',
  comfortThresholdC: '舒适阈值',
  severeThresholdC: '严重偏低',
  nightStartHour: '夜间起点',
  nightEndHour: '夜间终点',
  minCoverageRatio: '日覆盖下限',
  minNightCoverageRatio: '夜间覆盖下限',
  baselineMinDays: '基线稳定日',
  deficitDeltaC: '相对基线下降',
  sustainedMinHours: '持续不足阈值',
  windowOpeningMaxMinutes: '短时扰动上限',
  complaintPaddingMin: '投诉时段扩展',
  complaintMatchMinScore: '地址匹配下限',
  outageGapFactor: '中断判定倍数',
};

function diffConfig(a: Record<string, unknown>, b: Record<string, unknown>) {
  const out: RunComparison['configDiffs'] = [];
  for (const key of Object.keys(CONFIG_LABELS)) {
    const from = a[key];
    const to = b[key];
    if (from === to) continue;
    out.push({ key, label: CONFIG_LABELS[key], from: String(from), to: String(to) });
  }
  return out;
}

export function compareRuns(baseline: AnalysisRun, current: AnalysisRun): RunComparison {
  const oldComplaints = new Map(baseline.result.complaints.map((c) => [c.complaintId, c]));
  const affected: RunComparison['affectedComplaints'] = [];
  for (const c of current.result.complaints) {
    const prev = oldComplaints.get(c.complaintId);
    if (!prev) {
      affected.push({
        complaintId: c.complaintId,
        rawAddress: c.rawAddress,
        oldBuildingIds: [],
        newBuildingIds: c.assignedBuildingIds,
      });
      continue;
    }
    const oldIds = [...prev.assignedBuildingIds].sort().join('+');
    const newIds = [...c.assignedBuildingIds].sort().join('+');
    if (oldIds !== newIds || prev.status !== c.status) {
      affected.push({
        complaintId: c.complaintId,
        rawAddress: c.rawAddress,
        oldBuildingIds: prev.assignedBuildingIds,
        newBuildingIds: c.assignedBuildingIds,
      });
    }
  }
  const oldBuildings = new Map(baseline.result.buildingSummaries.map((b) => [b.buildingId, b]));
  const deltas: RunComparison['buildingDeltas'] = [];
  for (const b of current.result.buildingSummaries) {
    const prev = oldBuildings.get(b.buildingId);
    if (!prev) {
      deltas.push({
        buildingId: b.buildingId,
        name: b.name,
        oldRisk: 'undetermined',
        newRisk: b.risk,
        oldClassCounts: emptyClassCounts(),
        newClassCounts: b.classCounts,
      });
      continue;
    }
    if (prev.risk !== b.risk || !sameCounts(prev.classCounts, b.classCounts)) {
      deltas.push({
        buildingId: b.buildingId,
        name: b.name,
        oldRisk: prev.risk,
        newRisk: b.risk,
        oldClassCounts: prev.classCounts,
        newClassCounts: b.classCounts,
      });
    }
  }
  const configDiffs = diffConfig(baseline.config as unknown as Record<string, unknown>, current.config as unknown as Record<string, unknown>);
  return {
    baselineRunId: baseline.id,
    currentRunId: current.id,
    affectedComplaints: affected,
    buildingDeltas: deltas,
    configChanged: configDiffs.length > 0,
    configDiffs,
    mappingChanged:
      baseline.mappingDigest !== current.mappingDigest ||
      baseline.assertionsDigest !== current.assertionsDigest,
  };
}

function emptyClassCounts(): Record<DayClass, number> {
  return {
    normal: 0,
    transient_disturbance: 0,
    local_equipment: 0,
    supply_shortfall: 0,
    insufficient_coverage: 0,
    unreliable_alignment: 0,
  };
}

function sameCounts(a: Record<DayClass, number>, b: Record<DayClass, number>): boolean {
  return (Object.keys(a) as DayClass[]).every((k) => a[k] === b[k]);
}

export function buildingNameOf(run: AnalysisRun, id: string): string {
  return run.mappingSnapshot.buildings.find((b) => b.id === id)?.name ?? id;
}

export interface ReportPayload {
  run: AnalysisRun;
  generatedAt: number;
  narrative: {
    headline: string;
    summary: string;
    findings: { title: string; detail: string; severity: RiskLevel | 'info' }[];
    caveats: string[];
    checksum: string;
  };
}

/** A run report is a pure function of the stored snapshot — nothing is recomputed. */
export function buildReport(run: AnalysisRun, now: number): ReportPayload {
  const r = run.result;
  const t = r.totals;
  const findings: ReportPayload['narrative']['findings'] = [];
  const caveats: string[] = [];

  const highs = r.buildingSummaries.filter((s) => s.risk === 'high');
  const mediums = r.buildingSummaries.filter((s) => s.risk === 'medium');
  const undetermined = r.buildingSummaries.filter((s) => s.risk === 'undetermined');

  if (highs.length) {
    findings.push({
      title: `${highs.length} 栋楼存在需现场核查的持续低温`,
      detail: highs.map((s) => `${s.name}：${s.headline}`).join('；'),
      severity: 'high',
    });
  }
  if (mediums.length) {
    findings.push({
      title: `${mediums.length} 栋楼为局部或短时低温`,
      detail: mediums.map((s) => `${s.name}：${s.headline}`).join('；'),
      severity: 'medium',
    });
  }
  const fullBlind = r.blindSpots.filter((b) => {
    const summary = r.buildingSummaries.find((s) => s.buildingId === b.buildingId);
    return summary?.probeCount === 0 || summary?.risk === 'undetermined';
  });
  const partialBlind = r.blindSpots.filter((b) => !fullBlind.includes(b));
  if (fullBlind.length) {
    findings.push({
      title: `${fullBlind.length} 栋楼存在监测盲区，不能读作“没有供热问题”`,
      detail: fullBlind.map((b) => `${b.buildingName}：${b.reason}`).join('；'),
      severity: 'undetermined',
    });
  }
  if (partialBlind.length) {
    findings.push({
      title: `${partialBlind.length} 栋楼有部分供热日无法判断`,
      detail: partialBlind
        .map((b) => `${b.buildingName}：${b.affectedDays.length} 个供热日覆盖不足或对齐失败，其余已完成判断。`)
        .join('；'),
      severity: 'info',
    });
  }
  const unassigned = r.complaints.filter((c) => c.status === 'unassigned');
  if (unassigned.length) {
    findings.push({
      title: `${unassigned.length} 条投诉地址无法唯一归属`,
      detail: unassigned.map((c) => `${c.complaintId}「${c.rawAddress}」`).join('；'),
      severity: 'info',
    });
  }
  const misaligned = r.complaints.filter((c) => c.status === 'misaligned');
  if (misaligned.length) {
    findings.push({
      title: `${misaligned.length} 条投诉的监测与工单无法可靠对齐`,
      detail: misaligned.map((c) => `${c.complaintId}：${c.explanation.join(' ')}`).join('；'),
      severity: 'undetermined',
    });
  }
  findings.push({
    title: '投诉支持度分布',
    detail: `共 ${t.complaints} 条投诉：支持 ${t.supportedComplaints}、部分支持 ${t.partialComplaints}、不支持 ${t.contradictedComplaints}、无法对齐 ${t.misalignedComplaints}、无法核实 ${t.unverifiableComplaints}、未归属 ${t.unassignedComplaints}。`,
    severity: 'info',
  });

  caveats.push(
    `分析窗口 ${r.window.startDay} 至 ${r.window.endDay}，供热日从每天 ${String(run.config.heatingDayStartHour).padStart(2, '0')}:00 开始。`,
  );
  caveats.push(
    `结论仅基于截止 ${fmtLocalFull(run.dataCutoffTs)} 已到达的数据；运行后到达的补录工单与迟到的监测数据不会改变本报告，需以新运行覆盖。`,
  );
  if (t.indeterminateDays > 0) {
    caveats.push(
      `${t.buildingDays} 个楼栋-供热日中有 ${t.indeterminateDays} 个无法判断（覆盖不足或对齐失败），未计入风险判断。`,
    );
  }
  caveats.push('探头为室内单点测量，不代表楼栋全部住户；投诉支持度反映“现有监测能否印证投诉”，不构成对供热企业的最终归责。');
  if (partialBlind.length) {
    caveats.push(`${partialBlind.length} 栋楼的部分供热日无法判断，这些日子的“未见异常”不等于已排除问题。`);
  }
  caveats.push('本工具只在浏览器本地处理数据，不上传任何真实住户资料。');

  const checksum = digestOf({
    id: run.id,
    cutoff: run.dataCutoffTs,
    config: run.config,
    mapping: run.mappingDigest,
    assertions: run.assertionsDigest,
    inputs: run.inputRefs.map((i) => [i.batchId, i.fileHash]),
    totals: run.result.totals,
  });

  const headline =
    highs.length > 0
      ? `${highs.length} 栋楼需现场核查；${fullBlind.length} 栋楼为监测盲区`
      : fullBlind.length > 0
        ? `未见整栋持续低温，但 ${fullBlind.length} 栋楼无法判断`
        : '窗口内未见整栋持续低温';

  const summary = `本次运行覆盖 ${t.buildings} 栋楼、${t.buildingDays} 个楼栋-供热日，实际可判断 ${t.evaluatedDays} 个。记录到非短时低温 ${t.observedDeficitHours} 小时，其中 ${t.documentedDeficitHours} 小时有工单印证。${highs.length} 栋高风险、${mediums.length} 栋中等风险、${undetermined.length} 栋无法判断。`;

  return {
    run,
    generatedAt: now,
    narrative: { headline, summary, findings, caveats, checksum },
  };
}

export function complaintsByStatus(c: ComplaintResult[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const x of c) out[x.status] = (out[x.status] ?? 0) + 1;
  return out;
}

export function makeMappingVersion(
  buildings: Building[],
  probes: Probe[],
  version: number,
  note: string,
  now: number,
): MappingVersion {
  return {
    id: `map-v${version}-${digestOf({ buildings, probes })}`,
    version,
    createdAt: now,
    note,
    buildings: buildings.map((b) => ({ ...b })),
    probes: probes.map((p) => ({ ...p })),
  };
}
