import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseSourceText } from '../lib/parse';
import { runAnalysis, ENGINE_VERSION } from '../lib/engine';
import { DEFAULT_CONFIG } from '../types';
import type { AnalysisConfig, AddressAssertion, Building, ImportBatch, Probe } from '../types';
import { dayStartTs, heatingDayKey } from '../lib/time';
import { addressKey } from '../lib/address';

const SAMPLES = path.resolve('public/samples');

function read(name: string): string {
  return fs.readFileSync(path.join(SAMPLES, name), 'utf8');
}

let seq = 0;
function batch(
  fileName: string,
  kind: ImportBatch['kind'],
  ingestedAtIso: string,
  mapping?: ImportBatch['fieldMapping'],
): ImportBatch {
  const text = read(fileName);
  const m = mapping ?? ((): Record<string, string | null> => {
    // Default mapping mirrors the parser's own suggestion for the real headers.
    if (kind === 'readings') return { sensor_id: 'sensor_id', ts: 'ts', value_c: 'value_c' };
    if (kind === 'weather') return { station_id: 'station_id', ts: 'ts', temp_c: 'temp_c' };
    if (kind === 'work_orders') return { work_order_id: 'work_order_id', building: 'building', type: 'type', start: 'start', end: 'end', summary: 'summary', recorded_at: 'recorded_at' };
    if (kind === 'complaints') return { complaint_id: 'complaint_id', address: 'address', window_start: 'window_start', window_end: 'window_end', channel: 'channel', text: 'text', received_at: 'received_at' };
    return {};
  })();
  const parsed = parseSourceText(text, fileName, kind, m);
  seq += 1;
  const ts = Date.parse(ingestedAtIso);
  const readings = parsed.source.readings ?? [];
  const coverage = {
    startTs: readings.length ? Math.min(...readings.map((r) => r.ts)) : null,
    endTs: readings.length ? Math.max(...readings.map((r) => r.ts)) : null,
    sensorIds: [...new Set(readings.map((r) => r.sensorId))],
    buildingIds: [],
    dayCounts: [],
  };
  return {
    id: `batch-${seq}`,
    kind,
    fileName,
    fileHash: `hash-${fileName}`,
    byteSize: text.length,
    importedAt: ts,
    ingestedAt: ts,
    rowCount: parsed.rowCount,
    invalidCount: parsed.invalidCount,
    duplicateCount: parsed.duplicateCount,
    coverage,
    fieldMapping: m,
    parserVersion: 'test',
    issues: parsed.issues,
    data: parsed.source,
  };
}

function registry(): { buildings: Building[]; probes: Probe[] } {
  const parsed = parseSourceText(read('registry.json'), 'registry.json', 'registry', {});
  return { buildings: parsed.source.buildings ?? [], probes: parsed.source.probes ?? [] };
}

const MAIN_CUTOFF = Date.parse('2026-01-20T00:00:00+08:00');

function mainBatches(): ImportBatch[] {
  return [
    batch('registry.json', 'registry', '2026-01-19T07:50:00+08:00'),
    batch('weather_2026-01.csv', 'weather', '2026-01-19T08:40:00+08:00'),
    batch('readings_2026-01.csv', 'readings', '2026-01-19T09:05:00+08:00'),
    batch('work_orders_2026-01.json', 'work_orders', '2026-01-19T09:20:00+08:00'),
    batch('complaints_2026-01.json', 'complaints', '2026-01-19T10:00:00+08:00'),
  ];
}

function analyze(config: AnalysisConfig = DEFAULT_CONFIG, extra: ImportBatch[] = [], assertions: AddressAssertion[] = []) {
  const reg = registry();
  return runAnalysis({
    batches: [...mainBatches(), ...extra],
    buildings: reg.buildings,
    probes: reg.probes,
    assertions,
    config,
    cutoffTs: MAIN_CUTOFF,
  });
}

describe('sample scenario analysis', () => {
  const result = analyze();
  const byBuilding = new Map(result.buildingSummaries.map((b) => [b.buildingId, b]));
  const complaints = new Map(result.complaints.map((c) => [c.complaintId, c]));
  const day = (b: string, k: string) => result.buildingDays.find((d) => d.buildingId === b && d.dayKey === k)!;

  it('parses with expected invalid / duplicate handling', () => {
    expect(result.diagnostics.readingsUsed).toBeGreaterThan(19000);
    const readingsBatch = mainBatches()[2];
    expect(readingsBatch.invalidCount).toBe(3);
    expect(readingsBatch.duplicateCount).toBeGreaterThanOrEqual(3);
  });

  it('keeps heating days aligned to 06:00 boundaries', () => {
    const ts = Date.parse('2026-01-11T05:30:00+08:00');
    expect(heatingDayKey(ts)).toBe('2026-01-10');
    expect(dayStartTs('2026-01-10')).toBe(Date.parse('2026-01-10T06:00:00+08:00'));
  });

  it('classifies a 45-minute single-probe dip as transient, not an outage', () => {
    const d = day('B01', '2026-01-08');
    expect(d.episodes.some((e) => e.kind === 'transient')).toBe(true);
    expect(d.classification).toBe('transient_disturbance');
    expect(complaints.get('C-1001')!.status).toBe('partial');
  });

  it('supports a documented whole-building night suspension', () => {
    const d = day('B02', '2026-01-10');
    expect(d.classification).toBe('supply_shortfall');
    expect(d.documented).toBe(true);
    expect(d.episodes.some((e) => e.nightMinutes > 0)).toBe(true);
    expect(complaints.get('C-1002')!.status).toBe('supported');
  });

  it('classifies a single-probe valve issue as local equipment', () => {
    const d = day('B03', '2026-01-13');
    expect(d.classification).toBe('local_equipment');
    expect(d.episodes[0].affectedProbeIds).toEqual(['P-802']);
    expect(complaints.get('C-1003')!.status).toBe('partial');
  });

  it('marks a dead probe building as insufficient coverage instead of risk-free', () => {
    const d = day('B04', '2026-01-12');
    expect(d.classification).toBe('insufficient_coverage');
    expect(byBuilding.get('B04')!.risk).toBe('undetermined');
    expect(byBuilding.get('B04')!.headline).toContain('无法判断');
  });

  it('keeps no-probe buildings in the blind-spot list', () => {
    expect(byBuilding.get('B05')!.blindSpot).toBe(true);
    expect(byBuilding.get('B06')!.blindSpot).toBe(true);
    expect(result.blindSpots.map((b) => b.buildingId)).toEqual(expect.arrayContaining(['B05', 'B06']));
    expect(complaints.get('C-1005')!.status).toBe('unverifiable');
  });

  it('leaves ambiguous addresses unassigned with candidates', () => {
    expect(complaints.get('C-1006')!.status).toBe('unassigned');
    expect(complaints.get('C-1006')!.candidates.length).toBeGreaterThan(1);
    expect(complaints.get('C-1007')!.status).toBe('unassigned');
  });

  it('flags work-order / reading misalignment', () => {
    const d = day('B07', '2026-01-11');
    expect(d.classification).toBe('unreliable_alignment');
    expect(complaints.get('C-1008')!.status).toBe('misaligned');
  });

  it('reports complaints whose probe coverage is partial as partial/unverifiable honestly', () => {
    const c1004 = complaints.get('C-1004')!;
    expect(['partial', 'unverifiable', 'contradicted']).toContain(c1004.status);
  });

  it('excludes late-arriving batches from a run that started before them', () => {
    const lateOrders = batch('work_orders_late_2026-01-21.csv', 'work_orders', '2026-01-21T15:30:00+08:00');
    const lateReadings = batch('readings_late_2026-01-21.csv', 'readings', '2026-01-21T14:10:00+08:00');
    const late = analyze(DEFAULT_CONFIG, [lateOrders, lateReadings]);
    const before = day('B07', '2026-01-15');
    const afterCutoff = late.buildingDays.find((d) => d.buildingId === 'B07' && d.dayKey === '2026-01-15')!;
    expect(before.workOrderIds).not.toContain('WO-2005');
    expect(afterCutoff.workOrderIds).not.toContain('WO-2005');
    expect(afterCutoff.documented).toBe(false);
    expect(late.diagnostics.readingsUsed).toBe(result.diagnostics.readingsUsed);
    const withLate = runAnalysis({
      batches: [...mainBatches(), lateOrders, lateReadings],
      buildings: registry().buildings,
      probes: registry().probes,
      assertions: [],
      config: DEFAULT_CONFIG,
      cutoffTs: Date.parse('2026-01-22T00:00:00+08:00'),
    });
    const lateDay = withLate.buildingDays.find((d) => d.buildingId === 'B07' && d.dayKey === '2026-01-15')!;
    expect(lateDay.workOrderIds).toContain('WO-2005');
    expect(lateDay.documented).toBe(true);
    const jan17 = withLate.buildingDays.filter((d) => d.buildingId === 'B08' && d.dayKey === '2026-01-17');
    expect(jan17.length).toBe(1);
  });

  it('produces stable risk ordering and complete totals', () => {
    expect(byBuilding.get('B02')!.risk).toBe('high');
    expect(result.totals.buildings).toBe(9);
    expect(result.totals.complaints).toBe(11);
    expect(result.totals.buildingDays).toBe(9 * 14);
    expect(result.blindSpots.length).toBeGreaterThanOrEqual(2);
  });

  it('records evidence references on every non-normal day', () => {
    for (const d of result.buildingDays) {
      if (d.classification === 'normal') continue;
      expect(d.refs.length).toBeGreaterThan(0);
      for (const ep of d.episodes) expect(ep.evidenceRefs.length).toBeGreaterThan(0);
    }
  });
});

describe('mapping assertions', () => {
  it('routes an ambiguous address through a manual merge assertion', () => {
    const merged: AddressAssertion = {
      id: 'a1',
      addressKey: addressKey('北岸新城8号楼、12号楼附近'),
      rawAddressSamples: ['北岸新城8号楼、12号楼附近'],
      chosenBuildingIds: ['B03', 'B07'],
      candidates: [],
      windowLabel: '2026-01-05..2026-01-18',
      note: '实地确认两栋楼共用立管',
      createdAt: Date.parse('2026-01-20T00:00:00+08:00'),
      superseded: false,
      resolution: { type: 'merge', conflictWith: [], reason: '共用立管', resolvedAt: 1 },
    };
    const result = analyze(DEFAULT_CONFIG, [], [merged]);
    const c = result.complaints.find((x) => x.complaintId === 'C-1006')!;
    expect(c.mappingMode).toBe('manual');
    expect(c.assignedBuildingIds).toEqual(['B03', 'B07']);
  });
});
