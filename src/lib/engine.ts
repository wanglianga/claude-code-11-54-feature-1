/**
 * Deterministic analysis engine.
 *
 * Base table: building × heating-day coverage, computed independently of complaints.
 * Complaints are attached afterwards as interpretation evidence.
 */
import type {
  AddressAssertion,
  AlignmentIssue,
  AnalysisConfig,
  BaselineInfo,
  BlindSpot,
  Building,
  BuildingDayResult,
  BuildingSummary,
  Complaint,
  ComplaintEpisodeEvidence,
  ComplaintResult,
  ComplaintSupportSummary,
  DayClass,
  DayCoverage,
  DeficitEpisode,
  EpisodeKind,
  EvidenceRef,
  Gap,
  HourPoint,
  ImportBatch,
  InputRef,
  Probe,
  ProbeDayStat,
  RunResult,
  RunTotals,
  WeatherObs,
  WorkOrder,
} from '../types';
import { matchBuildingsInText, resolveComplaintAddress } from './address';
import {
  dayEndTs,
  dayStartTs,
  enumerateDayKeys,
  fmtDayLabel,
  fmtLocal,
  heatingDayKey,
  minutesBetween,
  nightWindow,
  overlapMinutes,
} from './time';

export const ENGINE_VERSION = 'engine-1.4.0';

export interface EngineInputs {
  batches: ImportBatch[];
  buildings: Building[];
  probes: Probe[];
  assertions: AddressAssertion[];
  config: AnalysisConfig;
  /** Data delivery cutoff; batches ingested after this are excluded. */
  cutoffTs?: number;
}

function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function quantile(values: number[], q: number): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function round(n: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

/** Interpolated outdoor temperature lookup; null when weather coverage is too sparse. */
function makeWeatherLookup(weather: WeatherObs[], maxGapMs: number) {
  const sorted = [...weather].sort((a, b) => a.ts - b.ts);
  return (ts: number): number | null => {
    if (sorted.length === 0) return null;
    let lo = 0;
    let hi = sorted.length - 1;
    if (ts < sorted[0].ts - maxGapMs || ts > sorted[sorted.length - 1].ts + maxGapMs) return null;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid].ts <= ts) lo = mid;
      else hi = mid;
    }
    const a = sorted[lo];
    const b = sorted[Math.min(hi, sorted.length - 1)];
    if (Math.abs(a.ts - ts) <= maxGapMs) {
      if (b.ts === a.ts) return a.tempC;
      const t = Math.max(0, Math.min(1, (ts - a.ts) / (b.ts - a.ts)));
      return a.tempC + (b.tempC - a.tempC) * t;
    }
    if (Math.abs(b.ts - ts) <= maxGapMs) return b.tempC;
    return null;
  };
}

interface ProbeSeries {
  probe: Probe;
  readings: { ts: number; v: number }[];
  byDay: Map<string, { ts: number; v: number }[]>;
}

function groupProbeSeries(
  probes: Probe[],
  readings: { sensorId: string; ts: number; valueC: number }[],
  config: AnalysisConfig,
): { series: Map<string, ProbeSeries>; unknownSensors: Map<string, number> } {
  const probeIds = new Set(probes.map((p) => p.id));
  const unknownSensors = new Map<string, number>();
  const buckets = new Map<string, { ts: number; v: number }[]>();
  for (const r of readings) {
    if (!probeIds.has(r.sensorId)) {
      unknownSensors.set(r.sensorId, (unknownSensors.get(r.sensorId) ?? 0) + 1);
      continue;
    }
    let list = buckets.get(r.sensorId);
    if (!list) {
      list = [];
      buckets.set(r.sensorId, list);
    }
    list.push({ ts: r.ts, v: r.valueC });
  }
  const series = new Map<string, ProbeSeries>();
  for (const probe of probes) {
    const list = (buckets.get(probe.id) ?? []).sort((a, b) => a.ts - b.ts);
    const byDay = new Map<string, { ts: number; v: number }[]>();
    for (const row of list) {
      const key = heatingDayKey(row.ts, config.heatingDayStartHour);
      let day = byDay.get(key);
      if (!day) {
        day = [];
        byDay.set(key, day);
      }
      day.push(row);
    }
    series.set(probe.id, { probe, readings: list, byDay });
  }
  return { series, unknownSensors };
}

function findGaps(
  points: { ts: number }[],
  windowStart: number,
  windowEnd: number,
  intervalMs: number,
  factor: number,
): { gaps: Gap[]; coveredMs: number } {
  const sorted = points.filter((p) => p.ts >= windowStart && p.ts <= windowEnd).map((p) => p.ts);
  const gaps: Gap[] = [];
  const maxGap = intervalMs * factor;
  let covered = 0;
  if (sorted.length === 0) {
    return { gaps: [{ startTs: windowStart, endTs: windowEnd, minutes: Math.round(minutesBetween(windowStart, windowEnd)) }], coveredMs: 0 };
  }
  const firstGap = sorted[0] - windowStart;
  if (firstGap > maxGap) {
    gaps.push({ startTs: windowStart, endTs: sorted[0], minutes: Math.round(firstGap / 60_000) });
  } else {
    covered += Math.max(0, firstGap);
  }
  for (let i = 1; i < sorted.length; i += 1) {
    const delta = sorted[i] - sorted[i - 1];
    if (delta > maxGap) {
      gaps.push({ startTs: sorted[i - 1], endTs: sorted[i], minutes: Math.round(delta / 60_000) });
    } else {
      covered += delta;
    }
  }
  const tail = windowEnd - sorted[sorted.length - 1];
  if (tail > maxGap) {
    gaps.push({ startTs: sorted[sorted.length - 1], endTs: windowEnd, minutes: Math.round(tail / 60_000) });
  } else {
    covered += Math.max(0, tail);
  }
  return { gaps, coveredMs: covered };
}

function expectedCount(windowMs: number, intervalMin: number): number {
  return Math.max(1, Math.floor(windowMs / (intervalMin * 60_000)) + 1);
}

interface BaselineAggregate {
  indoor: number | null;
  outdoor: number | null;
  indoorDays: number;
  source: BaselineInfo['source'];
  dayKeys: string[];
}

interface EngineContext {
  config: AnalysisConfig;
  beds: { startTs: number; endTs: number };
  buildings: Building[];
  probes: Probe[];
  series: Map<string, ProbeSeries>;
  weatherAt: (ts: number) => number | null;
  weatherCountIn: (a: number, b: number, stepMs: number) => number;
  orders: WorkOrder[];
  ordersByBuilding: Map<string, WorkOrder[]>;
  batchesByKind: Map<string, ImportBatch[]>;
  dayKeys: string[];
  buildingBaselines: Map<string, BaselineInfo>;
  assertions: AddressAssertion[];
  probesByBuilding: Map<string, Probe[]>;
  coverageCache: Map<string, DayCoverage>;
}

function buildCoverage(
  ctx: EngineContext,
  buildingId: string,
  dayKey: string,
): DayCoverage & { probeStats: ProbeDayStat[] } {
  const cacheKey = `${buildingId}@${dayKey}`;
  const cached = ctx.coverageCache.get(cacheKey);
  if (cached) {
    return cached as DayCoverage & { probeStats: ProbeDayStat[] };
  }
  const start = dayStartTs(dayKey, ctx.config.heatingDayStartHour);
  const end = dayEndTs(dayKey, ctx.config.heatingDayStartHour);
  const night = nightWindow(dayKey, ctx.config.heatingDayStartHour, ctx.config.nightStartHour, ctx.config.nightEndHour);
  const windowMs = end - start;
  const nightMs = night.endTs - night.startTs;
  const probes = (ctx.probesByBuilding.get(buildingId) ?? []).filter((p) => {
    if (p.installedAt && p.installedAt > end) return false;
    if (p.removedAt && p.removedAt < start) return false;
    return true;
  });

  const probeStats: ProbeDayStat[] = [];
  let expected = 0;
  let received = 0;
  let nightExpected = 0;
  let nightReceived = 0;
  const notes: string[] = [];
  const activeProbeIds: string[] = [];

  for (const probe of probes) {
    const series = ctx.series.get(probe.id);
    const dayPoints = series?.byDay.get(dayKey) ?? [];
    const intervalMs = probe.intervalMin * 60_000;
    const exp = expectedCount(windowMs, probe.intervalMin);
    const { gaps, coveredMs } = findGaps(dayPoints, start, end, intervalMs, ctx.config.outageGapFactor);
    const expNight = expectedCount(nightMs, probe.intervalMin);
    const nightPoints = dayPoints.filter((p) => p.ts >= night.startTs && p.ts < night.endTs);
    const coverageRatio = Math.min(1, coveredMs / windowMs);
    const values = dayPoints.map((p) => p.v);
    expected += exp;
    received += Math.min(exp, dayPoints.length);
    nightExpected += expNight;
    nightReceived += Math.min(expNight, nightPoints.length);
    if (dayPoints.length > 0) activeProbeIds.push(probe.id);
    probeStats.push({
      probeId: probe.id,
      expected: exp,
      received: dayPoints.length,
      coverageRatio: round(coverageRatio, 3),
      gaps,
      medianIndoorC: values.length ? round(median(values), 2) : null,
      medianResidualC: null,
    });
    if (gaps.length > 0) {
      const biggest = gaps.reduce((a, b) => (a.minutes > b.minutes ? a : b));
      notes.push(`${probe.id} 覆盖 ${(coverageRatio * 100).toFixed(0)}%，最长中断 ${biggest.minutes} 分钟`);
    }
  }

  const coverageRatio = expected > 0 ? Math.min(1, received / expected) : 0;
  const nightCoverageRatio = nightExpected > 0 ? Math.min(1, nightReceived / nightExpected) : 0;
  const weatherExpected = Math.max(1, Math.floor(windowMs / (30 * 60_000)));
  const weatherCoverage = ctx.weatherCountIn(start, end, 30 * 60_000) / weatherExpected;

  const result = {
    expected,
    received,
    coverageRatio: round(coverageRatio, 3),
    nightExpected,
    nightReceived,
    nightCoverageRatio: round(nightCoverageRatio, 3),
    weatherCoverageRatio: round(Math.min(1, weatherCoverage), 3),
    activeProbeIds,
    probes: probeStats,
    hasNoProbe: probes.length === 0,
    notes,
    probeStats,
  };
  if (probes.length === 0) {
    result.notes = ['该楼栋未登记室温探头，无法建立监测覆盖。'];
  }
  ctx.coverageCache.set(cacheKey, result);
  return result;
}

function detectDeficitEpisodes(
  ctx: EngineContext,
  buildingId: string,
  dayKey: string,
  coverage: DayCoverage,
  baseline: GlobalBaseline,
): DeficitEpisode[] {
  const config = ctx.config;
  const start = dayStartTs(dayKey, config.heatingDayStartHour);
  const end = dayEndTs(dayKey, config.heatingDayStartHour);
  const probes = (ctx.probesByBuilding.get(buildingId) ?? []).filter(
    (p) => coverage.activeProbeIds.includes(p.id),
  );
  if (probes.length === 0) return [];

  const threshold = config.comfortThresholdC;
  const delta = config.deficitDeltaC;
  // Combined low-sample detection: reading below comfort threshold and below its probe baseline.
  const eventTimes: number[] = [];
  const lowByProbe = new Map<string, number[]>();
  for (const probe of probes) {
    const series = ctx.series.get(probe.id)!;
    const dayPoints = series.byDay.get(dayKey) ?? [];
    const probeBase = baseline.byProbe.get(probe.id)?.valueC ?? baseline.indoor;
    const times: number[] = [];
    for (const p of dayPoints) {
      if (p.ts < start || p.ts >= end) continue;
      const isLow = p.v < threshold && (probeBase === null || p.v <= probeBase - delta);
      if (isLow) {
        times.push(p.ts);
        eventTimes.push(p.ts);
      }
    }
    lowByProbe.set(probe.id, times);
  }
  if (eventTimes.length === 0) return [];

  eventTimes.sort((a, b) => a - b);
  const minSamples = Math.max(2, Math.ceil((config.sustainedMinHours * 60) / 30));
  const episodes: DeficitEpisode[] = [];
  let runStart = eventTimes[0];
  let prev = eventTimes[0];
  let runSamples = 1;
  const runs: { start: number; end: number; samples: number }[] = [];
  for (let i = 1; i < eventTimes.length; i += 1) {
    if (eventTimes[i] - prev <= 20 * 60_000) {
      prev = eventTimes[i];
      runSamples += 1;
    } else {
      runs.push({ start: runStart, end: prev, samples: runSamples });
      runStart = eventTimes[i];
      prev = eventTimes[i];
      runSamples = 1;
    }
  }
  runs.push({ start: runStart, end: prev, samples: runSamples });

  for (const run of runs) {
    const durMin = minutesBetween(run.start, run.end);
    if (run.samples < Math.min(minSamples, 3) && durMin < 30) continue;
    // Collect affected probes and their stats in this run.
    const affectedProbes: string[] = [];
    const lowValues: number[] = [];
    for (const [probeId, times] of lowByProbe) {
      const hit = times.filter((t) => t >= run.start && t <= run.end);
      if (hit.length === 0) continue;
      affectedProbes.push(probeId);
      const series = ctx.series.get(probeId)!;
      for (const p of series.byDay.get(dayKey) ?? []) {
        if (p.ts >= run.start && p.ts <= run.end) lowValues.push(p.v);
      }
    }
    if (affectedProbes.length === 0) continue;
    const coveringProbes = probes.length;
    const breadth = affectedProbes.length / Math.max(1, coveringProbes);
    const night = nightWindow(dayKey, config.heatingDayStartHour, config.nightStartHour, config.nightEndHour);
    const nightMin = Math.max(0, Math.min(run.end, night.endTs) - Math.max(run.start, night.startTs)) / 60_000;
    const overlappingOrders = (ctx.ordersByBuilding.get(buildingId) ?? []).filter(
      (o) => o.startTs < run.end + 10 * 60_000 && run.start < o.endTs + 10 * 60_000,
    );
    const suppressor = overlappingOrders.find((o) => o.kind === 'supply_suspension');

    let kind: EpisodeKind = 'unclassified';
    const durationMin = Math.max(durMin, run.samples * 15);
    if (durationMin <= config.windowOpeningMaxMinutes) {
      // Brief dips are non-evidence regardless of how many probes saw them.
      kind = 'transient';
    } else if (breadth <= 0.5) {
      // One probe out of several: local riser / valve / household-side problem.
      kind = 'local_equipment';
    } else if (suppressor) {
      kind = 'supply_shortfall';
    } else if (durationMin >= config.sustainedMinHours * 60) {
      kind = 'supply_shortfall';
    } else {
      kind = 'unclassified';
    }
    const meanDeficit = lowValues.length
      ? round(Math.abs(median(lowValues) - (baseline.indoor ?? threshold)), 2)
      : 0;
    const dayStart = dayStartTs(dayKey, config.heatingDayStartHour);
    episodes.push({
      id: `${buildingId}-${dayKey}-${Math.round((run.start - dayStart) / 60_000)}`,
      startTs: run.start,
      endTs: run.end,
      durationMin: Math.round(durationMin),
      affectedProbeIds: affectedProbes,
      activeProbeCount: coveringProbes,
      breadth: round(breadth, 2),
      kind,
      minIndoorC: lowValues.length ? round(Math.min(...lowValues), 2) : threshold,
      meanDeficitC: meanDeficit,
      nightMinutes: Math.round(nightMin),
      workOrderIds: overlappingOrders.map((o) => o.id),
      sampleCount: lowValues.length,
      evidenceRefs: [],
      lowerBoundMin: Math.max(0, Math.round(durationMin - 20)),
      upperBoundMin: Math.round(durationMin + 20),
    });
  }
  return episodes;
}

interface GlobalBaseline {
  indoor: number | null;
  byBuilding: Map<string, BaselineInfo>;
  byProbe: Map<string, BaselineInfo>;
  weatherMedian: number | null;
  daysUsed: string[];
}

/**
 * Robust baseline: per-probe p50 of a stable reference set of days (same window, excluding
 * deficit-like days later). A p20/p80 range is retained as uncertainty.
 */
function computeBaselines(
  ctx: { config: AnalysisConfig; probes: Probe[]; series: Map<string, ProbeSeries>; dayKeys: string[]; buildings: Building[]; probesByBuilding: Map<string, Probe[]>; weatherAt: (ts: number) => number | null },
): GlobalBaseline {
  const byProbe = new Map<string, BaselineInfo>();
  const byBuilding = new Map<string, BaselineInfo>();
  const indoorValues: number[] = [];
  const dayMediansPerProbe = new Map<string, { dayKey: string; median: number }[]>();

  for (const probe of ctx.probes) {
    const series = ctx.series.get(probe.id);
    if (!series) continue;
    const perDay: { dayKey: string; median: number; count: number }[] = [];
    for (const dayKey of ctx.dayKeys) {
      const points = series.byDay.get(dayKey) ?? [];
      if (points.length < 3) continue;
      perDay.push({ dayKey, median: median(points.map((p) => p.v)), count: points.length });
    }
    if (perDay.length === 0) continue;
    dayMediansPerProbe.set(probe.id, perDay.map((d) => ({ dayKey: d.dayKey, median: d.median })));
    const usable = perDay.filter((d) => d.count >= 3);
    const stable = selectStableDays(usable, ctx.config.baselineMinDays);
    const medians = stable.map((d) => d.median);
    if (medians.length === 0) continue;
    const value = round(median(medians), 2);
    const p20 = round(quantile(medians, 0.2), 2);
    const p80 = round(quantile(medians, 0.8), 2);
    indoorValues.push(...medians);
    byProbe.set(probe.id, {
      valueC: value,
      p20C: p20,
      p80C: p80,
      daysUsed: stable.length,
      source: stable.length >= ctx.config.baselineMinDays ? 'stable' : 'fallback',
      dayKeys: stable.map((d) => d.dayKey),
    });
  }

  for (const building of ctx.buildings) {
    const probes = ctx.probesByBuilding.get(building.id) ?? [];
    const values = probes
      .map((p) => byProbe.get(p.id))
      .filter((b): b is BaselineInfo => !!b && b.valueC !== null);
    if (values.length === 0) {
      byBuilding.set(building.id, { valueC: null, p20C: null, p80C: null, daysUsed: 0, source: 'none', dayKeys: [] });
      continue;
    }
    const vals = values.map((v) => v.valueC!);
    byBuilding.set(building.id, {
      valueC: round(median(vals), 2),
      p20C: round(quantile(vals, 0.2), 2),
      p80C: round(quantile(vals, 0.8), 2),
      daysUsed: Math.min(...values.map((v) => v.daysUsed)),
      source: values.some((v) => v.source === 'stable') ? 'stable' : 'fallback',
      dayKeys: values[0].dayKeys,
    });
  }

  const weatherSamples: number[] = [];
  for (const dayKey of ctx.dayKeys) {
    const start = dayStartTs(dayKey, ctx.config.heatingDayStartHour);
    for (let t = start; t < start + 24 * 3_600_000; t += 30 * 60_000) {
      const temp = ctx.weatherAt(t);
      if (temp !== null) weatherSamples.push(temp);
    }
  }
  return {
    indoor: indoorValues.length ? round(median(indoorValues), 2) : null,
    byBuilding,
    byProbe,
    weatherMedian: weatherSamples.length ? round(median(weatherSamples), 2) : null,
    daysUsed: ctx.dayKeys,
  };
}

/** Pick the most stable contiguous spell of days for baseline, avoiding top/bottom outliers. */
function selectStableDays<T extends { dayKey: string; median: number }>(days: T[], minDays: number): T[] {
  if (days.length <= Math.max(minDays, 3)) return days;
  const sorted = [...days].sort((a, b) => a.median - b.median);
  const trim = Math.max(1, Math.floor(sorted.length * 0.15));
  const core = sorted.slice(trim, sorted.length - trim);
  const keep = core.length >= minDays ? core : sorted.slice(trim);
  // Keep at least minDays even when window is short.
  const chosen = keep.length >= Math.min(minDays, days.length) ? keep : sorted;
  return chosen;
}

function classifyDay(
  config: AnalysisConfig,
  coverage: DayCoverage,
  baseline: BaselineInfo,
  episodes: DeficitEpisode[],
  documentedOrders: WorkOrder[],
  hasProbe: boolean,
): { cls: DayClass; documented: boolean; risk: BuildingDayResult['risk']; score: number | null; explanation: string[]; uncertainties: string[] } {
  const explanation: string[] = [];
  const uncertainties: string[] = [];

  if (!hasProbe) {
    return {
      cls: 'insufficient_coverage',
      documented: false,
      risk: 'undetermined',
      score: null,
      explanation: ['楼栋未登记室温探头，无法建立当日监测覆盖。', '没有监测不代表没有供热问题，需按监测盲区处理。'],
      uncertainties: ['该楼栋全窗口无任何室内读数，结论不可由监测数据支持。'],
    };
  }

  const coverageOk = coverage.coverageRatio >= config.minCoverageRatio;
  const nightOk = coverage.nightCoverageRatio >= config.minNightCoverageRatio;
  const weatherOk = coverage.weatherCoverageRatio >= 0.5;

  if (!coverageOk || !nightOk) {
    explanation.push(
      `监测覆盖不足：当日读数覆盖 ${(coverage.coverageRatio * 100).toFixed(0)}%（要求 ≥ ${(config.minCoverageRatio * 100).toFixed(0)}%），夜间覆盖 ${(coverage.nightCoverageRatio * 100).toFixed(0)}%。`,
    );
    const biggest = coverage.probes
      .flatMap((p) => p.gaps.map((g) => ({ probeId: p.probeId, g })))
      .sort((a, b) => b.g.minutes - a.g.minutes)[0];
    if (biggest) {
      explanation.push(`最长数据中断来自 ${biggest.probeId}：${fmtLocal(biggest.g.startTs)} 至 ${fmtLocal(biggest.g.endTs)}（${biggest.g.minutes} 分钟）。`);
    }
    explanation.push('该日不参与「供热是否充足」的判断，标记为无法判断。');
    uncertainties.push('覆盖不足的时段可能恰好包含停供或设备故障，现有数据无法确认。');
    return {
      cls: 'insufficient_coverage',
      documented: false,
      risk: 'undetermined',
      score: null,
      explanation,
      uncertainties,
    };
  }

  if (baseline.source === 'none' || baseline.valueC === null) {
    explanation.push('该楼栋缺少可用基线（稳定日不足），无法把低读数与自身正常水平比较。');
    uncertainties.push('仅凭绝对阈值判断会把正常偏冷住户误判为异常。');
    return {
      cls: 'insufficient_coverage',
      documented: false,
      risk: 'undetermined',
      score: null,
      explanation,
      uncertainties,
    };
  }

  if (!weatherOk) {
    explanation.push(`气象覆盖偏低（${(coverage.weatherCoverageRatio * 100).toFixed(0)}%），室外温度对齐可靠性下降。`);
    uncertainties.push('室外温度插值误差可能改变低温归因。');
  }

  const documented = documentedOrders.some((o) => o.kind === 'supply_suspension');
  const maintenance = documentedOrders.filter((o) => o.kind === 'valve_adjustment' || o.kind === 'maintenance' || o.kind === 'complaint_visit');

  if (episodes.length === 0) {
    // Suppression: work order says suspended but readings stayed normal.
    if (documented) {
      explanation.push('工单记录当日有停供，但探头读数未出现可识别的低温事件。');
      uncertainties.push('可能是停供时段过短、探头位于受影响单元之外，或工单时段登记不准确；监测与工单无法可靠对齐。');
      return {
        cls: 'unreliable_alignment',
        documented,
        risk: 'undetermined',
        score: null,
        explanation,
        uncertainties,
      };
    }
    explanation.push('当日读数覆盖达标，未出现持续低温事件。');
    if (maintenance.length) {
      explanation.push(`工单为${maintenance.map((m) => m.kind).join(' / ')}，未形成室温异常。`);
    }
    return { cls: 'normal', documented: false, risk: 'low', score: 0, explanation, uncertainties };
  }

  const sustained = episodes.filter((e) => e.kind === 'supply_shortfall');
  const transient = episodes.filter((e) => e.kind === 'transient');
  const local = episodes.filter((e) => e.kind === 'local_equipment');
  const unclassified = episodes.filter((e) => e.kind === 'unclassified');

  if (sustained.length > 0) {
    explanation.push(
      sustained
        .map(
          (e) =>
            `${fmtLocal(e.startTs)}–${fmtLocal(e.endTs)} 持续 ${e.durationMin} 分钟低温，影响 ${e.affectedProbeIds.length}/${e.activeProbeCount} 个探头（${(e.breadth * 100).toFixed(0)}% 覆盖率），最低 ${e.minIndoorC}℃。`,
        )
        .join(' '),
    );
    if (documented) explanation.push('同期存在供热企业停供工单，监测与工单相互印证。');
    else explanation.push('未发现同期停供工单，但低温持续时间超过持续不足阈值，仍按供热不足处理。');
    if (coverage.weatherCoverageRatio < 0.8) uncertainties.push('气象数据有缺测，低温与室外温度的分解存在误差。');
    const worst = sustained.reduce((a, b) => (a.meanDeficitC > b.meanDeficitC ? a : b));
    const sev = worst.minIndoorC <= config.severeThresholdC && (worst.nightMinutes > 0 || worst.durationMin >= 240);
    const score = Math.min(
      100,
      round(
        55 +
          Math.min(25, worst.durationMin / 12) +
          Math.min(15, worst.meanDeficitC * 4) +
          (documented ? 10 : 0) +
          (sev ? 8 : 0),
        0,
      ),
    );
    return {
      cls: 'supply_shortfall',
      documented,
      risk: sev ? 'high' : 'medium',
      score,
      explanation,
      uncertainties,
    };
  }

  if (local.length > 0) {
    const e = local[0];
    explanation.push(
      `${fmtLocal(e.startTs)}–${fmtLocal(e.endTs)} 仅 ${e.affectedProbeIds.join('、')} 出现低温，占比 ${(e.breadth * 100).toFixed(0)}%，其余 ${e.activeProbeCount - e.affectedProbeIds.length} 个探头正常。`,
    );
    if (maintenance.length) explanation.push('同期工单为阀门调整 / 维护，指向局部设备问题。');
    else explanation.push('分布形态指向局部设备或住户侧问题，而非整栋停供。');
    uncertainties.push('探头数量有限，局部判断的分辨率受安装位置影响。');
    const score = Math.min(60, round(40 + Math.min(12, e.durationMin / 20) + Math.min(8, e.meanDeficitC * 2), 0));
    return {
      cls: 'local_equipment',
      documented,
      risk: score >= 45 ? 'medium' : 'low',
      score,
      explanation,
      uncertainties,
    };
  }

  if (transient.length > 0) {
    const e = transient[0];
    explanation.push(
      `${fmtLocal(e.startTs)}–${fmtLocal(e.endTs)} 短时下降（${e.durationMin} 分钟），影响 ${e.affectedProbeIds.length}/${e.activeProbeCount} 个探头，最短 ${e.minIndoorC}℃。`,
    );
    explanation.push(`持续时间低于短时扰动上限（${config.windowOpeningMaxMinutes} 分钟），不作为停供证据。`);
    uncertainties.push('短时下降可能来自开窗、通风或探头周边扰动，无法区分。');
    return { cls: 'transient_disturbance', documented, risk: 'low', score: 20, explanation, uncertainties };
  }

  if (unclassified.length > 0) {
    explanation.push('出现短于持续不足阈值、但非单探头的低温片段，规则不足以归类。');
    uncertainties.push('需要更多探头或工单证据才能判断。');
    return { cls: 'unreliable_alignment', documented, risk: 'undetermined', score: null, explanation, uncertainties };
  }
  return { cls: 'normal', documented: false, risk: 'low', score: 0, explanation, uncertainties };
}

function makeRefsForDay(
  ctx: EngineContext,
  buildingId: string,
  startTs: number,
  endTs: number,
  probeIds: string[],
): EvidenceRef[] {
  const refs: EvidenceRef[] = [];
  const readingsBatches = ctx.batchesByKind.get('readings') ?? [];
  if (readingsBatches.length && probeIds.length) {
    refs.push({
      batchId: readingsBatches[0].id,
      fileName: readingsBatches.map((b) => b.fileName).join(' + '),
      fileHash: readingsBatches[0].fileHash,
      kind: undefined as never,
      note: `室温读数 ${probeIds.join('、')}，时段 ${fmtLocal(startTs)}–${fmtLocal(endTs)}`,
      sensors: probeIds,
      rangeStartTs: startTs,
      rangeEndTs: endTs,
    } as EvidenceRef);
  }
  const weatherBatches = ctx.batchesByKind.get('weather') ?? [];
  if (weatherBatches.length) {
    refs.push({
      batchId: weatherBatches[0].id,
      fileName: weatherBatches[0].fileName,
      fileHash: weatherBatches[0].fileHash,
      note: '室外温度插值',
      rangeStartTs: startTs,
      rangeEndTs: endTs,
    } as EvidenceRef);
  }
  const orderBatches = ctx.batchesByKind.get('work_orders') ?? [];
  if (orderBatches.length) {
    refs.push({
      batchId: orderBatches[0].id,
      fileName: orderBatches.map((b) => b.fileName).join(' + '),
      fileHash: orderBatches[0].fileHash,
      note: '工单时段交集',
      rangeStartTs: startTs,
      rangeEndTs: endTs,
    } as EvidenceRef);
  }
  return refs;
}

function buildSummary(
  config: AnalysisConfig,
  building: Building,
  days: BuildingDayResult[],
  probes: Probe[],
  complaints: ComplaintResult[],
  allDayKeys: string[],
): BuildingSummary {
  const classCounts: Record<DayClass, number> = {
    normal: 0,
    transient_disturbance: 0,
    local_equipment: 0,
    supply_shortfall: 0,
    insufficient_coverage: 0,
    unreliable_alignment: 0,
  };
  let deficitDays = 0;
  let documentedDeficitDays = 0;
  let observedHours = 0;
  let documentedHours = 0;
  let indeterminateDays = 0;
  let eqSum = 0;
  let alignSum = 0;
  let alignN = 0;
  for (const d of days) {
    classCounts[d.classification] += 1;
    if (d.classification === 'supply_shortfall' || d.classification === 'local_equipment') deficitDays += 1;
    if (d.documented) documentedDeficitDays += 1;
    for (const e of d.episodes) {
      if (e.kind === 'supply_shortfall' || e.kind === 'local_equipment') {
        observedHours += e.durationMin / 60;
        if (e.workOrderIds.length > 0) documentedHours += e.durationMin / 60;
      }
    }
    if (d.classification === 'insufficient_coverage' || d.classification === 'unreliable_alignment') indeterminateDays += 1;
    eqSum += d.equipmentConfidence;
    if (d.alignmentConfidence >= 0) {
      alignSum += d.alignmentConfidence;
      alignN += 1;
    }
  }
  const coverageSum = days.length
    ? days.reduce((s, d) => s + d.coverage.coverageRatio, 0) / days.length
    : 0;
  const nightSum = days.length
    ? days.reduce((s, d) => s + d.coverage.nightCoverageRatio, 0) / days.length
    : 0;

  const scored = days.filter((d) => d.risk === 'high' || d.risk === 'medium').map((d) => d.riskScore ?? 0);
  const riskScores = days.map((d) => (d.riskScore === null ? null : d.riskScore));
  const hasUndetermined = days.some((d) => d.risk === 'undetermined');
  const maxScore = scored.length ? Math.max(...scored) : null;
  const meanScore = scored.length ? scored.reduce((a, b) => a + b, 0) / scored.length : null;
  const effective = maxScore === null ? null : round(0.7 * maxScore + 0.3 * (meanScore ?? maxScore), 0);

  let risk: BuildingSummary['risk'] = 'low';
  const evaluatedCount = days.length - indeterminateDays;
  if (days.length === 0 || evaluatedCount === 0) {
    risk = 'undetermined';
  } else if (indeterminateDays / days.length >= 0.3) {
    // Coverage gaps are large enough that a "low risk" reading would be misleading.
    risk = 'undetermined';
  } else if (effective !== null && effective >= 65) {
    risk = 'high';
  } else if (effective !== null && (effective >= 40 || deficitDays >= 2)) {
    risk = 'medium';
  } else if (classCounts.local_equipment > 0) {
    risk = 'medium';
  } else {
    risk = 'low';
  }
  void hasUndetermined;

  const support: ComplaintSupportSummary = {
    total: complaints.length,
    supported: complaints.filter((c) => c.status === 'supported').length,
    partial: complaints.filter((c) => c.status === 'partial').length,
    contradicted: complaints.filter((c) => c.status === 'contradicted').length,
    misaligned: complaints.filter((c) => c.status === 'misaligned').length,
    unverifiable: complaints.filter((c) => c.status === 'unverifiable').length,
    unassigned: 0,
  };

  const blindSpot = probes.length === 0 || (days.length > 0 && days.every((d) => d.classification === 'insufficient_coverage'));

  let headline = '';
  if (probes.length === 0) {
    headline = '无室温探头，监测盲区';
  } else if (risk === 'undetermined') {
    headline = `数据不足，无法判断（${indeterminateDays}/${days.length} 个供热日覆盖不足）`;
  } else if (risk === 'high') {
    headline = `${deficitDays} 个供热日出现持续低温，需现场核查`;
  } else if (risk === 'medium') {
    headline =
      classCounts.local_equipment > 0 && classCounts.supply_shortfall === 0
        ? `局部设备问题：${classCounts.local_equipment} 个供热日仅部分探头偏低`
        : `${deficitDays} 个供热日低温，局部或短时为主`;
  } else if (indeterminateDays > 0) {
    headline = `窗口内未见持续供热不足；另有 ${indeterminateDays} 个供热日无法判断`;
  } else {
    headline = '窗口内未见持续供热不足';
  }

  return {
    buildingId: building.id,
    name: building.name,
    complex: building.complex,
    probeCount: probes.length,
    risk,
    riskScore: effective,
    classCounts,
    deficitDays,
    documentedDeficitDays,
    observedDeficitHours: round(observedHours, 1),
    coverageRatio: round(coverageSum, 3),
    nightCoverageRatio: round(nightSum, 3),
    equipmentConfidence: round(eqSum / Math.max(1, days.length), 2),
    alignmentConfidence: round(alignSum / Math.max(1, alignN), 2),
    indeterminateDays,
    blindSpot,
    complaint: support,
    headline,
  };
  void config;
  void allDayKeys;
  void riskScores;
  void documentedHours;
}

function equipmentConfidenceFor(
  ctx: EngineContext,
  buildingId: string,
  dayKey: string,
  coverage: DayCoverage,
): number {
  const flat = coverage.probes.filter((p) => p.received > 1);
  if (flat.length === 0) return 0;
  let score = 0;
  let weight = 0;
  for (const stat of coverage.probes) {
    const series = ctx.series.get(stat.probeId);
    if (!series) continue;
    const points = series.byDay.get(dayKey) ?? [];
    if (points.length < 3) continue;
    const values = points.map((p) => p.v);
    const med = median(values);
    const mad = median(values.map((v) => Math.abs(v - med)));
    let probeScore = 1;
    if (mad < 0.05) probeScore -= 0.15; // sticky sensor
    if (stat.coverageRatio < ctx.config.minCoverageRatio) probeScore -= 0.35;
    if (stat.gaps.length > 0) probeScore -= Math.min(0.3, stat.gaps.length * 0.05);
    score += probeScore * stat.received;
    weight += stat.received;
  }
  return weight ? round(Math.max(0, Math.min(1, score / weight)), 2) : 0;
}

function alignmentConfidenceFor(
  ctx: EngineContext,
  buildingId: string,
  dayKey: string,
  coverage: DayCoverage,
  episodes: DeficitEpisode[],
  documentedSuspension: WorkOrder[],
): number {
  let score = 0.55;
  if (coverage.coverageRatio >= ctx.config.minCoverageRatio) score += 0.15;
  if (coverage.nightCoverageRatio >= ctx.config.minNightCoverageRatio) score += 0.05;
  if (coverage.weatherCoverageRatio >= 0.6) score += 0.05;
  if (documentedSuspension.length && episodes.some((e) => e.kind !== 'transient')) score += 0.15;
  if (documentedSuspension.length && episodes.length === 0) score -= 0.4;
  if (episodes.some((e) => e.kind === 'transient')) score -= 0.1;
  return round(Math.max(0, Math.min(1, score)), 2);
}

function hourlySeries(
  ctx: EngineContext,
  buildingId: string,
  dayKey: string,
  threshold: number,
): HourPoint[] {
  const start = dayStartTs(dayKey, ctx.config.heatingDayStartHour);
  const end = dayEndTs(dayKey, ctx.config.heatingDayStartHour);
  const probes = ctx.probesByBuilding.get(buildingId) ?? [];
  const out: HourPoint[] = [];
  for (let t = start; t < end; t += 60 * 60_000) {
    let sum = 0;
    let n = 0;
    const low: string[] = [];
    for (const probe of probes) {
      const series = ctx.series.get(probe.id);
      if (!series) continue;
      const points = (series.byDay.get(dayKey) ?? []).filter((p) => p.ts >= t && p.ts < t + 3_600_000);
      if (points.length === 0) continue;
      const med = median(points.map((p) => p.v));
      sum += med;
      n += 1;
      if (points.some((p) => p.v < threshold)) low.push(probe.id);
    }
    out.push({
      ts: t,
      indoorC: n ? round(sum / n, 2) : null,
      outdoorC: ctx.weatherAt(t + 30 * 60_000),
      lowProbeIds: low,
    });
  }
  return out;
}

export function runAnalysis(inputs: EngineInputs): RunResult {
  const { config, buildings, probes, assertions } = inputs;
  const cutoffTs = inputs.cutoffTs ?? Number.POSITIVE_INFINITY;
  const included = inputs.batches.filter((b) => b.ingestedAt <= cutoffTs);

  const readings: { sensorId: string; ts: number; valueC: number }[] = [];
  const weather: WeatherObs[] = [];
  const allOrders: WorkOrder[] = [];
  const allComplaints: Complaint[] = [];
  const batchesByKind = new Map<string, ImportBatch[]>();
  for (const batch of included) {
    const list = batchesByKind.get(batch.kind) ?? [];
    list.push(batch);
    batchesByKind.set(batch.kind, list);
    if (batch.kind === 'readings') {
      for (const r of batch.data.readings ?? []) readings.push(r);
    } else if (batch.kind === 'weather') {
      for (const w of batch.data.weather ?? []) weather.push(w);
    } else if (batch.kind === 'work_orders') {
      for (const o of batch.data.workOrders ?? []) allOrders.push(o);
    } else if (batch.kind === 'complaints') {
      for (const c of batch.data.complaints ?? []) allComplaints.push(c);
    }
  }

  const dayKeys = enumerateDayKeys(config.windowStartDay, config.windowEndDay);
  const startTs = dayStartTs(dayKeys[0] ?? config.windowStartDay, config.heatingDayStartHour);
  const endTs = dayEndTs(dayKeys[dayKeys.length - 1] ?? config.windowEndDay, config.heatingDayStartHour);

  // Deduplicate readings across batches: same sensor+timestamp → later batch wins.
  const readKeyMap = new Map<string, { sensorId: string; ts: number; valueC: number }>();
  let duplicateReadingsRemoved = 0;
  for (const r of readings) {
    const key = `${r.sensorId}@${r.ts}`;
    if (readKeyMap.has(key)) duplicateReadingsRemoved += 1;
    readKeyMap.set(key, r);
  }
  const dedupedReadings = [...readKeyMap.values()];
  const outOfWindowReadings = dedupedReadings.filter((r) => r.ts < startTs || r.ts >= endTs).length;

  const { series } = groupProbeSeries(probes, dedupedReadings, config);

  const probesByBuilding = new Map<string, Probe[]>();
  for (const p of probes) {
    const list = probesByBuilding.get(p.buildingId) ?? [];
    list.push(p);
    probesByBuilding.set(p.buildingId, list);
  }

  // Work-order building resolution is exact on aliases; unresolved orders are flagged.
  const buildingAliasMap = new Map<string, string>();
  for (const b of buildings) {
    for (const alias of [b.name, `${b.complex}${b.name}`, ...b.aliases]) {
      buildingAliasMap.set(alias.replace(/\s/g, ''), b.id);
    }
  }
  const unresolvedOrders: WorkOrder[] = [];
  const orders: WorkOrder[] = allOrders.map((o) => {
    const raw = (o.rawBuilding ?? '').replace(/\s/g, '');
    let bid = buildingAliasMap.get(raw) ?? null;
    if (!bid) {
      // Digit-boundary aware match; ambiguous mentions stay unresolved.
      const hits = matchBuildingsInText(raw, buildings);
      if (hits.length === 1) bid = hits[0];
    }
    if (!bid) unresolvedOrders.push(o);
    return { ...o, buildingId: bid };
  });
  const ordersByBuilding = new Map<string, WorkOrder[]>();
  for (const o of orders) {
    if (!o.buildingId) continue;
    const list = ordersByBuilding.get(o.buildingId) ?? [];
    list.push(o);
    ordersByBuilding.set(o.buildingId, list);
  }

  const weatherSorted = [...weather].sort((a, b) => a.ts - b.ts);
  const maxGap = 3 * 3_600_000;
  const weatherAt = makeWeatherLookup(weatherSorted, maxGap);
  const weatherCountIn = (a: number, b: number) =>
    weatherSorted.filter((w) => w.ts >= a && w.ts < b).length;

  const coverageCache = new Map<string, DayCoverage>();
  const baselineCtx = { config, probes, series, dayKeys, buildings, probesByBuilding, weatherAt };
  const baselines = computeBaselines(baselineCtx);

  const ctx: EngineContext = {
    config,
    beds: { startTs, endTs },
    buildings,
    probes,
    series,
    weatherAt,
    weatherCountIn,
    orders,
    ordersByBuilding,
    batchesByKind,
    dayKeys,
    buildingBaselines: baselines.byBuilding,
    assertions,
    probesByBuilding,
    coverageCache,
  };

  const buildingDays: BuildingDayResult[] = [];
  const alignmentIssues: AlignmentIssue[] = [];

  for (const b of buildings) {
    for (const dayKey of dayKeys) {
      const dayStart = dayStartTs(dayKey, config.heatingDayStartHour);
      const dayEnd = dayEndTs(dayKey, config.heatingDayStartHour);
      const coverage = buildCoverage(ctx, b.id, dayKey);
      const dayOrders = (ordersByBuilding.get(b.id) ?? []).filter(
        (o) => o.startTs < dayEnd && dayStart < o.endTs,
      );
      const documentedSuspension = dayOrders.filter((o) => o.kind === 'supply_suspension');
      const episodes = detectDeficitEpisodes(ctx, b.id, dayKey, coverage, {
        indoor: baselines.byBuilding.get(b.id)?.valueC ?? baselines.indoor,
        byBuilding: baselines.byBuilding,
        byProbe: baselines.byProbe,
        weatherMedian: baselines.weatherMedian,
        daysUsed: baselines.daysUsed,
      });
      for (const ep of episodes) {
        ep.evidenceRefs = makeRefsForDay(ctx, b.id, ep.startTs, ep.endTs, ep.affectedProbeIds);
      }
      const baseInfo: BaselineInfo = baselines.byBuilding.get(b.id) ?? {
        valueC: null,
        p20C: null,
        p80C: null,
        daysUsed: 0,
        source: 'none',
        dayKeys: [],
      };
      const cls = classifyDay(config, coverage, baseInfo, episodes, dayOrders, probesByBuilding.has(b.id));
      const equipmentConfidence = equipmentConfidenceFor(ctx, b.id, dayKey, coverage);
      const alignmentConfidence = alignmentConfidenceFor(ctx, b.id, dayKey, coverage, episodes, documentedSuspension);
      const hourly = hourlySeries(ctx, b.id, dayKey, config.comfortThresholdC);
      const refs = makeRefsForDay(ctx, b.id, dayStart, dayEnd, coverage.activeProbeIds);

      const uncertainties = [...cls.uncertainties];
      if (equipmentConfidence < 0.5 && coverage.activeProbeIds.length > 0) {
        uncertainties.push(`设备可信度偏低（${(equipmentConfidence * 100).toFixed(0)}%），读数质量影响结论。`);
      }
      if (alignmentConfidence < 0.5) {
        uncertainties.push(`对齐可信度偏低（${(alignmentConfidence * 100).toFixed(0)}%），监测与工单难以互相印证。`);
      }
      if (dayOrders.some((o) => o.kind !== 'supply_suspension') && episodes.length > 0) {
        uncertainties.push('存在阀门调整/维护工单，可能影响局部流量。');
      }
      buildingDays.push({
        id: `${b.id}@${dayKey}`,
        buildingId: b.id,
        buildingName: b.name,
        complex: b.complex,
        dayKey,
        dayStartTs: dayStart,
        dayEndTs: dayEnd,
        classification: cls.cls,
        risk: cls.risk,
        riskScore: cls.score,
        documented: cls.documented,
        coverage,
        baseline: baseInfo,
        episodes,
        equipmentConfidence,
        alignmentConfidence,
        uncertainties,
        explanation: [...cls.explanation, ...(coverage.hasNoProbe ? [] : coverage.notes.slice(0, 2))],
        complaintIds: [],
        hourly,
        workOrderIds: dayOrders.map((o) => o.id),
        refs,
      });
    }
  }

  // ---------- complaints ----------
  const probesByBuildingLabels = new Map<string, string[]>();
  for (const [bid, list] of probesByBuilding) probesByBuildingLabels.set(bid, list.map((p) => p.label));
  const complaints: ComplaintResult[] = [];
  let unresolvedAddresses = 0;
  for (const complaint of allComplaints) {
    const resolution = resolveComplaintAddress(
      complaint.rawAddress,
      buildings,
      probesByBuildingLabels,
      assertions,
      config.complaintMatchMinScore,
    );
    if (resolution.mode === 'unassigned' || resolution.mode === 'ambiguous') unresolvedAddresses += 1;
    const padMs = config.complaintPaddingMin * 60_000;
    const winStart = complaint.windowStartTs - padMs;
    const winEnd = complaint.windowEndTs + padMs;
    const daySet = new Set<string>();
    for (let t = complaint.windowStartTs; t <= complaint.windowEndTs; t += 15 * 60_000) {
      daySet.add(heatingDayKey(t, config.heatingDayStartHour));
    }
    const complaintDayKeys = [...daySet];
    const windowInRun = complaintDayKeys.some((k) => dayKeys.includes(k));

    const assigned = resolution.chosen;
    const episodes: ComplaintEpisodeEvidence[] = [];
    let readingsCount = 0;
    let expected = 0;
    let probeCount = 0;
    let coverageSum = 0;
    let coverageN = 0;
    const ordersHit: ComplaintResult['workOrders'] = [];
    const refs: EvidenceRef[] = [];

    for (const bid of assigned) {
      const buildingProbes = probesByBuilding.get(bid) ?? [];
      probeCount += buildingProbes.length;
      for (const probe of buildingProbes) {
        const series = ctx.series.get(probe.id);
        if (!series) continue;
        const hits = series.readings.filter((p) => p.ts >= winStart && p.ts <= winEnd);
        readingsCount += hits.length;
        expected += expectedCount(winEnd - winStart, probe.intervalMin);
      }
      for (const bd of buildingDays) {
        if (bd.buildingId !== bid) continue;
        if (!complaintDayKeys.includes(bd.dayKey)) continue;
        coverageSum += bd.coverage.coverageRatio;
        coverageN += 1;
        for (const ep of bd.episodes) {
          if (ep.endTs < winStart || ep.startTs > winEnd) continue;
          episodes.push({
            episodeId: ep.id,
            startTs: ep.startTs,
            endTs: ep.endTs,
            kind: ep.kind,
            minIndoorC: ep.minIndoorC,
          });
          const bdRefs = ep.evidenceRefs;
          refs.push(...bdRefs.map((r) => ({ ...r, note: `投诉窗口 ${fmtLocal(winStart)}–${fmtLocal(winEnd)} · ${r.note}` })));
        }
        for (const oid of bd.workOrderIds) {
          const order = orders.find((o) => o.id === oid);
          if (!order) continue;
          if (order.endTs < winStart || order.startTs > winEnd) continue;
          if (!ordersHit.some((x) => x.id === oid)) {
            ordersHit.push({ id: order.id, kind: order.kind, startTs: order.startTs, endTs: order.endTs, summary: order.summary });
          }
        }
      }
    }
    // Prefer day-level coverage; fall back to raw sample counts inside the padded window.
    const windowCoverage = expected > 0 ? Math.min(1, readingsCount / expected) : 0;
    const coverageRatio = coverageN ? Math.min(1, Math.max(coverageSum / coverageN, windowCoverage)) : windowCoverage;
    const complaintsBatches = batchesByKind.get('complaints') ?? [];
    refs.push({
      batchId: complaintsBatches[0]?.id ?? 'n/a',
      fileName: complaintsBatches.map((b) => b.fileName).join(' + ') || '投诉文件',
      fileHash: complaintsBatches[0]?.fileHash ?? '',
      note: `原始投诉 ${complaint.id}（第 ${complaint.line} 行）：${complaint.text.slice(0, 40)}`,
    });

    let status: ComplaintResult['status'] = 'unverifiable';
    let uncertainty = '';
    const explanation: string[] = [];
    if (assigned.length === 0) {
      status = 'unassigned';
      uncertainty =
        resolution.mode === 'ambiguous'
          ? '地址同时指向多个楼栋，保留未归属以免误判。'
          : '地址无法定位到登记楼栋，保留未归属。';
      explanation.push(resolution.message);
      if (resolution.candidates.length) {
        explanation.push(`候选：${resolution.candidates.map((c) => `${c.buildingId}(${c.score.toFixed(2)})`).join('、')}`);
      }
    } else if (!windowInRun) {
      status = 'unverifiable';
      uncertainty = '投诉时段不在本次分析窗口内。';
      explanation.push('投诉发生在运行窗口之外，本次运行未评估该时段。');
    } else if (probeCount === 0) {
      status = 'unverifiable';
      uncertainty = '目标楼栋没有室温探头，投诉无法用监测数据核实（监测盲区）。';
      explanation.push('楼栋未登记探头，无法核实投诉时段的室温。');
      const hasSuspension = ordersHit.some((o) => o.kind === 'supply_suspension');
      if (hasSuspension) {
        explanation.push('同期存在停供工单，可作为侧面线索，但缺少室温读数佐证。');
        uncertainty = '仅有工单线索，缺少室温读数；不能据此认定供热不足。';
      }
    } else if (coverageRatio < config.minCoverageRatio) {
      status = 'unverifiable';
      uncertainty = `投诉时段监测覆盖仅 ${(coverageRatio * 100).toFixed(0)}%，低于 ${(config.minCoverageRatio * 100).toFixed(0)}% 下限。`;
      explanation.push('探头覆盖不足，无法可靠核实投诉。');
    } else {
      const strong = episodes.filter((e) => e.kind === 'supply_shortfall');
      const local = episodes.filter((e) => e.kind === 'local_equipment');
      const transient = episodes.filter((e) => e.kind === 'transient');
      const hasSuspension = ordersHit.some((o) => o.kind === 'supply_suspension');
      if (strong.length > 0) {
        const ep = strong[0];
        const epMinutes = minutesBetween(ep.startTs, ep.endTs);
        const windowMinutes = minutesBetween(complaint.windowStartTs, complaint.windowEndTs);
        const overlap = Math.min(ep.endTs, complaint.windowEndTs) - Math.max(ep.startTs, complaint.windowStartTs);
        const ratio = windowMinutes > 0 ? Math.min(1, overlap / 60_000 / windowMinutes) : 0;
        if (ratio >= 0.5 || hasSuspension) {
          status = 'supported';
          explanation.push(
            `投诉时段内存在持续低温（${fmtLocal(ep.startTs)}–${fmtLocal(ep.endTs)}，最低 ${ep.minIndoorC}℃），覆盖投诉时段的 ${(ratio * 100).toFixed(0)}%。`,
          );
          if (hasSuspension) explanation.push('同期停供工单与低温时段吻合。');
          uncertainty = '室温探头为室内单点测量，无法反映投诉住户的具体位置。';
        } else {
          status = 'partial';
          explanation.push('投诉时段部分重叠持续低温，重叠比例不足一半。');
          uncertainty = '时段边界模糊，低温与投诉时段的对应关系为部分支持。';
        }
      } else if (local.length > 0) {
        status = episodes.length && transient.length >= episodes.length ? 'partial' : 'partial';
        explanation.push(
          `仅局部探头出现低温（${local[0].minIndoorC}℃），整栋未形成持续不足，投诉可能对应局部设备或住户侧问题。`,
        );
        uncertainty = '投诉具体门牌无法定位到探头所在单元，支持度为部分。';
      } else if (transient.length > 0) {
        const ep = transient[0];
        status = 'partial';
        explanation.push(
          `投诉时段仅有 ${Math.round(minutesBetween(ep.startTs, ep.endTs))} 分钟的局部探头短时下降（最低 ${ep.minIndoorC}℃），低于短时扰动上限，不作为停供证据。`,
        );
        explanation.push('短时下降可以解释投诉人的体感，但不足以认定整栋供热不足。');
        uncertainty = '短时下降可能来自开窗通风、探头周边扰动，或投诉描述的具体时刻未落在采集间隔内。';
      } else if (hasSuspension) {
        status = 'misaligned';
        explanation.push('工单记录停供，但投诉时段探头读数未见对应低温；监测与工单无法可靠对齐。');
        uncertainty = '工单时段或探头安装位置可能有误，二者无法互相印证。';
      } else {
        status = 'contradicted';
        explanation.push('投诉时段探头覆盖达标，读数均在舒适阈值以上，未支持投诉描述。');
        uncertainty = '探头位置不代表全部住户，个别房间仍可能偏冷。';
      }
    }

    const mappingMode: ComplaintResult['mappingMode'] =
      assigned.length === 0
        ? resolution.mode === 'ambiguous'
          ? 'ambiguous'
          : 'unassigned'
        : resolution.mode === 'manual'
          ? 'manual'
          : 'auto';

    const result: ComplaintResult = {
      complaintId: complaint.id,
      rawAddress: complaint.rawAddress,
      text: complaint.text,
      channel: complaint.channel,
      windowStartTs: complaint.windowStartTs,
      windowEndTs: complaint.windowEndTs,
      windowInRun,
      candidates: resolution.candidates,
      assignedBuildingIds: assigned,
      mappingMode,
      mappingConfidence: resolution.confidence,
      status,
      dayKeys: complaintDayKeys,
      coverageRatio: round(coverageRatio, 3),
      readingsCount,
      episodes,
      workOrders: ordersHit,
      explanation,
      uncertainty,
      refs,
    };
    complaints.push(result);
    // Attach complaint ids to matching building days.
    for (const bid of assigned) {
      for (const bd of buildingDays) {
        if (bd.buildingId === bid && complaintDayKeys.includes(bd.dayKey)) bd.complaintIds.push(complaint.id);
      }
    }
  }

  // ---------- summaries, blind spots, totals ----------
  const summaries: BuildingSummary[] = buildings.map((b) => {
    const days = buildingDays.filter((d) => d.buildingId === b.id);
    const cps = complaints.filter((c) => c.assignedBuildingIds.includes(b.id));
    const summary = buildSummary(config, b, days, probesByBuilding.get(b.id) ?? [], cps, dayKeys);
    summary.complaint.unassigned = complaints.filter((c) => c.status === 'unassigned' && c.candidates.some((x) => x.buildingId === b.id)).length;
    return summary;
  });

  const blindSpots: BlindSpot[] = summaries
    .filter((s) => s.blindSpot || s.risk === 'undetermined')
    .map((s) => {
      const days = buildingDays.filter((d) => d.buildingId === s.buildingId);
      const affectedDays = days
        .filter((d) => d.classification === 'insufficient_coverage' || d.classification === 'unreliable_alignment')
        .map((d) => d.dayKey);
      const cps = complaints.filter(
        (c) => c.assignedBuildingIds.includes(s.buildingId) && c.status === 'unverifiable',
      );
      const reason =
        s.probeCount === 0
          ? '楼栋未登记室温探头：无投诉不等于无风险。'
          : s.risk === 'undetermined'
            ? `覆盖不足或监测与工单无法对齐：${affectedDays.length} 个供热日无法判断。`
            : `${affectedDays.length} 个供热日无法判断，其余供热日已完成判断。`;
      return {
        buildingId: s.buildingId,
        buildingName: s.name,
        complex: s.complex,
        reason,
        affectedDays,
        complaintCount: cps.length,
      };
    });

  for (const [sensor, count] of groupProbeSeries(probes, dedupedReadings, config).unknownSensors) {
    alignmentIssues.push({
      code: 'unknown_sensor',
      message: `读数中出现未登记探头 ${sensor}（${count} 条），这些读数未参与分析。`,
      count,
      severity: 'warn',
    });
  }
  if (unresolvedOrders.length) {
    alignmentIssues.push({
      code: 'unresolved_order_building',
      message: `${unresolvedOrders.length} 条工单的楼栋无法在登记册中定位：${unresolvedOrders.map((o) => o.id).join('、')}`,
      count: unresolvedOrders.length,
      severity: 'warn',
    });
  }
  const weatherGapDays = new Set<string>();
  for (const dayKey of dayKeys) {
    const st = dayStartTs(dayKey, config.heatingDayStartHour);
    const en = dayEndTs(dayKey, config.heatingDayStartHour);
    const expectedW = Math.floor((en - st) / (30 * 60_000));
    const actualW = weatherCountIn(st, en);
    if (actualW < expectedW * 0.8) weatherGapDays.add(dayKey);
  }
  if (weatherGapDays.size) {
    alignmentIssues.push({
      code: 'weather_gap',
      message: `气象数据覆盖率低于 80% 的供热日：${[...weatherGapDays].map(fmtDayLabel).join('、')}`,
      count: weatherGapDays.size,
      severity: 'warn',
    });
  }
  if (unresolvedAddresses) {
    alignmentIssues.push({
      code: 'unresolved_complaint_address',
      message: `${unresolvedAddresses} 条投诉地址无法唯一归属到楼栋，保持未归属。`,
      count: unresolvedAddresses,
      severity: 'info',
    });
  }
  const multiAssignments = complaints.filter((c) => c.assignedBuildingIds.length > 1);
  if (multiAssignments.length) {
    alignmentIssues.push({
      code: 'multi_building_complaint',
      message: `${multiAssignments.length} 条投诉按人工判断合并到多栋楼（${multiAssignments.map((c) => c.complaintId).join('、')}）。`,
      count: multiAssignments.length,
      severity: 'info',
    });
  }

  const weatherSeries: { ts: number; tempC: number }[] = [];
  for (let t = startTs; t < endTs; t += 3 * 3_600_000) {
    const temp = weatherAt(t);
    if (temp !== null) weatherSeries.push({ ts: t, tempC: round(temp, 2) });
  }

  const evaluatedDays = buildingDays.filter(
    (d) => d.classification !== 'insufficient_coverage' && d.classification !== 'unreliable_alignment',
  );
  const totals: RunTotals = {
    buildings: buildings.length,
    buildingDays: buildingDays.length,
    evaluatedDays: evaluatedDays.length,
    indeterminateDays: buildingDays.length - evaluatedDays.length,
    highRiskBuildings: summaries.filter((s) => s.risk === 'high').length,
    mediumRiskBuildings: summaries.filter((s) => s.risk === 'medium').length,
    lowRiskBuildings: summaries.filter((s) => s.risk === 'low').length,
    undeterminedBuildings: summaries.filter((s) => s.risk === 'undetermined').length,
    complaints: complaints.length,
    supportedComplaints: complaints.filter((c) => c.status === 'supported').length,
    partialComplaints: complaints.filter((c) => c.status === 'partial').length,
    contradictedComplaints: complaints.filter((c) => c.status === 'contradicted').length,
    misalignedComplaints: complaints.filter((c) => c.status === 'misaligned').length,
    unverifiableComplaints: complaints.filter((c) => c.status === 'unverifiable').length,
    unassignedComplaints: complaints.filter((c) => c.status === 'unassigned').length,
    observedDeficitHours: round(evaluatedDays.reduce((s, d) => s + d.episodes.filter((e) => e.kind !== 'transient').reduce((x, e) => x + e.durationMin / 60, 0), 0), 1),
    documentedDeficitHours: round(evaluatedDays.reduce((s, d) => s + d.episodes.filter((e) => e.kind !== 'transient' && e.workOrderIds.length > 0).reduce((x, e) => x + e.durationMin / 60, 0), 0), 1),
    coverageRatio: round(buildingDays.reduce((s, d) => s + d.coverage.coverageRatio, 0) / Math.max(1, buildingDays.length), 3),
  };

  return {
    engineVersion: ENGINE_VERSION,
    generatedAt: 0,
    window: { startDay: config.windowStartDay, endDay: config.windowEndDay, dayKeys },
    config,
    buildingDays,
    buildingSummaries: summaries,
    complaints,
    workOrders: orders.filter((o) => o.buildingId !== null),
    blindSpots,
    alignmentIssues,
    totals,
    weatherSeries,
    mappingUsed: { buildings, probes },
    assertionsUsed: assertions.filter((a) => !a.superseded),
    diagnostics: {
      readingsUsed: dedupedReadings.length,
      weatherUsed: weather.length,
      ordersUsed: orders.length,
      duplicateReadingsRemoved,
      outOfWindowReadings,
      unresolvedAddresses,
    },
  };
}

export function buildInputRefs(batches: ImportBatch[], cutoffTs: number): InputRef[] {
  return batches
    .filter((b) => b.ingestedAt <= cutoffTs)
    .map((b) => ({
      batchId: b.id,
      fileName: b.fileName,
      fileHash: b.fileHash,
      kind: b.kind,
      rowCount: b.rowCount,
      ingestedAt: b.ingestedAt,
      coverageStartTs: b.coverage.startTs,
      coverageEndTs: b.coverage.endTs,
    }));
}

export { round, median, quantile };
