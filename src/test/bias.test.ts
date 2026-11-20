import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseSourceText, certificateStatusAt } from '../lib/parse';
import { runAnalysis } from '../lib/engine';
import { segmentsFor } from '../lib/bias';
import { DEFAULT_CONFIG } from '../types';
import type { AnalysisConfig, ImportBatch, Probe } from '../types';

const SAMPLES = path.resolve('public/samples');
const read = (n: string) => fs.readFileSync(path.join(SAMPLES, n), 'utf8');

let seq = 0;
function batch(
  fileName: string,
  kind: ImportBatch['kind'],
  at: string,
  mapping?: ImportBatch['fieldMapping'],
): ImportBatch {
  const text = read(fileName);
  const m = mapping ?? {};
  const parsed = parseSourceText(text, fileName, kind, m);
  seq += 1;
  const ts = Date.parse(at);
  return {
    id: `batch-${seq}`, kind, fileName, fileHash: `hash-${fileName}`, byteSize: text.length,
    importedAt: ts, ingestedAt: ts, rowCount: parsed.rowCount, invalidCount: parsed.invalidCount,
    duplicateCount: parsed.duplicateCount,
    coverage: { startTs: null, endTs: null, sensorIds: [], buildingIds: [], dayCounts: [] },
    fieldMapping: m, parserVersion: 'test', issues: parsed.issues, data: parsed.source,
  };
}

const MAPPINGS = {
  weather: { station_id: 'station_id', ts: 'ts', temp_c: 'temp_c' },
  readings: { sensor_id: 'sensor_id', ts: 'ts', value_c: 'value_c' },
  work_orders: { work_order_id: 'work_order_id', building: 'building', type: 'type', start: 'start', end: 'end', summary: 'summary', recorded_at: 'recorded_at' },
  complaints: { complaint_id: 'complaint_id', address: 'address', window_start: 'window_start', window_end: 'window_end', channel: 'channel', text: 'text', received_at: 'received_at' },
};

function analyze(config: AnalysisConfig = DEFAULT_CONFIG) {
  const reg = parseSourceText(read('registry.json'), 'registry.json', 'registry', {});
  return runAnalysis({
    batches: [
      batch('registry.json', 'registry', '2026-01-19T07:50:00+08:00'),
      batch('weather_2026-01.csv', 'weather', '2026-01-19T08:40:00+08:00', MAPPINGS.weather),
      batch('readings_2026-01.csv', 'readings', '2026-01-19T09:05:00+08:00', MAPPINGS.readings),
      batch('work_orders_2026-01.json', 'work_orders', '2026-01-19T09:20:00+08:00', MAPPINGS.work_orders),
      batch('complaints_2026-01.json', 'complaints', '2026-01-19T10:00:00+08:00', MAPPINGS.complaints),
    ],
    buildings: reg.source.buildings ?? [],
    probes: reg.source.probes ?? [],
    assertions: [],
    config,
    cutoffTs: Date.parse('2026-01-20T00:00:00+08:00'),
  });
}

describe('registry device dossier parsing', () => {
  const parsed = parseSourceText(read('registry.json'), 'registry.json', 'registry', {});
  const probes = parsed.source.probes ?? [];

  it('parses position dossiers, certificates, lifecycle events and neighbor links', () => {
    const p301 = probes.find((p) => p.id === 'P-301')!;
    expect(p301.position?.wallPosition).toBe('external_wall');
    expect(p301.position?.orientation).toBe('north');
    expect(p301.position?.evidenceRef).toBeTruthy();
    expect(p301.certificates?.[0].validUntil).toBeGreaterThan(Date.parse('2026-01-20T00:00:00+08:00'));
    expect(p301.neighborLinks?.[0].probeId).toBe('P-302');
    const p1202 = probes.find((p) => p.id === 'P-1202')!;
    expect(p1202.lifecycleEvents).toHaveLength(1);
    expect(p1202.lifecycleEvents?.[0].kind).toBe('replaced');
    expect(p1202.certificates).toHaveLength(2);
    const p502 = probes.find((p) => p.id === 'P-502')!;
    expect(p502.lifecycleEvents?.[0].kind).toBe('external_wall_works');
  });

  it('flags expired, missing and conflicting certificates without auto-correction', () => {
    const p602 = probes.find((p) => p.id === 'P-602')!;
    const windowStart = Date.parse('2026-01-05T06:00:00+08:00');
    const windowEnd = Date.parse('2026-01-19T06:00:00+08:00');
    expect(certificateStatusAt(p602.certificates ?? [], windowStart, windowEnd).status).toBe('expired');
    expect(certificateStatusAt([], windowStart, windowEnd).status).toBe('missing');
    const conflict = certificateStatusAt(
      [
        { id: 'a', lab: 'l', calibratedAt: 1, validUntil: windowEnd, biasAt20C: -1.2, uncertaintyC: 0.2, documentRef: '', statusNote: '' },
        { id: 'b', lab: 'l', calibratedAt: 1, validUntil: windowEnd, biasAt20C: 1.1, uncertaintyC: 0.2, documentRef: '', statusNote: '' },
      ],
      windowStart,
      windowEnd,
    );
    expect(conflict.status).toBe('conflict');
  });

  it('splits segments on replacement / external-wall works events', () => {
    const p1202 = probes.find((p) => p.id === 'P-1202')!;
    const segments = segmentsFor(p1202, Date.parse('2026-01-05T06:00:00+08:00'), Date.parse('2026-01-19T06:00:00+08:00'));
    expect(segments).toHaveLength(2);
    expect(segments[0].trigger).toBe('window_start');
    expect(segments[1].trigger).toBe('replaced');
    expect(segments[0].certificateId).toBe('CAL-1202-A');
    expect(segments[1].calibrationStatus).toBe('valid');
    expect(segments[1].certificateId).toBe('CAL-1202-B');
  });

  it('parses flat CSV registry rows with position fields', () => {
    const csv = [
      'building_id,building_name,probe_id,probe_building_id,orientation,wall_position,room_type,floor,position_evidence_ref,neighbor_probe_id,neighbor_relation',
      'B1,测试楼,P1,B1,north,external_wall,living_room,3,INST-P1,P2,same_building',
    ].join('\n');
    const out = parseSourceText(csv, 'r.csv', 'registry', {
      building_id: 'building_id', building_name: 'building_name', probe_id: 'probe_id',
      probe_building_id: 'probe_building_id', orientation: 'orientation', wall_position: 'wall_position',
      room_type: 'room_type', floor: 'floor', position_evidence_ref: 'position_evidence_ref',
      neighbor_probe_id: 'neighbor_probe_id', neighbor_relation: 'neighbor_relation',
    });
    const p = out.source.probes![0];
    expect(p.position?.orientation).toBe('north');
    expect(p.position?.wallPosition).toBe('external_wall');
    expect(p.position?.evidenceRef).toBe('INST-P1');
    expect(p.neighborLinks?.[0]).toMatchObject({ probeId: 'P2', relation: 'same_building' });
  });
});

describe('probe position bias — five acceptance scenarios', () => {
  const result = analyze();
  const bias = result.bias!;
  const assessment = (id: string) => bias.probeAssessments.find((a) => a.probeId === id)!;
  const sensitivity = (id: string) => bias.buildingSensitivity.find((b) => b.buildingId === id)!;

  it('scenario 1: external-wall probe with complete evidence gets an adjusted view but raw readings stay authoritative', () => {
    const a = assessment('P-301');
    expect(a.segments).toHaveLength(1);
    const robust = a.robust[0];
    expect(robust.gate.adjustmentAllowed).toBe(true);
    expect(robust.adjustmentC).toBeGreaterThan(0);
    expect(robust.persistentDeltaC).toBeLessThanOrEqual(-DEFAULT_CONFIG.biasMinPersistentDeltaC);
    expect(robust.points.every((p) => !p.comparable || p.neighborProbeIds.includes('P-302'))).toBe(true);
    // Indistinguishable range: gate-passed => drift component collapses to zero.
    expect(a.indistinguishableRangeC?.driftComponent).toEqual({ lowerC: 0, upperC: 0 });
    // Raw view of B01 is unchanged and equals the main engine summary.
    const b01 = sensitivity('B01');
    const summary = result.buildingSummaries.find((s) => s.buildingId === 'B01')!;
    expect(b01.rawRisk).toBe(summary.risk);
    expect(b01.rawRiskScore).toBe(summary.riskScore);
    // The transient 1/8 dip classification is untouched.
    expect(result.buildingDays.find((d) => d.buildingId === 'B01' && d.dayKey === '2026-01-08')!.classification)
      .toBe('transient_disturbance');
  });

  it('scenario 2: a real local supply outage is never erased by the adjusted view', () => {
    const a = assessment('P-802');
    expect(a.robust.every((r) => r.adjustmentC === 0)).toBe(true);
    const outageDay = result.buildingDays.find((d) => d.buildingId === 'B03' && d.dayKey === '2026-01-13')!;
    expect(outageDay.classification).toBe('local_equipment');
    expect(outageDay.episodes[0].affectedProbeIds).toContain('P-802');
    const b03 = sensitivity('B03');
    expect(b03.rawRisk).toBe('medium');
    expect(b03.adjustedRisk).toBe('medium');
    expect(['medium', 'high']).toContain(b03.rangeBound.upperRisk);
    expect(['medium', 'high']).toContain(b03.rangeBound.lowerRisk);
  });

  it('scenario 3: drifting probe with expired certificate is never auto-corrected; only a range is offered', () => {
    const a = assessment('P-602');
    expect(a.gate.reasons).toContain('certificate_expired');
    expect(a.robust.every((r) => r.adjustmentC === 0)).toBe(true);
    expect(a.indistinguishableRangeC).not.toBeNull();
    expect(a.indistinguishableRangeC!.driftComponent.lowerC).toBeLessThan(0);
    const model = a.model[0];
    expect(model.applicable).toBe(true);
    expect(model.intervalHalfWidthC).not.toBeNull();
    // Model estimate must not be treated as measurement: no correction despite a negative drift estimate.
    expect(model.driftEffectC).not.toBeNull();
    const b09 = sensitivity('B09');
    expect(b09.rawRisk).toBe('low');
    expect(b09.adjustedRisk).toBe('low');
    expect(result.alignmentIssues.some((i) => i.code === 'bias_certificate_expired')).toBe(true);
  });

  it('scenario 4: probe replacement splits the window into independently gated segments', () => {
    const a = assessment('P-1202');
    expect(a.segments).toHaveLength(2);
    expect(a.robust).toHaveLength(2);
    expect(a.robust[0].adjustmentC).toBe(0);
    expect(a.robust[1].gate.adjustmentAllowed).toBe(true);
    expect(a.robust[1].adjustmentC).toBeGreaterThan(0);
    expect(a.segments[1].certificateId).toBe('CAL-1202-B');
    // Building-level sensitivity reflects the post-replacement adjustment only on later days.
    const b07 = sensitivity('B07');
    expect(b07.changed).toBe(true);
    expect(b07.rawRisk).toBe('high');
    expect(b07.rangeBound.upperRisk).toBe('high');
  });

  it('scenario 5: external wall works split segments and the post-works shrinkage drops below the evidence threshold', () => {
    const a = assessment('P-502');
    expect(a.segments.map((s) => s.trigger)).toEqual(['window_start', 'external_wall_works']);
    expect(a.robust[0].gate.adjustmentAllowed).toBe(true);
    expect(a.robust[1].gate.adjustmentAllowed).toBe(false);
    expect(a.robust[1].gate.reasons).toContain('persistent_delta_below_threshold');
    // The documented 1/10 whole-building outage remains high risk in every view.
    const b02 = sensitivity('B02');
    expect(b02.rawRisk).toBe('high');
    expect(b02.rangeBound.upperRisk).toBe('high');
    const outageDay = result.buildingDays.find((d) => d.buildingId === 'B02' && d.dayKey === '2026-01-10')!;
    expect(outageDay.documented).toBe(true);
  });

  it('scenario 6: sparse single-probe building cannot be corrected on either route', () => {
    const a = assessment('P-701');
    expect(a.gate.reasons).toContain('missing_certificate');
    expect(a.gate.reasons).toContain('insufficient_neighbors');
    expect(a.robust.every((r) => r.adjustmentC === 0)).toBe(true);
    expect(a.indistinguishableRangeC).toBeNull();
    const b04 = sensitivity('B04');
    expect(b04.rawRisk).toBe('undetermined');
    expect(b04.adjustedRisk).toBe('undetermined');
    expect(result.alignmentIssues.some((i) => i.code === 'bias_model_sparse' && i.message.includes('B04'))).toBe(true);
  });

  it('hierarchical model states its applicability scope and never overrides a failed gate', () => {
    expect(bias.routeBApplicableBuildingIds).toEqual([]);
    expect(bias.routeBPooledBuildingIds.sort()).toEqual(['B01', 'B02', 'B03', 'B04', 'B07', 'B08', 'B09']);
    for (const a of bias.probeAssessments) {
      for (const m of a.model) {
        expect(m.applicable).toBe(true);
        expect(m.intervalHalfWidthC).toBeGreaterThan(0);
        expect(m.applicabilityNotes.join(' ')).toContain('池化');
      }
    }
    // Gate-failed probes keep zero adjustment even when the model estimates a drift term.
    for (const id of ['P-602', 'P-701']) {
      expect(assessment(id).robust.every((r) => r.adjustmentC === 0)).toBe(true);
    }
    expect(bias.modelSpec.formula).toContain('δ_供热日');
  });

  it('keeps every comparison point auditable with matched weather and coverage conditions', () => {
    let total = 0;
    for (const a of bias.probeAssessments) {
      for (const r of a.robust) {
        for (const p of r.points) {
          total += 1;
          if (p.comparable) {
            expect(p.outdoorMedianC).not.toBeNaN();
            expect(p.probeCoverageRatio).toBeGreaterThanOrEqual(DEFAULT_CONFIG.minCoverageRatio);
            expect(p.neighborProbeIds.length).toBeGreaterThan(0);
          } else {
            expect(p.excludedReason).toBeTruthy();
          }
        }
      }
    }
    expect(total).toBe(bias.comparisonPointCount);
    expect(total).toBeGreaterThan(100);
  });

  it('attaches bias gate failures as alignment issues without changing existing totals', () => {
    expect(result.totals.highRiskBuildings).toBeGreaterThan(0);
    const gateCodes = new Set(result.alignmentIssues.filter((i) => i.code.startsWith('bias_')).map((i) => i.code));
    expect(gateCodes.has('bias_certificate_expired')).toBe(true);
    expect(gateCodes.has('bias_missing_certificate')).toBe(true);
    // Raw engine version bumped and suite versioned inside the run result.
    expect(result.engineVersion).toBe('engine-1.5.0');
    expect(bias.engineVersion).toBe('engine-1.5.0');
  });
});
