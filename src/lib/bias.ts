/**
 * 探头位置偏差与楼栋风险敏感性评估。
 *
 * 两条路线并行给出结论，且都不改写原始读数：
 *  - 路线 A（robust_neighbor）：固定安装分层的稳健邻近比较，逐项证据可审查，
 *    不需要训练历史模型；布局稀疏或改造后可比探头不足时直接报告“不可比”。
 *  - 路线 B（hierarchical_model）：含位置与天气协变量的确定性层级模型，
 *    借用同楼栋/同类型探头的信息，做经验贝叶斯收缩并给出 MAD 预测区间；
 *    样本不足时标记不适用，模型估计永远不被当作实测。
 *
 * 自动校正门控（任一不满足即 adjustmentC = 0）：
 *  1. 位置证据编号存在；2. 校准证书在该事件时间段内有效；
 *  3. 可比邻近供热日达到下限；4. 持续中位差达到下限且方向稳定；
 *  5. 证书示值偏差显著（≥0.8℃）且与邻近证据反向时判冲突，不放行。
 * 探头更换、外墙改造、重新校准按事件时间拆段，每段独立门控。
 */
import type {
  AnalysisConfig,
  BiasEvaluationSuite,
  BiasGateCode,
  BiasGateResult,
  BuildingBiasSensitivity,
  BuildingDayResult,
  CalibrationCertificate,
  CalibrationStatus,
  DayCoverage,
  HierarchicalProbeEstimate,
  NeighborComparisonPoint,
  Probe,
  ProbeBiasAssessment,
  ProbeBiasSegment,
  ProbeInstallPosition,
  ProbeLifecycleEvent,
  ProbeLifecycleKind,
  RiskLevel,
  RobustNeighborEstimate,
} from '../types';
import { certificateStatusAt } from './parse';
import { dayStartTs, heatingDayKey } from './time';

export const BIAS_ENGINE_VERSION = 'bias-1.0.0';

interface DayPoint {
  ts: number;
  v: number;
}
export interface BiasSeriesLike {
  probe: Probe;
  byDay: Map<string, DayPoint[]>;
}

export interface BiasInput {
  probes: Probe[];
  dayKeys: string[];
  series: Map<string, BiasSeriesLike>;
  coverage: Map<string, DayCoverage>;
  weatherAt: (ts: number) => number | null;
  buildingDays: BuildingDayResult[];
  config: AnalysisConfig;
  windowStartTs: number;
  windowEndTs: number;
  engineVersion: string;
  now: number;
}

function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function mad(values: number[]): number {
  if (values.length === 0) return NaN;
  const med = median(values);
  return median(values.map((v) => Math.abs(v - med)));
}

function round(n: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

function emptyGate(): BiasGateResult {
  return { adjustmentAllowed: false, reasons: [], detail: [] };
}

const Z_TABLE: Record<number, number> = {
  0.8: 1.2816,
  0.9: 1.6449,
  0.95: 1.96,
};
function zForLevel(level: number): number {
  if (Z_TABLE[level]) return Z_TABLE[level];
  if (level >= 0.95) return 1.96;
  if (level >= 0.9) return 1.6449;
  return 1.2816;
}

// ---------------------------------------------------------------------------
// 事件时间拆段
// ---------------------------------------------------------------------------

const SEGMENTING_KINDS: ProbeLifecycleKind[] = ['replaced', 'relocated', 'external_wall_works', 'recalibrated'];

function positionAt(probe: Probe, events: ProbeLifecycleEvent[], segmentStart: number): ProbeInstallPosition | null {
  let pos = probe.position ?? null;
  for (const e of events) {
    if (e.eventTs <= segmentStart && e.positionAfter) pos = e.positionAfter;
  }
  return pos;
}

export function segmentsFor(probe: Probe, windowStart: number, windowEnd: number): ProbeBiasSegment[] {
  const events = (probe.lifecycleEvents ?? []).filter(
    (e) => SEGMENTING_KINDS.includes(e.kind) && e.eventTs >= windowStart && e.eventTs < windowEnd,
  );
  const bounds = [windowStart, ...events.map((e) => e.eventTs), windowEnd];
  const segments: ProbeBiasSegment[] = [];
  for (let i = 0; i < bounds.length - 1; i += 1) {
    const startTs = bounds[i];
    const endTs = bounds[i + 1];
    const triggerEvent = i === 0 ? null : events[i - 1];
    const trigger: ProbeBiasSegment['trigger'] = triggerEvent?.kind ?? (i === 0 ? 'window_start' : 'window_end');
    const certs = probe.certificates ?? [];
    const { status, certificateId } = certificateStatusAt(certs, startTs, endTs);
    const position = positionAt(probe, events, startTs);
    const gate = emptyGate();
    const detail: string[] = [];
    if (!position || !position.evidenceRef) {
      gate.reasons.push('missing_position_evidence');
      detail.push('缺少带证据编号的安装位置档案，无法确认固定安装分层。');
    }
    if (status === 'missing') {
      gate.reasons.push('missing_certificate');
      detail.push('没有校准证书，不允许自动校正。');
    } else if (status === 'expired') {
      gate.reasons.push('certificate_expired');
      detail.push(`校准证书 ${certificateId ?? ''} 在该时间段已过有效期或未标注有效期。`);
    } else if (status === 'conflict') {
      gate.reasons.push('certificate_conflict');
      detail.push(`校准证书 ${certificateId ?? ''} 与另一证书在 20℃ 示值偏差上相互冲突。`);
    }
    gate.detail = detail;
    segments.push({
      segmentIndex: i,
      startTs,
      endTs,
      trigger,
      triggerEventId: triggerEvent?.id ?? null,
      certificateId,
      calibrationStatus: status,
      positionEvidence: !!position?.evidenceRef,
      gate,
    });
  }
  return segments;
}

// ---------------------------------------------------------------------------
// 路线 A：稳健邻近比较
// ---------------------------------------------------------------------------

function resolveNeighbors(probe: Probe, all: Probe[], active: Set<string>): Probe[] {
  const explicit = (probe.neighborLinks ?? [])
    .map((l) => all.find((p) => p.id === l.probeId))
    .filter((p): p is Probe => !!p && p.id !== probe.id && active.has(p.id));
  const seen = new Set(explicit.map((p) => p.id));
  const sameBuilding = all.filter((p) => p.buildingId === probe.buildingId && p.id !== probe.id && active.has(p.id));
  const sameRoom = sameBuilding.filter((p) => (p.position?.roomType ?? 'unknown') === (probe.position?.roomType ?? 'unknown'));
  for (const p of [...sameRoom, ...sameBuilding]) {
    if (!seen.has(p.id)) {
      explicit.push(p);
      seen.add(p.id);
    }
  }
  return explicit;
}

function outdoorMedianOfDay(dayKey: string, config: AnalysisConfig, weatherAt: BiasInput['weatherAt']): number | null {
  const start = dayStartTs(dayKey, config.heatingDayStartHour);
  const samples: number[] = [];
  for (let t = start; t < start + 24 * 3_600_000; t += 60 * 60_000) {
    const w = weatherAt(t + 30 * 60_000);
    if (w !== null) samples.push(w);
  }
  return samples.length >= 8 ? round(median(samples), 2) : null;
}

function coverageOf(coverage: Map<string, DayCoverage>, buildingId: string, dayKey: string): DayCoverage | undefined {
  return coverage.get(`${buildingId}@${dayKey}`);
}

function robustForSegment(
  input: BiasInput,
  probe: Probe,
  segment: ProbeBiasSegment,
  neighbors: Probe[],
): RobustNeighborEstimate {
  const { config, series, dayKeys, coverage, weatherAt } = input;
  const gate: BiasGateResult = {
    adjustmentAllowed: false,
    reasons: [...segment.gate.reasons],
    detail: [...segment.gate.detail],
  };
  const points: NeighborComparisonPoint[] = [];
  const own = series.get(probe.id);
  const segDayKeys = dayKeys.filter((k) => {
    const ds = dayStartTs(k, config.heatingDayStartHour);
    return ds >= segment.startTs - 1 && ds < segment.endTs;
  });

  for (const dayKey of segDayKeys) {
    const ownPoints = own?.byDay.get(dayKey) ?? [];
    const ownCov = coverageOf(coverage, probe.buildingId, dayKey)?.probes.find((p) => p.probeId === probe.id);
    const ownRatio = ownCov?.coverageRatio ?? 0;
    const ownMedian = ownPoints.length >= 3 ? round(median(ownPoints.map((p) => p.v)), 2) : null;
    const outdoor = outdoorMedianOfDay(dayKey, config, weatherAt);
    const neighborMeds: { id: string; med: number; ratio: number }[] = [];
    for (const n of neighbors) {
      const nPoints = series.get(n.id)?.byDay.get(dayKey) ?? [];
      if (nPoints.length < 3) continue;
      const nCov = coverageOf(coverage, n.buildingId, dayKey)?.probes.find((p) => p.probeId === n.id);
      const ratio = nCov?.coverageRatio ?? 0;
      neighborMeds.push({ id: n.id, med: round(median(nPoints.map((p) => p.v)), 2), ratio });
    }
    const usableNeighbors = neighborMeds.filter(
      (n) => n.ratio >= config.minCoverageRatio - config.biasCoverageTolerance,
    );
    let excludedReason: string | null = null;
    let comparable = false;
    let delta: number | null = null;
    let neighborMedian: number | null = null;
    if (ownMedian === null) {
      excludedReason = '探头当日有效读数不足 3 条';
    } else if (ownRatio < config.minCoverageRatio) {
      excludedReason = `探头当日覆盖率 ${(ownRatio * 100).toFixed(0)}% 低于下限`;
    } else if (outdoor === null) {
      excludedReason = '当日气象覆盖不足，无法对齐室外温度条件';
    } else if (usableNeighbors.length === 0) {
      excludedReason = '没有覆盖达标的邻近探头可比较（稀疏布局/改造后可比探头少）';
    } else {
      neighborMedian = round(median(usableNeighbors.map((n) => n.med)), 2);
      delta = round(ownMedian - neighborMedian, 2);
      comparable = true;
    }
    points.push({
      dayKey,
      probeMedianC: ownMedian ?? NaN,
      neighborMedianC: neighborMedian ?? NaN,
      deltaC: delta ?? NaN,
      outdoorMedianC: outdoor ?? NaN,
      probeCoverageRatio: round(ownRatio, 3),
      neighborCoverageRatio: usableNeighbors.length ? round(median(usableNeighbors.map((n) => n.ratio)), 3) : 0,
      neighborProbeIds: usableNeighbors.map((n) => n.id),
      comparable,
      excludedReason,
    });
  }

  const comparablePoints = points.filter((p) => p.comparable);
  const deltas = comparablePoints.map((p) => p.deltaC);
  const persistentDeltaC = deltas.length ? round(median(deltas), 2) : null;
  const madDeltaC = deltas.length ? round(1.4826 * mad(deltas), 2) : null;
  const neighborProbeIds = [...new Set(comparablePoints.flatMap((p) => p.neighborProbeIds))];
  const basis: string[] = [];

  if (neighbors.length === 0) {
    gate.reasons.push('insufficient_neighbors');
    gate.detail.push('登记的邻近关系为空且同楼栋没有其他探头，无法建立固定安装分层。');
  }
  if (comparablePoints.length < config.biasMinComparableDays) {
    gate.reasons.push('insufficient_comparable_days');
    gate.detail.push(`可比邻近供热日仅 ${comparablePoints.length} 天，低于下限 ${config.biasMinComparableDays} 天。`);
  }

  let adjustmentC = 0;
  if (persistentDeltaC !== null) {
    basis.push(`${comparablePoints.length} 个可比供热日的稳健中位差 ${persistentDeltaC}℃（MAD ${madDeltaC}℃）。`);
    if (Math.abs(persistentDeltaC) < config.biasMinPersistentDeltaC) {
      gate.reasons.push('persistent_delta_below_threshold');
      gate.detail.push(`持续中位差 ${persistentDeltaC}℃ 未达到 ${config.biasMinPersistentDeltaC}℃ 的证据下限，不做调整。`);
    } else if (persistentDeltaC < 0) {
      const negativeShare = deltas.filter((d) => d < 0).length / deltas.length;
      if (negativeShare < 2 / 3) {
        gate.reasons.push('insufficient_comparable_days');
        gate.detail.push(`仅 ${(negativeShare * 100).toFixed(0)}% 的可比日同向偏低，方向不稳定，不做调整。`);
      }
    }
    // 仅当证书自身示值偏差显著（≥0.8℃）且与邻近证据反向时才判冲突；
    // 0.1~0.3℃ 的证书容差属于正常检定噪声，不得据此否定位置证据。
    const certBias = segment.certificateId
      ? ((probe.certificates ?? []).find((c) => c.id === segment.certificateId)?.biasAt20C ?? null)
      : null;
    if (
      certBias !== null &&
      Math.abs(certBias) >= 0.8 &&
      Math.sign(certBias) !== Math.sign(persistentDeltaC)
    ) {
      gate.reasons.push('certificate_conflict');
      gate.detail.push(`证书示值偏差 ${certBias}℃ 显著且与邻近比较 ${persistentDeltaC}℃ 反向，不做自动校正。`);
    }
    if (gate.reasons.length === 0) {
      gate.adjustmentAllowed = true;
      adjustmentC = round(-persistentDeltaC, 2);
      basis.push(`门控通过：位置证据、有效证书 ${segment.certificateId}、${comparablePoints.length} 个可比日相互支持，调整视图修正 ${adjustmentC}℃。`);
    }
  }

  return {
    route: 'robust_neighbor',
    segmentIndex: segment.segmentIndex,
    persistentDeltaC,
    madDeltaC,
    comparableDayCount: comparablePoints.length,
    neighborProbeIds,
    points,
    gate,
    adjustmentC,
    adjustmentBasis: basis,
  };
}

// ---------------------------------------------------------------------------
// 路线 B：确定性层级模型
// y(探头,供热日) = δ_供热日(吸收天气) + 楼栋截距 + 位置固定效应(加性设计)
//                + u_探头(向 0 收缩的随机效应) + ε
// ---------------------------------------------------------------------------

const COLD_ORIENTATIONS = new Set(['north', 'west']);

interface ModelFit {
  positionEffect: Map<string, number>;
  driftEffect: Map<string, number>;
  halfWidth: Map<string, number>;
  shrinkage: Map<string, number>;
  sampleCount: Map<string, number>;
  outdoorBeta: number | null;
  notes: string[];
  pooled: boolean;
}

function fitHierarchical(input: BiasInput, probes: Probe[], scopeLabel: string, pooled: boolean): ModelFit | null {
  const { config, series, dayKeys, coverage, weatherAt } = input;
  const active = probes.filter((p) => (series.get(p.id)?.byDay.size ?? 0) > 0);
  if (active.length < config.biasModelMinProbes) return null;

  interface Obs {
    probeId: string;
    buildingId: string;
    dayKey: string;
    y: number;
  }
  const obs: Obs[] = [];
  for (const p of active) {
    for (const dayKey of dayKeys) {
      const points = series.get(p.id)?.byDay.get(dayKey) ?? [];
      if (points.length < 3) continue;
      const cov = coverageOf(coverage, p.buildingId, dayKey)?.probes.find((x) => x.probeId === p.id);
      if ((cov?.coverageRatio ?? 0) < config.minCoverageRatio) continue;
      obs.push({ probeId: p.id, buildingId: p.buildingId, dayKey, y: median(points.map((x) => x.v)) });
    }
  }
  const daysWithData = new Set(obs.map((o) => o.dayKey));
  if (obs.length < config.biasModelMinProbes * config.biasMinComparableDays || daysWithData.size < config.biasMinComparableDays) {
    return null;
  }

  // 日固定效应：当日全样本中位，非参数吸收室外温度与供热日差异。
  const dayEffect = new Map<string, number>();
  for (const dayKey of daysWithData) {
    dayEffect.set(dayKey, median(obs.filter((o) => o.dayKey === dayKey).map((o) => o.y)));
  }
  const xy: { x: number; y: number }[] = [];
  for (const [dayKey, delta] of dayEffect) {
    const outdoor = outdoorMedianOfDay(dayKey, config, weatherAt);
    if (outdoor !== null) xy.push({ x: outdoor, y: delta });
  }
  let outdoorBeta: number | null = null;
  if (xy.length >= 3) {
    const mx = xy.reduce((s, p) => s + p.x, 0) / xy.length;
    const my = xy.reduce((s, p) => s + p.y, 0) / xy.length;
    const den = xy.reduce((s, p) => s + (p.x - mx) ** 2, 0);
    outdoorBeta = den ? round(xy.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0) / den, 3) : null;
  }

  // 楼栋截距：同楼栋日校正残差中位，吸收楼栋级立管/保温差异。
  const residuals = obs.map((o) => ({ ...o, r: o.y - (dayEffect.get(o.dayKey) ?? 0) }));
  const buildingIntercept = new Map<string, number>();
  for (const buildingId of new Set(active.map((p) => p.buildingId))) {
    const vals = residuals.filter((o) => o.buildingId === buildingId).map((o) => o.r);
    if (vals.length) buildingIntercept.set(buildingId, median(vals));
  }

  // 加性位置设计：外墙、冷侧朝向、楼层斜率、卧室效应（全部相对内区参照组）。
  const design = (p: Probe): number[] => {
    const pos = p.position;
    const external = pos?.wallPosition === 'external_wall' ? 1 : 0;
    const coldOrient = pos && COLD_ORIENTATIONS.has(pos.orientation) ? 1 : 0;
    const floor = typeof pos?.floor === 'number' ? pos.floor : 0;
    const bedroom = pos?.roomType === 'bedroom' ? 1 : 0;
    return [external, coldOrient, floor, bedroom];
  };
  // 稳健 OLS（一次迭代加权：用残差 MAD 降权离群点）。
  const X = residuals.map((o) => {
    const p = active.find((x) => x.id === o.probeId)!;
    return [1, ...design(p)];
  });
  let yVec = residuals.map((o) => o.r - (buildingIntercept.get(o.buildingId) ?? 0));
  const ncol = 5;
  function solveNormal(Xm: number[][], yv: number[], weights: number[]): number[] {
    const XtX = Array.from({ length: ncol }, () => new Array(ncol).fill(0));
    const Xty = new Array(ncol).fill(0);
    for (let i = 0; i < Xm.length; i += 1) {
      const w = weights[i];
      for (let a = 0; a < ncol; a += 1) {
        Xty[a] += w * Xm[i][a] * yv[i];
        for (let b = 0; b < ncol; b += 1) XtX[a][b] += w * Xm[i][a] * Xm[i][b];
      }
    }
    // 高斯消元。
    const aug = XtX.map((row, i) => [...row, Xty[i]]);
    for (let c = 0; c < ncol; c += 1) {
      let pivot = c;
      for (let r = c + 1; r < ncol; r += 1) if (Math.abs(aug[r][c]) > Math.abs(aug[pivot][c])) pivot = r;
      [aug[c], aug[pivot]] = [aug[pivot], aug[c]];
      if (Math.abs(aug[c][c]) < 1e-10) aug[c][c] = 1e-10;
      for (let r = 0; r < ncol; r += 1) {
        if (r === c) continue;
        const f = aug[r][c] / aug[c][c];
        for (let k = c; k <= ncol; k += 1) aug[r][k] -= f * aug[c][k];
      }
    }
    return aug.map((row, i) => row[ncol] / row[i]);
  }
  let beta = solveNormal(X, yVec, X.map(() => 1));
  const resid0 = yVec.map((y, i) => y - X[i].reduce((s, x, j) => s + x * beta[j], 0));
  const sigma0 = Math.max(0.05, 1.4826 * mad(resid0));
  const weights = resid0.map((e) => 1 / (1 + (e / sigma0) ** 2));
  beta = solveNormal(X, yVec, weights);
  const [intercept0, betaExternal, betaColdOrient, betaFloor, betaBedroom] = beta;
  void intercept0;
  const fittedResid = yVec.map((y, i) => y - X[i].reduce((s, x, j) => s + x * beta[j], 0));
  const sigma2 = Math.max(0.02, (1.4826 * mad(fittedResid)) ** 2);

  // 位置固定效应（不含楼栋截距）与探头随机效应 u_p（向 0 收缩）。
  const positionEffect = new Map<string, number>();
  const rawU = new Map<string, number>();
  const perProbeResid = new Map<string, number[]>();
  for (const o of residuals) {
    const p = active.find((x) => x.id === o.probeId)!;
    const pe = design(p).reduce((s, x, j) => s + x * [betaExternal, betaColdOrient, betaFloor, betaBedroom][j], 0);
    positionEffect.set(o.probeId, round(pe, 2));
    const list = perProbeResid.get(o.probeId) ?? [];
    list.push(o.r - (buildingIntercept.get(o.buildingId) ?? 0) - pe);
    perProbeResid.set(o.probeId, list);
  }
  for (const [pid, list] of perProbeResid) rawU.set(pid, list.length ? median(list) : 0);
  const uValues = [...rawU.values()];
  const tau2 = Math.max(0, uValues.reduce((s, v) => s + v * v, 0) / Math.max(1, uValues.length) - sigma2 / 4);

  const z = zForLevel(config.biasModelIntervalLevel);
  const driftEffect = new Map<string, number>();
  const halfWidth = new Map<string, number>();
  const shrinkage = new Map<string, number>();
  const sampleCount = new Map<string, number>();
  for (const p of active) {
    const n = (perProbeResid.get(p.id) ?? []).length;
    const kappa = tau2 <= 0 ? 0 : tau2 / (tau2 + sigma2 / Math.max(1, n));
    driftEffect.set(p.id, round(kappa * (rawU.get(p.id) ?? 0), 2));
    shrinkage.set(p.id, round(kappa, 2));
    sampleCount.set(p.id, n);
    halfWidth.set(p.id, round(z * Math.sqrt(sigma2 / Math.max(1, n) + tau2 * (1 - kappa)), 2));
  }

  return {
    positionEffect,
    driftEffect,
    halfWidth,
    shrinkage,
    sampleCount,
    outdoorBeta,
    pooled,
    notes: [
      `${scopeLabel}层级模型：${active.length} 个探头、${daysWithData.size} 个供热日、${obs.length} 个探头-日观测${pooled ? '（楼栋样本不足，全小区池化，借用同类型探头信息）' : ''}。`,
      `日固定效应吸收天气（室外斜率 ${outdoorBeta ?? '—'} ℃/℃）；楼栋截距 ${buildingIntercept.size} 个；外墙系数 ${round(betaExternal, 2)}℃、冷侧朝向 ${round(betaColdOrient, 2)}℃、楼层 ${round(betaFloor, 2)}℃/层、卧室 ${round(betaBedroom, 2)}℃；残差 σ=${round(Math.sqrt(sigma2), 2)}℃。`,
      `预测区间为 ${config.biasModelIntervalLevel} 双侧水平，基于残差 MAD 与收缩后方差；区间表示估计不确定性，模型估计不是实测温差。`,
    ],
  };
}

// ---------------------------------------------------------------------------
// 楼栋风险敏感性：把两个视图映射回与引擎相同的风险分档
// ---------------------------------------------------------------------------

function scoreSupply(d: BuildingDayResult, deficitC: number, minIndoor: number, config: AnalysisConfig): number {
  const sustained = d.episodes.filter((e) => e.kind === 'supply_shortfall');
  const worst = sustained.length
    ? sustained.reduce((a, b) => (a.meanDeficitC > b.meanDeficitC ? a : b))
    : d.episodes[0];
  const durationMin = worst?.durationMin ?? 180;
  const documented = d.documented;
  const sev = minIndoor <= config.severeThresholdC && ((worst?.nightMinutes ?? 0) > 0 || durationMin >= 240);
  return Math.min(100, Math.round(55 + Math.min(25, durationMin / 12) + Math.min(15, deficitC * 4) + (documented ? 10 : 0) + (sev ? 8 : 0)));
}

function scoreLocal(d: BuildingDayResult, deficitC: number): number {
  const e = d.episodes.find((x) => x.kind === 'local_equipment') ?? d.episodes[0];
  const durationMin = e?.durationMin ?? 120;
  return Math.min(60, Math.round(40 + Math.min(12, durationMin / 20) + Math.min(8, deficitC * 2)));
}

function riskFromScore(score: number | null, day: BuildingDayResult): RiskLevel {
  if (score === null) return day.risk === 'undetermined' ? 'undetermined' : 'low';
  if (score >= 65) return 'high';
  if (score >= 40) return 'medium';
  return 'low';
}

interface SegmentAdjustment {
  startTs: number;
  endTs: number;
  adjustmentC: number;
  segmentIndex: number;
}

function adjustmentAt(segments: SegmentAdjustment[], ts: number): number {
  const hit = segments.find((s) => ts >= s.startTs && ts < s.endTs);
  return hit?.adjustmentC ?? 0;
}

function adjustedDayScore(
  d: BuildingDayResult,
  adjustmentByProbe: Map<string, SegmentAdjustment[]>,
  config: AnalysisConfig,
): { score: number | null; risk: RiskLevel } {
  if (d.episodes.length === 0 || d.riskScore === null) {
    return { score: d.riskScore, risk: d.risk };
  }
  const affected = [...new Set(d.episodes.flatMap((e) => e.affectedProbeIds))];
  const meanAdj =
    affected.reduce((s, id) => s + adjustmentAt(adjustmentByProbe.get(id) ?? [], d.dayStartTs), 0) /
    Math.max(1, affected.length);
  // 无调整的供热日必须逐字沿用引擎原始分数，保证原始视图与主结论同版本。
  if (round(meanAdj, 2) === 0) return { score: d.riskScore, risk: d.risk };
  const adjustedMin = round(d.episodes.reduce((m, e) => Math.min(m, e.minIndoorC), 99) + meanAdj, 2);
  const adjustedDeficit = Math.max(0, round((d.baseline.valueC ?? config.comfortThresholdC) - adjustedMin, 2));
  let score: number;
  if (d.episodes.some((e) => e.kind === 'supply_shortfall')) {
    score = scoreSupply(d, adjustedDeficit, adjustedMin, config);
  } else if (d.episodes.some((e) => e.kind === 'local_equipment')) {
    score = scoreLocal(d, adjustedDeficit);
  } else {
    return { score: d.riskScore, risk: d.risk };
  }
  return { score, risk: riskFromScore(score, d) };
}

function aggregateBuilding(days: BuildingDayResult[], pick: (d: BuildingDayResult) => { score: number | null; risk: RiskLevel }): {
  risk: RiskLevel;
  score: number | null;
} {
  const indeterminate = days.filter((d) => d.classification === 'insufficient_coverage' || d.classification === 'unreliable_alignment').length;
  if (days.length === 0 || days.length - indeterminate === 0 || indeterminate / days.length >= 0.3) {
    return { risk: 'undetermined', score: null };
  }
  // 与引擎 buildSummary 同口径：只有高/中风险日计入有效分，其余日不把分数稀释成假低分。
  const scored = days
    .map(pick)
    .filter((x): x is { score: number; risk: RiskLevel } => x.score !== null && (x.risk === 'high' || x.risk === 'medium'));
  const maxScore = scored.length ? Math.max(...scored.map((x) => x.score)) : null;
  if (maxScore === null) return { risk: 'low', score: null };
  const meanScore = scored.reduce((s, x) => s + x.score, 0) / scored.length;
  const effective = Math.round(0.7 * maxScore + 0.3 * meanScore);
  const deficitDays = days.filter((d) => d.classification === 'supply_shortfall' || d.classification === 'local_equipment').length;
  if (effective >= 65) return { risk: 'high', score: effective };
  if (effective >= 40 || deficitDays >= 2) return { risk: 'medium', score: effective };
  if (days.some((d) => d.classification === 'local_equipment')) return { risk: 'medium', score: effective };
  return { risk: 'low', score: effective };
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

export function evaluateBias(input: BiasInput): BiasEvaluationSuite {
  const { probes, config, buildingDays, series } = input;
  const active = new Set(probes.filter((p) => (series.get(p.id)?.byDay.size ?? 0) > 0).map((p) => p.id));
  const gateIssueCounts: Partial<Record<BiasGateCode, number>> = {};
  let comparisonPointCount = 0;
  let routeAEligible = 0;
  let routeAAdjusted = 0;

  const assessments: ProbeBiasAssessment[] = [];
  const adjustmentByProbe = new Map<string, SegmentAdjustment[]>();
  const driftByProbe = new Map<string, number>();
  const segmentWindowByProbe = new Map<string, { startTs: number; endTs: number }[]>();
  const modelApplicableProbes = new Set<string>();
  const modelNotes: string[] = [];

  // 路线 B：先按楼栋拟合，探头不足时回退到全小区同类型池化。
  const buildings = [...new Set(probes.map((p) => p.buildingId))];
  const notApplicable: BiasEvaluationSuite['routeBNotApplicable'] = [];
  const applicableBuildings: string[] = [];
  const pooledBuildings: string[] = [];
  const modelFitByProbe = new Map<string, ModelFit>();
  const pooledFit = fitHierarchical(input, probes, '全小区池化', true);
  for (const buildingId of buildings) {
    const buildingProbes = probes.filter((p) => p.buildingId === buildingId);
    const fit = fitHierarchical(input, buildingProbes, `楼栋 ${buildingId} `, false);
    if (fit) {
      applicableBuildings.push(buildingId);
      for (const p of buildingProbes) modelFitByProbe.set(p.id, fit);
      continue;
    }
    const activeCount = buildingProbes.filter((p) => active.has(p.id)).length;
    if (pooledFit) {
      pooledBuildings.push(buildingId);
      for (const p of buildingProbes) {
        if (active.has(p.id)) modelFitByProbe.set(p.id, pooledFit);
      }
      notApplicable.push({
        buildingId,
        reason: `楼栋内有效探头 ${activeCount} 个，低于模型下限 ${config.biasModelMinProbes}；已回退全小区池化，个体结论借用同类型探头信息，预测区间相应更宽。`,
      });
    } else {
      notApplicable.push({
        buildingId,
        reason: `楼栋内有效探头 ${activeCount} 个且全小区池化样本仍不足，路线 B 不适用。`,
      });
    }
  }
  if (pooledFit) {
    modelNotes.push(...pooledFit.notes);
    for (const id of modelFitByProbe.keys()) modelApplicableProbes.add(id);
  }

  for (const probe of probes) {
    if (!active.has(probe.id)) continue;
    const segments = segmentsFor(probe, input.windowStartTs, input.windowEndTs);
    segmentWindowByProbe.set(
      probe.id,
      segments.map((s) => ({ startTs: s.startTs, endTs: s.endTs })),
    );
    const neighbors = resolveNeighbors(probe, probes, active);
    const robust: RobustNeighborEstimate[] = [];
    const model: HierarchicalProbeEstimate[] = [];
    const notes: string[] = [];

    for (const segment of segments) {
      const r = robustForSegment(input, probe, segment, neighbors);
      robust.push(r);
      comparisonPointCount += r.points.length;
      for (const code of r.gate.reasons) gateIssueCounts[code] = (gateIssueCounts[code] ?? 0) + 1;
      if (r.gate.adjustmentAllowed) routeAEligible += 1;
      if (r.adjustmentC !== 0) {
        routeAAdjusted += 1;
        const list = adjustmentByProbe.get(probe.id) ?? [];
        list.push({ startTs: segment.startTs, endTs: segment.endTs, adjustmentC: r.adjustmentC, segmentIndex: segment.segmentIndex });
        adjustmentByProbe.set(probe.id, list);
      }

      const fit = modelFitByProbe.get(probe.id);
      const applicabilityNotes: string[] = [];
      let applicable = false;
      let positionEffectC: number | null = null;
      let driftEffectC: number | null = null;
      let intervalHalfWidthC: number | null = null;
      let shrinkage = 0;
      let sampleCount = 0;
      if (fit) {
        const pe = fit.positionEffect.get(probe.id);
        const de = fit.driftEffect.get(probe.id);
        if (pe !== undefined && de !== undefined) {
          applicable = true;
          positionEffectC = pe;
          driftEffectC = de;
          intervalHalfWidthC = fit.halfWidth.get(probe.id) ?? null;
          shrinkage = fit.shrinkage.get(probe.id) ?? 0;
          sampleCount = fit.sampleCount.get(probe.id) ?? 0;
          applicabilityNotes.push(...fit.notes);
          if (fit.pooled) applicabilityNotes.push('该结论来自全小区池化：本楼栋探头不足，个体随机效应借用同类型探头，适用范围限于相同外墙/朝向/房间类型。');
          if (shrinkage < 0.5) applicabilityNotes.push('收缩系数 < 0.5，探头级估计大量向总体收缩，个体漂移区间偏宽。');
          if (segments.length > 1) applicabilityNotes.push('模型为整窗估计，不随更换/改造事件拆段；拆段归因以路线 A 各段邻近证据为准。');
          driftByProbe.set(probe.id, de);
        }
      }
      if (!applicable) {
        applicabilityNotes.unshift('有效探头或供热日不足，层级模型不适用；该段只保留路线 A 的逐项邻近证据。');
        gateIssueCounts.model_not_applicable = (gateIssueCounts.model_not_applicable ?? 0) + 1;
      }
      const modelGate = emptyGate();
      if (!segment.positionEvidence) modelGate.reasons.push('missing_position_evidence');
      if (segment.calibrationStatus !== 'valid') {
        modelGate.reasons.push(segment.calibrationStatus === 'missing' ? 'missing_certificate' : 'certificate_expired');
      }
      model.push({
        route: 'hierarchical_model',
        segmentIndex: segment.segmentIndex,
        positionEffectC,
        driftEffectC,
        intervalHalfWidthC,
        intervalLevel: config.biasModelIntervalLevel,
        shrinkage,
        sampleCount,
        applicable,
        applicabilityNotes,
        gate: modelGate,
      });
    }

    // 位置效应与漂移的分量区间：取绝对差值最大的段作为探头级代表，各段明细仍在 robust 中可回查。
    let range: ProbeBiasAssessment['indistinguishableRangeC'] = null;
    const withDelta = robust.filter((r) => r.persistentDeltaC !== null && r.persistentDeltaC !== undefined);
    const primary = withDelta.length
      ? withDelta.reduce((a, b) => (Math.abs(b.persistentDeltaC!) > Math.abs(a.persistentDeltaC!) ? b : a))
      : robust[0];
    if (primary?.persistentDeltaC !== null && primary.persistentDeltaC !== undefined) {
      const observed = primary.persistentDeltaC;
      const basis: string[] = [];
      let positionLower: number;
      let positionUpper: number;
      let driftLower: number;
      let driftUpper: number;
      if (primary.gate.adjustmentAllowed) {
        // 门控通过：证据支持观测差值全部由固定安装位置解释，漂移分量归零。
        positionLower = observed;
        positionUpper = observed;
        driftLower = 0;
        driftUpper = 0;
        basis.push(`门控通过，观测差值 ${observed}℃ 全部计入固定安装位置效应，漂移分量为 0；原始读数仍不修改。`);
      } else if (Math.abs(observed) < config.biasMinPersistentDeltaC) {
        positionLower = 0;
        positionUpper = observed;
        driftLower = Math.min(0, observed);
        driftUpper = 0;
        basis.push(`观测差值 ${observed}℃ 低于证据下限 ${config.biasMinPersistentDeltaC}℃，位置与漂移分量均无法确认，不做自动校正。`);
      } else {
        const drift = driftByProbe.get(probe.id);
        const certBias = (probe.certificates ?? []).find((c) => c.id === segments[0]?.certificateId)?.biasAt20C ?? null;
        // 漂移分量参考：优先层级模型随机效应，其次证书示值偏差；都没有时漂移区间从 0 起。
        const driftHint = drift ?? certBias ?? 0;
        const dLo = round(Math.min(0, driftHint, observed), 2);
        const dHi = 0;
        driftLower = dLo;
        driftUpper = dHi;
        positionLower = round(observed - dHi, 2);
        positionUpper = round(observed - dLo, 2);
        if (drift !== undefined) {
          basis.push(`层级模型探头随机效应 ${drift}℃（估计值，非实测）作为漂移分量参考；其余差值归位置效应，两分量之和恒等于观测差值 ${observed}℃。`);
        } else if (certBias !== null) {
          basis.push(`证书 20℃ 示值偏差 ${certBias}℃ 作为漂移分量参考；证书过期/缺失时该参考仅作区间端点，不触发校正。`);
        } else {
          basis.push('无证书也无模型估计可用，漂移分量区间从 0 起，全部差值都可能是位置效应或真实局部低温。');
        }
      }
      range = {
        observedDeltaC: observed,
        positionComponent: { lowerC: positionLower, upperC: positionUpper },
        driftComponent: { lowerC: driftLower, upperC: driftUpper },
        basis,
      };
    } else {
      notes.push('窗口内没有可比邻近供热日，无法估计位置偏差，原始读数保持唯一视图。');
    }

    assessments.push({
      probeId: probe.id,
      buildingId: probe.buildingId,
      segments,
      robust,
      model,
      indistinguishableRangeC: range,
      gate: mergeGates(robust.map((r) => r.gate)),
      notes,
    });
  }

  // 楼栋风险敏感性三视图。
  const buildingSensitivity: BuildingBiasSensitivity[] = [];
  for (const buildingId of buildings) {
    const days = buildingDays.filter((d) => d.buildingId === buildingId);
    const raw = aggregateBuilding(days, (d) => ({ score: d.riskScore, risk: d.risk }));
    const adjustedView = aggregateBuilding(days, (d) => adjustedDayScore(d, adjustmentByProbe, config));
    // 区间下界（最有利于供热方的解释）：在路线 A 各段调整之上，对模型适用且预测区间
    // 仍支持负漂移的探头，在“未被路线 A 调整”的段内追加漂移修正试探。
    const boundAdjustment = new Map<string, SegmentAdjustment[]>();
    for (const [probeId, segs] of adjustmentByProbe) boundAdjustment.set(probeId, segs.map((s) => ({ ...s })));
    for (const [probeId, drift] of driftByProbe) {
      const probe = probes.find((p) => p.id === probeId);
      if (probe?.buildingId !== buildingId) continue;
      if (!(drift < 0 && modelApplicableProbes.has(probeId))) continue;
      const hw = modelFitByProbe.get(probeId)?.halfWidth.get(probeId) ?? 0;
      if (drift + hw > 0) continue;
      const windows = segmentWindowByProbe.get(probeId) ?? [];
      const existing = boundAdjustment.get(probeId) ?? [];
      for (const w of windows) {
        if (existing.some((s) => s.startTs === w.startTs && s.adjustmentC !== 0)) continue;
        existing.push({ startTs: w.startTs, endTs: w.endTs, adjustmentC: round(Math.abs(drift), 2), segmentIndex: -1 });
      }
      boundAdjustment.set(probeId, existing);
    }
    const lowerView = aggregateBuilding(days, (d) => adjustedDayScore(d, boundAdjustment, config));
    const driving = assessments
      .filter((a) => a.buildingId === buildingId)
      .filter((a) => a.robust.some((r) => (r.persistentDeltaC ?? 0) !== 0 || r.gate.reasons.length > 0))
      .map((a) => a.probeId);
    const explanation: string[] = [];
    for (const a of assessments.filter((x) => x.buildingId === buildingId)) {
      for (const r of a.robust) {
        if (r.persistentDeltaC !== null) {
          explanation.push(
            `${a.probeId} 段${r.segmentIndex}：邻近中位差 ${r.persistentDeltaC}℃，${r.gate.adjustmentAllowed ? `门控通过，调整视图修正 ${r.adjustmentC}℃` : '门控未通过，保持原始读数'}。`,
          );
        }
      }
    }
    buildingSensitivity.push({
      buildingId,
      rawRisk: raw.risk,
      rawRiskScore: raw.score,
      adjustedRisk: adjustedView.risk,
      adjustedRiskScore: adjustedView.score,
      rangeBound: {
        lowerRisk: lowerView.risk,
        lowerScore: lowerView.score,
        upperRisk: raw.risk,
        upperScore: raw.score,
      },
      changed: JSON.stringify([adjustedView.risk, adjustedView.score]) !== JSON.stringify([raw.risk, raw.score]),
      drivingProbeIds: driving,
      explanation,
    });
  }

  return {
    engineVersion: input.engineVersion,
    generatedAt: input.now,
    routeAEligibleSegments: routeAEligible,
    routeAAdjustedSegments: routeAAdjusted,
    routeBApplicableBuildingIds: applicableBuildings,
    routeBPooledBuildingIds: pooledBuildings,
    routeBNotApplicable: notApplicable,
    gateIssueCounts,
    probeAssessments: assessments,
    buildingSensitivity,
    comparisonPointCount,
    modelSpec: {
      formula: 'y(探头,供热日) = δ_供热日(吸收天气) + 楼栋截距 + 外墙/冷朝向/楼层/房间类型固定效应 + u_探头(向0收缩) + ε',
      covariates: ['building_intercept', 'external_wall', 'cold_orientation(north/west)', 'floor', 'room_type', 'day_fixed_effect(outdoor)'],
      intervalLevel: config.biasModelIntervalLevel,
      note: modelNotes.join(' ') || '层级模型未产生有效拟合（样本不足），路线 B 整体不适用。',
    },
  };
}

function mergeGates(gates: BiasGateResult[]): BiasGateResult {
  const reasons = new Set<BiasGateCode>();
  const detail: string[] = [];
  for (const g of gates) {
    g.reasons.forEach((r) => reasons.add(r));
    detail.push(...g.detail);
  }
  return { adjustmentAllowed: false, reasons: [...reasons], detail };
}

/** 供引擎/UI 复用：判断某探头在某时刻适用哪张证书。 */
export function activeCertificate(certs: CalibrationCertificate[], ts: number): CalibrationCertificate | null {
  const { status, certificateId } = certificateStatusAt(certs, ts, ts + 1);
  if (status !== 'valid') return null;
  return certs.find((c) => c.id === certificateId) ?? null;
}

/** 供热日键工具，供 UI 段时间轴展示复用。 */
export function segmentDayKeys(segment: ProbeBiasSegment, heatingDayStartHour: number): string[] {
  const startKey = heatingDayKey(segment.startTs, heatingDayStartHour);
  const endKey = heatingDayKey(segment.endTs - 1, heatingDayStartHour);
  const out: string[] = [];
  let cur = startKey;
  let guard = 0;
  while (cur <= endKey && guard < 400) {
    out.push(cur);
    cur = new Date(Date.parse(`${cur}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    guard += 1;
  }
  return out;
}
