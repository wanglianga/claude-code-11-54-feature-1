import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCsvRows, parseSourceText, previewFile, suggestMapping, suggestKind } from '../lib/parse';
import { addressKey, findAssertionConflicts, matchBuildingsInText, resolveComplaintAddress, scoreAddress } from '../lib/address';
import { compareRuns, createAnalysisRun, findLateData, buildReport, makeMappingVersion } from '../lib/runs';
import { runAnalysis } from '../lib/engine';
import { DEFAULT_CONFIG } from '../types';
import type { AddressAssertion, Building, ImportBatch, Probe } from '../types';
import { digestOf, sha256Hex, stableStringify } from '../lib/hash';
import { heatingDayKey, nightWindow, parseTimestamp, enumerateDayKeys } from '../lib/time';

const read = (n: string) => fs.readFileSync(path.resolve('public/samples', n), 'utf8');

describe('csv parsing', () => {
  it('handles quoted fields, embedded commas and CRLF', () => {
    const rows = parseCsvRows('a,b,c\r\n1,"x,y","he said ""hi"""\r\n2,3,4\r\n');
    expect(rows).toEqual([
      ['a', 'b', 'c'],
      ['1', 'x,y', 'he said "hi"'],
      ['2', '3', '4'],
    ]);
  });

  it('tolerant timestamp parsing assumes +08:00 for naive timestamps', () => {
    expect(parseTimestamp('2026-01-05 06:00')).toBe(Date.parse('2026-01-05T06:00:00+08:00'));
    expect(parseTimestamp('2026-1-5 6:00:00')).toBe(Date.parse('2026-01-05T06:00:00+08:00'));
    expect(parseTimestamp('2026/01/05 06:00')).toBe(Date.parse('2026-01-05T06:00:00+08:00'));
    expect(parseTimestamp('not a time')).toBeNull();
  });

  it('detects source kind from headers when filename is unhelpful', () => {
    expect(suggestKind('data.csv', ['sensor_id', 'ts', 'value_c'])).toBe('readings');
    expect(suggestKind('data.csv', ['station', 'timestamp', 'temp_c'])).toBe('weather');
    expect(suggestKind('data.csv', ['address', 'window_start'])).toBe('complaints');
  });

  it('maps Chinese headers to canonical fields', () => {
    const mapping = suggestMapping(['设备编号', '采集时间', '室温'], 'readings');
    expect(mapping.sensor_id).toBe('设备编号');
    expect(mapping.value_c).toBe('室温');
  });

  it('previews CSV files with suggested mapping', () => {
    const preview = previewFile('sensor,time,temp\nP1,2026-01-05T06:00:00+08:00,20.5\n', 'x.csv');
    expect(preview.totalRows).toBe(1);
    expect(preview.suggestedKind).toBe('readings');
    expect(preview.suggestedMapping.sensor_id).toBe('sensor');
  });

  it('counts invalid rows instead of silently dropping them', () => {
    const parsed = parseSourceText(
      'sensor_id,ts,value_c\nP1,2026-01-05T06:00:00+08:00,20\nP1,bad,20\nP1,2026-01-05T07:00:00+08:00,\n,P1,9\n',
      'r.csv',
      'readings',
      { sensor_id: 'sensor_id', ts: 'ts', value_c: 'value_c' },
    );
    expect(parsed.source.readings).toHaveLength(1);
    expect(parsed.invalidCount).toBe(3);
  });
});

describe('time algebra', () => {
  it('enumerates day keys inclusively', () => {
    expect(enumerateDayKeys('2026-01-05', '2026-01-07')).toEqual(['2026-01-05', '2026-01-06', '2026-01-07']);
  });

  it('night window spans heating-day boundary', () => {
    const n = nightWindow('2026-01-10', 6, 22, 6);
    expect(n.startTs).toBe(Date.parse('2026-01-10T22:00:00+08:00'));
    expect(n.endTs).toBe(Date.parse('2026-01-11T06:00:00+08:00'));
  });

  it('assigns small-hours readings to the previous heating day', () => {
    expect(heatingDayKey(Date.parse('2026-01-11T03:00:00+08:00'))).toBe('2026-01-10');
    expect(heatingDayKey(Date.parse('2026-01-11T06:30:00+08:00'))).toBe('2026-01-11');
  });
});

describe('address resolution', () => {
  const buildings: Building[] = [
    { id: 'B01', name: '3号楼', complex: '北岸新城', aliases: [], addressNote: '' },
    { id: 'B03', name: '8号楼', complex: '北岸新城', aliases: [], addressNote: '' },
    { id: 'B07', name: '12号楼', complex: '北岸新城', aliases: [], addressNote: '' },
    { id: 'B13', name: '13号楼', complex: '北岸新城', aliases: [], addressNote: '' },
  ];
  const probes = new Map<string, string[]>();

  it('does not let 3号楼 match inside 13号楼', () => {
    const candidates = scoreAddress('北岸新城13号楼2单元', buildings, probes);
    expect(candidates.map((c) => c.buildingId)).toEqual(['B13']);
  });

  it('keeps two-building mentions ambiguous instead of picking one', () => {
    const out = resolveComplaintAddress('北岸新城8号楼、12号楼附近', buildings, probes, []);
    expect(out.mode).toBe('ambiguous');
    expect(out.chosen).toEqual([]);
    expect(out.candidates.length).toBe(2);
  });

  it('returns unassigned when no building is mentioned', () => {
    const out = resolveComplaintAddress('北岸新城三期', buildings, probes, []);
    expect(out.mode).toBe('unassigned');
  });

  it('honours manual assertions over auto matching', () => {
    const assertion: AddressAssertion = {
      id: 'a',
      addressKey: addressKey('北岸新城8号楼、12号楼附近'),
      rawAddressSamples: ['北岸新城8号楼、12号楼附近'],
      chosenBuildingIds: ['B03', 'B07'],
      candidates: [],
      windowLabel: 'w1',
      note: '共用立管',
      createdAt: 10,
      superseded: false,
      resolution: { type: 'merge', conflictWith: [], reason: '共用立管', resolvedAt: 10 },
    };
    const out = resolveComplaintAddress('北岸新城8号楼、12号楼附近', buildings, probes, [assertion]);
    expect(out.mode).toBe('manual');
    expect(out.chosen).toEqual(['B03', 'B07']);
  });

  it('does not match 5号楼 inside 15号楼 in free-text labels', () => {
    const buildings2: Building[] = [
      { id: 'B02', name: '5号楼', complex: '北岸新城', aliases: [], addressNote: '' },
    ];
    expect(matchBuildingsInText('北岸新城15号楼', buildings2)).toEqual([]);
    expect(matchBuildingsInText('北岸新城5号楼', buildings2)).toEqual(['B02']);
  });

  it('detects conflicting assertions from different windows', () => {
    const base = {
      addressKey: 'k',
      rawAddressSamples: ['北岸新城12号楼'],
      candidates: [],
      superseded: false,
    };
    const list: AddressAssertion[] = [
      { ...base, id: '1', chosenBuildingIds: ['B07'], windowLabel: 'w1', note: '', createdAt: 1 },
      { ...base, id: '2', chosenBuildingIds: ['B03'], windowLabel: 'w2', note: '', createdAt: 2 },
    ];
    const conflicts = findAssertionConflicts(list);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].keep.id).toBe('2');
  });
});

describe('display timezone', () => {
  it('renders timestamps in the analysis timezone regardless of host TZ', async () => {
    const { dateTime, dateOnly } = await import('../lib/format');
    // 2026-01-20T00:00:00+08:00 must read as 01-20 00:00, never shifted by host TZ.
    expect(dateTime(Date.parse('2026-01-20T00:00:00+08:00'))).toBe('2026-01-20 00:00');
    expect(dateOnly(Date.parse('2026-01-20T00:00:00+08:00'))).toBe('2026-01-20');
    // Small-hours local times stay on the same local date.
    expect(dateTime(Date.parse('2026-01-11T04:30:00+08:00'))).toBe('2026-01-11 04:30');
  });
});

describe('hashing', () => {
  it('hashes deterministically', async () => {
    const a = await sha256Hex('hello');
    const b = await sha256Hex('hello');
    const c = await sha256Hex('hello!');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('stable stringify is order independent', () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }));
    expect(digestOf({ a: 1, b: 2 })).toBe(digestOf({ b: 2, a: 1 }));
  });
});

describe('run snapshots, comparison, late data, report', () => {
  function buildBatches(): ImportBatch[] {
    const specs: [string, ImportBatch['kind'], string, Record<string, string>][] = [
      ['registry.json', 'registry', '2026-01-19T07:50:00+08:00', {}],
      ['weather_2026-01.csv', 'weather', '2026-01-19T08:40:00+08:00', { station_id: 'station_id', ts: 'ts', temp_c: 'temp_c' }],
      ['readings_2026-01.csv', 'readings', '2026-01-19T09:05:00+08:00', { sensor_id: 'sensor_id', ts: 'ts', value_c: 'value_c' }],
      ['work_orders_2026-01.json', 'work_orders', '2026-01-19T09:20:00+08:00', { work_order_id: 'work_order_id', building: 'building', type: 'type', start: 'start', end: 'end', summary: 'summary', recorded_at: 'recorded_at' }],
      ['complaints_2026-01.json', 'complaints', '2026-01-19T10:00:00+08:00', { complaint_id: 'complaint_id', address: 'address', window_start: 'window_start', window_end: 'window_end', channel: 'channel', text: 'text', received_at: 'received_at' }],
      ['work_orders_late_2026-01-21.csv', 'work_orders', '2026-01-21T15:30:00+08:00', { work_order_id: 'work_order_id', building: 'building', type: 'type', start: 'start', end: 'end', summary: 'summary', recorded_at: 'recorded_at' }],
      ['readings_late_2026-01-21.csv', 'readings', '2026-01-21T14:10:00+08:00', { sensor_id: 'sensor_id', ts: 'ts', value_c: 'value_c' }],
    ];
    return specs.map(([file, kind, at, mapping], i) => {
      const parsed = parseSourceText(read(file), file, kind, mapping);
      return {
        id: `b${i}`,
        kind,
        fileName: file,
        fileHash: `hash-${file}`,
        byteSize: 0,
        importedAt: Date.parse(at),
        ingestedAt: Date.parse(at),
        rowCount: parsed.rowCount,
        invalidCount: parsed.invalidCount,
        duplicateCount: parsed.duplicateCount,
        coverage: { startTs: null, endTs: null, sensorIds: [], buildingIds: [], dayCounts: [] },
        fieldMapping: mapping,
        parserVersion: 'test',
        issues: parsed.issues,
        data: parsed.source,
      };
    });
  }

  const batches = buildBatches();
  const registry = batches[0].data;
  const mapping = makeMappingVersion(registry.buildings ?? [], registry.probes ?? [], 1, 'test', 1);
  const cutoff = Date.parse('2026-01-20T00:00:00+08:00');

  function makeRun(assertions: AddressAssertion[] = [], label = 'run') {
    const result = runAnalysis({
      batches,
      buildings: mapping.buildings,
      probes: mapping.probes,
      assertions,
      config: DEFAULT_CONFIG,
      cutoffTs: cutoff,
    });
    return createAnalysisRun({
      label,
      batches,
      mapping,
      assertions,
      config: DEFAULT_CONFIG,
      cutoffTs: cutoff,
      result,
      now: Date.parse('2026-01-20T01:00:00+08:00'),
    });
  }

  it('freezes input refs and snapshots at cutoff', () => {
    const run = makeRun();
    expect(run.inputRefs).toHaveLength(5);
    expect(run.inputRefs.some((r) => r.fileName.includes('late'))).toBe(false);
    expect(run.assertionsSnapshot).toEqual([]);
    expect(run.mappingSnapshot.buildings).toHaveLength(9);
  });

  it('report is a pure function of the snapshot', () => {
    const run = makeRun();
    const a = buildReport(run, 1000);
    const b = buildReport(run, 2000);
    expect(a.narrative.headline).toBe(b.narrative.headline);
    expect(a.narrative.checksum).toBe(b.narrative.checksum);
    expect(a.narrative.findings.length).toBeGreaterThan(0);
  });

  it('detects late data appearing after the run cutoff', () => {
    const run = makeRun();
    const notices = findLateData(run, batches);
    expect(notices.length).toBe(2);
    expect(notices.map((n) => n.kind).sort()).toEqual(['readings', 'work_orders']);
    expect(notices.every((n) => /截止/.test(n.message))).toBe(true);
  });

  it('compares two runs and surfaces complaint mapping changes', () => {
    const first = makeRun([], 'a');
    const assertion: AddressAssertion = {
      id: 'x',
      addressKey: addressKey('北岸新城8号楼、12号楼附近'),
      rawAddressSamples: ['北岸新城8号楼、12号楼附近'],
      chosenBuildingIds: ['B03'],
      candidates: [],
      windowLabel: 'w',
      note: '电话确认',
      createdAt: 5,
      superseded: false,
    };
    const second = makeRun([assertion], 'b');
    const diff = compareRuns(first, second);
    expect(diff.mappingChanged).toBe(true);
    const c1006 = diff.affectedComplaints.find((c) => c.complaintId === 'C-1006');
    expect(c1006).toBeTruthy();
    expect(c1006!.oldBuildingIds).toEqual([]);
    expect(c1006!.newBuildingIds).toEqual(['B03']);
  });

  it('reflects a probe re-installation in a new run without touching the old one', () => {
    const original = makeRun();
    // Move P-302 (3号楼) to 5号楼 in a new registry version.
    const movedProbes = mapping.probes.map((p) => (p.id === 'P-302' ? { ...p, buildingId: 'B02', label: '5号楼临时部署' } : p));
    const movedMapping = makeMappingVersion(mapping.buildings, movedProbes, 2, 'P-302 调整到 5 号楼', 3);
    const movedResult = runAnalysis({
      batches,
      buildings: movedMapping.buildings,
      probes: movedMapping.probes,
      assertions: [],
      config: DEFAULT_CONFIG,
      cutoffTs: cutoff,
    });
    const oldB01 = original.result.buildingSummaries.find((b) => b.buildingId === 'B01')!;
    const newB01 = movedResult.buildingSummaries.find((b) => b.buildingId === 'B01')!;
    const newB02 = movedResult.buildingSummaries.find((b) => b.buildingId === 'B02')!;
    expect(oldB01.probeCount).toBe(2);
    expect(newB01.probeCount).toBe(1);
    expect(newB02.probeCount).toBe(3);
    // Historical run keeps its frozen snapshot.
    expect(original.mappingSnapshot.probes.find((p) => p.id === 'P-302')!.buildingId).toBe('B01');
  });

  it('does not mutate a stored run when a new mapping is created', () => {
    const run = makeRun();
    const before = JSON.stringify(run.mappingSnapshot);
    const next = makeMappingVersion(
      run.mappingSnapshot.buildings.map((b) => (b.id === 'B01' ? { ...b, name: '3号楼（改）' } : b)),
      run.mappingSnapshot.probes,
      2,
      'rename',
      2,
    );
    expect(next.version).toBe(2);
    expect(JSON.stringify(run.mappingSnapshot)).toBe(before);
  });
});
