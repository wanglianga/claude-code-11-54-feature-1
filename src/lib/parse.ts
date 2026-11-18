/** CSV / JSON parsing into canonical source records, with field mapping and issue capture. */
import type {
  Building,
  Complaint,
  FieldMapping,
  ImportIssue,
  ParsedFilePreview,
  ParsedSource,
  Probe,
  Reading,
  SourceKind,
  WeatherObs,
  WorkOrder,
  WorkOrderKind,
} from '../types';
import { parseTimestamp } from './time';

export const PARSER_VERSION = 'parse-1.2.0';

export interface FieldSpec {
  canonical: string;
  label: string;
  required: boolean;
  alternates: string[];
  type: 'string' | 'number' | 'timestamp';
}

export const FIELD_SPECS: Record<SourceKind, FieldSpec[]> = {
  readings: [
    { canonical: 'sensor_id', label: '探头编号', required: true, alternates: ['sensor', 'sensorId', 'probe_id', 'device_id', '设备编号'], type: 'string' },
    { canonical: 'ts', label: '读数时间', required: true, alternates: ['timestamp', 'time', 'reading_ts', '采集时间', '时间'], type: 'timestamp' },
    { canonical: 'value_c', label: '室温 (℃)', required: true, alternates: ['value', 'temp_c', 'temperature', 'room_temp', '室温'], type: 'number' },
  ],
  weather: [
    { canonical: 'station_id', label: '气象站编号', required: true, alternates: ['station', 'stationId', '站点'], type: 'string' },
    { canonical: 'ts', label: '观测时间', required: true, alternates: ['timestamp', 'time', 'obs_ts', '观测时间'], type: 'timestamp' },
    { canonical: 'temp_c', label: '室外温度 (℃)', required: true, alternates: ['temperature', 'temp', 'outdoor_temp', '气温'], type: 'number' },
  ],
  work_orders: [
    { canonical: 'work_order_id', label: '工单编号', required: true, alternates: ['id', 'order_id', '工单号'], type: 'string' },
    { canonical: 'building', label: '楼栋', required: true, alternates: ['building_id', 'buildingName', '楼栋名称'], type: 'string' },
    { canonical: 'type', label: '工单类型', required: false, alternates: ['kind', 'category', '类型'], type: 'string' },
    { canonical: 'start', label: '开始时间', required: true, alternates: ['start_ts', 'begin', '开始'], type: 'timestamp' },
    { canonical: 'end', label: '结束时间', required: true, alternates: ['end_ts', 'finish', '结束'], type: 'timestamp' },
    { canonical: 'summary', label: '工单摘要', required: false, alternates: ['description', 'remark', '摘要', '说明'], type: 'string' },
    { canonical: 'recorded_at', label: '登记时间', required: false, alternates: ['recorded', 'created_at', '登记时间'], type: 'timestamp' },
  ],
  complaints: [
    { canonical: 'complaint_id', label: '投诉编号', required: true, alternates: ['id', 'ticket_id', '投诉号'], type: 'string' },
    { canonical: 'address', label: '投诉地址', required: true, alternates: ['raw_address', 'location', '地址'], type: 'string' },
    { canonical: 'window_start', label: '反映时段起', required: true, alternates: ['start', 'start_ts', '时段起'], type: 'timestamp' },
    { canonical: 'window_end', label: '反映时段止', required: true, alternates: ['end', 'end_ts', '时段止'], type: 'timestamp' },
    { canonical: 'channel', label: '来源渠道', required: false, alternates: ['source', '渠道'], type: 'string' },
    { canonical: 'text', label: '投诉描述', required: false, alternates: ['description', 'content', '描述'], type: 'string' },
    { canonical: 'received_at', label: '受理时间', required: false, alternates: ['received', '接受时间'], type: 'timestamp' },
  ],
  registry: [
    { canonical: 'building_id', label: '楼栋编号', required: true, alternates: ['id', 'buildingId'], type: 'string' },
    { canonical: 'building_name', label: '楼栋名称', required: true, alternates: ['name', '楼号'], type: 'string' },
    { canonical: 'complex', label: '小区', required: false, alternates: ['community', 'estate'], type: 'string' },
    { canonical: 'aliases', label: '地址别名', required: false, alternates: ['aka', 'names'], type: 'string' },
    { canonical: 'probe_id', label: '探头编号', required: false, alternates: ['sensor_id'], type: 'string' },
    { canonical: 'probe_building_id', label: '探头所属楼栋', required: false, alternates: ['building'], type: 'string' },
    { canonical: 'interval_min', label: '上传间隔(分钟)', required: false, alternates: ['interval'], type: 'number' },
    { canonical: 'installed_at', label: '安装时间', required: false, alternates: ['installed'], type: 'timestamp' },
    { canonical: 'removed_at', label: '拆除时间', required: false, alternates: ['removed'], type: 'timestamp' },
    { canonical: 'location_note', label: '安装位置说明', required: false, alternates: ['location'], type: 'string' },
  ],
};

export function detectDelimiter(firstLine: string): string {
  let best = ',';
  let bestCount = -1;
  for (const delim of [',', '\t', ';', '|']) {
    const count = firstLine.split(delim).length - 1;
    if (count > bestCount) {
      best = delim;
      bestCount = count;
    }
  }
  return best;
}

/** RFC4180-ish CSV parser that handles quotes, CRLF and embedded newlines. */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const clean = text.replace(/^﻿/, '');
  for (let i = 0; i < clean.length; i += 1) {
    const ch = clean[i];
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',' || ch === '\t' || ch === ';' || ch === '|') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch === '\r') {
      // handled at \n
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
}

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[\s_-]+/g, '');
}

export function suggestMapping(headers: string[], kind: SourceKind): FieldMapping {
  const mapping: FieldMapping = {};
  const normalized = headers.map((h) => ({ raw: h, norm: normalizeHeader(h) }));
  for (const spec of FIELD_SPECS[kind]) {
    const candidates = [spec.canonical, ...spec.alternates].map(normalizeHeader);
    let found: string | null = null;
    const exact = normalized.find((h) => candidates.includes(h.norm));
    if (exact) found = exact.raw;
    if (!found) {
      const loose = normalized.find((h) =>
        candidates.some((c) => c.length > 3 && (h.norm.includes(c) || c.includes(h.norm))),
      );
      if (loose) found = loose.raw;
    }
    mapping[spec.canonical] = found;
  }
  return mapping;
}

export function suggestKind(fileName: string, headers: string[], jsonSample?: unknown): SourceKind {
  const lower = fileName.toLowerCase();
  if (lower.includes('registry') || lower.includes('登记')) return 'registry';
  if (lower.includes('weather') || lower.includes('气象')) return 'weather';
  if (lower.includes('order') || lower.includes('工单')) return 'work_orders';
  if (lower.includes('complaint') || lower.includes('投诉')) return 'complaints';
  if (lower.includes('reading') || lower.includes('sensor') || lower.includes('读数')) return 'readings';
  const joined = headers.map(normalizeHeader).join('|');
  if (joined.includes('complaint') || joined.includes('address')) return 'complaints';
  if (joined.includes('workorder') || joined.includes('summary')) return 'work_orders';
  if (joined.includes('station')) return 'weather';
  if (joined.includes('sensor') && joined.includes('value')) return 'readings';
  if (jsonSample && typeof jsonSample === 'object') {
    if (Array.isArray(jsonSample)) {
      const first = jsonSample[0] as Record<string, unknown> | undefined;
      if (first && ('complaint_id' in first || 'address' in first)) return 'complaints';
      if (first && ('work_order_id' in first || 'summary' in first)) return 'work_orders';
    } else if ('buildings' in (jsonSample as object)) return 'registry';
  }
  return 'readings';
}

export interface ParseResult {
  source: ParsedSource;
  issues: ImportIssue[];
  rowCount: number;
  invalidCount: number;
  duplicateCount: number;
}

function issueMap(): Map<string, ImportIssue> {
  return new Map();
}
function addIssue(
  map: Map<string, ImportIssue>,
  code: string,
  severity: ImportIssue['severity'],
  message: string,
  sample?: string,
) {
  const existing = map.get(code);
  if (existing) {
    existing.count += 1;
    if (sample && (existing.samples?.length ?? 0) < 4) existing.samples?.push(sample);
    return;
  }
  map.set(code, { code, severity, message, count: 1, samples: sample ? [sample] : [] });
}

function jsonRowsToObjects(text: string): { rows: Record<string, unknown>[]; shape: string } {
  const value = JSON.parse(text);
  if (Array.isArray(value)) {
    return { rows: value as Record<string, unknown>[], shape: 'array' };
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    for (const key of ['work_orders', 'complaints', 'readings', 'weather', 'orders', 'items', 'records']) {
      if (Array.isArray(obj[key])) return { rows: obj[key] as Record<string, unknown>[], shape: `object.${key}` };
    }
    return { rows: [obj], shape: 'object' };
  }
  return { rows: [], shape: 'unknown' };
}

const ORDER_KINDS: Record<string, WorkOrderKind> = {
  supply_suspension: 'supply_suspension',
  停供: 'supply_suspension',
  停暖: 'supply_suspension',
  outage: 'supply_suspension',
  valve_adjustment: 'valve_adjustment',
  阀门调整: 'valve_adjustment',
  valve: 'valve_adjustment',
  maintenance: 'maintenance',
  检修: 'maintenance',
  维护: 'maintenance',
  complaint_visit: 'complaint_visit',
  上门: 'complaint_visit',
};

export function normalizeOrderKind(raw: unknown): WorkOrderKind {
  const key = String(raw ?? '').trim().toLowerCase();
  return ORDER_KINDS[key] ?? 'other';
}

export function parseSourceText(
  text: string,
  fileName: string,
  kind: SourceKind,
  mapping: FieldMapping,
): ParseResult {
  const issues = issueMap();
  const isJson = /\.json$/i.test(fileName) || text.trim().startsWith('{') || text.trim().startsWith('[');
  let rows: Record<string, unknown>[] = [];
  if (isJson) {
    try {
      rows = jsonRowsToObjects(text).rows.map((r, idx) => ({ ...r, __line: idx + 1 }));
    } catch {
      addIssue(issues, 'json_parse', 'error', 'JSON 结构无法解析');
      return { source: { kind }, issues: [...issues.values()], rowCount: 0, invalidCount: 0, duplicateCount: 0 };
    }
  } else {
    const lines = parseCsvRows(text);
    if (lines.length === 0) {
      addIssue(issues, 'empty', 'error', '文件没有可读取的数据行');
      return { source: { kind }, issues: [...issues.values()], rowCount: 0, invalidCount: 0, duplicateCount: 0 };
    }
    const headers = lines[0].map((h) => h.trim());
    for (let i = 1; i < lines.length; i += 1) {
      const row: Record<string, unknown> = { __line: i + 1 };
      headers.forEach((h, idx) => {
        row[h] = lines[i][idx];
      });
      rows.push(row);
    }
  }

  const get = (row: Record<string, unknown>, canonical: string): string => {
    const field = mapping[canonical];
    if (!field) return '';
    const v = row[field];
    if (v === null || v === undefined) return '';
    if (Array.isArray(v)) return v.join('|');
    return String(v).trim();
  };

  const source: ParsedSource = { kind };
  let invalid = 0;
  let duplicates = 0;

  if (kind === 'readings') {
    const map = new Map<string, Reading>();
    const seen = new Set<string>();
    const out: Reading[] = [];
    for (const row of rows) {
      const sensorId = get(row, 'sensor_id');
      const ts = parseTimestamp(get(row, 'ts'));
      const rawVal = get(row, 'value_c');
      const value = Number(rawVal);
      const line = Number(row.__line ?? 0);
      if (!sensorId || ts === null || rawVal === '' || !Number.isFinite(value)) {
        invalid += 1;
        addIssue(issues, 'reading_invalid', 'warn', '读数行缺少探头编号、时间或数值', `第 ${line} 行`);
        continue;
      }
      if (value < -30 || value > 60) {
        invalid += 1;
        addIssue(issues, 'reading_range', 'warn', '室温读数超出 -30–60℃ 合理范围', `${sensorId} ${value}℃`);
        continue;
      }
      const key = `${sensorId}@${ts}`;
      if (seen.has(key)) {
        duplicates += 1;
        map.delete(key);
      }
      seen.add(key);
      map.set(key, { sensorId, ts, valueC: Math.round(value * 100) / 100, line });
    }
    for (const r of map.values()) out.push(r);
    out.sort((a, b) => a.ts - b.ts);
    source.readings = out;
    if (duplicates > 0) addIssue(issues, 'reading_dup', 'info', '重复上报的读数已按「探头+时间」去重', `${duplicates} 条`);
  } else if (kind === 'weather') {
    const map = new Map<string, WeatherObs>();
    let dup = 0;
    for (const row of rows) {
      const stationId = get(row, 'station_id') || 'STATION';
      const ts = parseTimestamp(get(row, 'ts'));
      const temp = Number(get(row, 'temp_c'));
      const line = Number(row.__line ?? 0);
      if (ts === null || !Number.isFinite(temp)) {
        invalid += 1;
        addIssue(issues, 'weather_invalid', 'warn', '气象行缺少时间或温度', `第 ${line} 行`);
        continue;
      }
      const key = `${stationId}@${ts}`;
      if (map.has(key)) dup += 1;
      map.set(key, { stationId, ts, tempC: temp, line });
    }
    const out = [...map.values()].sort((a, b) => a.ts - b.ts);
    source.weather = out;
    duplicates = dup;
  } else if (kind === 'work_orders') {
    const out: WorkOrder[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      const id = get(row, 'work_order_id');
      const startTs = parseTimestamp(get(row, 'start'));
      let endTs = parseTimestamp(get(row, 'end'));
      const rawBuilding = get(row, 'building');
      const line = Number(row.__line ?? 0);
      if (!id || startTs === null) {
        invalid += 1;
        addIssue(issues, 'order_invalid', 'warn', '工单缺少编号或开始时间', `第 ${line} 行`);
        continue;
      }
      if (endTs === null) endTs = startTs + 60 * 60_000;
      if (endTs < startTs) {
        invalid += 1;
        addIssue(issues, 'order_reversed', 'warn', '工单结束时间早于开始时间，已丢弃', `${id}`);
        continue;
      }
      if (seen.has(id)) {
        duplicates += 1;
        continue;
      }
      seen.add(id);
      out.push({
        id,
        buildingId: null,
        kind: normalizeOrderKind(get(row, 'type')),
        startTs,
        endTs,
        summary: get(row, 'summary'),
        recordedAt: parseTimestamp(get(row, 'recorded_at')),
        line,
        rawBuilding,
      });
    }
    out.sort((a, b) => a.startTs - b.startTs);
    source.workOrders = out;
  } else if (kind === 'complaints') {
    const out: Complaint[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      const id = get(row, 'complaint_id');
      const rawAddress = get(row, 'address');
      const windowStartTs = parseTimestamp(get(row, 'window_start'));
      let windowEndTs = parseTimestamp(get(row, 'window_end'));
      const line = Number(row.__line ?? 0);
      if (!id || !rawAddress || windowStartTs === null) {
        invalid += 1;
        addIssue(issues, 'complaint_invalid', 'warn', '投诉缺少编号、地址或时段', `第 ${line} 行`);
        continue;
      }
      if (windowEndTs === null || windowEndTs < windowStartTs) windowEndTs = windowStartTs + 30 * 60_000;
      if (seen.has(id)) {
        duplicates += 1;
        continue;
      }
      seen.add(id);
      out.push({
        id,
        rawAddress,
        windowStartTs,
        windowEndTs,
        channel: get(row, 'channel') || '未标注渠道',
        text: get(row, 'text'),
        receivedAt: parseTimestamp(get(row, 'received_at')),
        line,
      });
    }
    out.sort((a, b) => a.windowStartTs - b.windowStartTs);
    source.complaints = out;
  } else {
    // registry: JSON preferred, CSV flat rows supported
    if (isJson) {
      const value = JSON.parse(text);
      const buildingsRaw = Array.isArray(value) ? value : (value.buildings ?? []);
      const probesRaw = Array.isArray(value) ? [] : (value.probes ?? []);
      source.buildings = buildingsRaw.map((b: Record<string, unknown>, idx: number): Building => ({
        id: String(b.id ?? b.building_id ?? `B${idx + 1}`),
        name: String(b.name ?? b.building_name ?? '未命名楼栋'),
        complex: String(b.complex ?? b.community ?? ''),
        aliases: Array.isArray(b.aliases) ? b.aliases.map(String) : String(b.aliases ?? '').split('|').filter(Boolean),
        addressNote: String(b.address_note ?? b.addressNote ?? ''),
      }));
      source.probes = probesRaw.map((p: Record<string, unknown>, idx: number): Probe => ({
        id: String(p.id ?? p.probe_id ?? `P${idx + 1}`),
        buildingId: String(p.building_id ?? p.probe_building_id ?? ''),
        label: String(p.label ?? p.id ?? '探头'),
        intervalMin: Number(p.interval_min ?? p.intervalMin ?? 15) || 15,
        installedAt: parseTimestamp(p.installed_at) ?? 0,
        removedAt: parseTimestamp(p.removed_at) ?? undefined,
        locationNote: String(p.location_note ?? p.locationNote ?? ''),
      }));
      const buildingIds = new Set((source.buildings ?? []).map((b) => b.id));
      const orphans = (source.probes ?? []).filter((p) => p.buildingId && !buildingIds.has(p.buildingId));
      if (orphans.length) {
        addIssue(issues, 'registry_orphan', 'warn', '探头指向登记册中不存在的楼栋', orphans.map((p) => `${p.id}→${p.buildingId}`).join('、'));
      }
    } else {
      const buildings = new Map<string, Building>();
      const probes: Probe[] = [];
      for (const row of rows) {
        const bid = get(row, 'building_id');
        const bname = get(row, 'building_name');
        if (!bid || !bname) {
          invalid += 1;
          addIssue(issues, 'registry_invalid', 'warn', '登记行缺少楼栋编号或名称', `第 ${row.__line} 行`);
          continue;
        }
        if (!buildings.has(bid)) {
          buildings.set(bid, {
            id: bid,
            name: bname,
            complex: get(row, 'complex'),
            aliases: get(row, 'aliases').split('|').filter(Boolean),
            addressNote: '',
          });
        }
        const pid = get(row, 'probe_id');
        if (pid) {
          probes.push({
            id: pid,
            buildingId: get(row, 'probe_building_id') || bid,
            label: pid,
            intervalMin: Number(get(row, 'interval_min')) || 15,
            installedAt: parseTimestamp(get(row, 'installed_at')) ?? 0,
            removedAt: parseTimestamp(get(row, 'removed_at')) ?? undefined,
            locationNote: get(row, 'location_note'),
          });
        }
      }
      source.buildings = [...buildings.values()];
      source.probes = probes;
    }
  }

  return {
    source,
    issues: [...issues.values()],
    rowCount: rows.length,
    invalidCount: invalid,
    duplicateCount: duplicates,
  };
}

export function previewFile(text: string, fileName: string): ParsedFilePreview {
  const isJson = /\.json$/i.test(fileName) || text.trim().startsWith('{') || text.trim().startsWith('[');
  if (isJson) {
    let rows: Record<string, unknown>[] = [];
    let shape = 'unknown';
    let headers: string[] = [];
    try {
      const parsed = jsonRowsToObjects(text);
      rows = parsed.rows;
      shape = parsed.shape;
      if (shape === 'array' || shape.startsWith('object.')) {
        const keySet = new Set<string>();
        for (const r of rows.slice(0, 50)) {
          if (r && typeof r === 'object') Object.keys(r).forEach((k) => keySet.add(k));
        }
        headers = [...keySet];
      } else {
        const value = JSON.parse(text);
        if (value && typeof value === 'object' && 'buildings' in value) {
          headers = ['id', 'name', 'complex', 'aliases', 'address_note', 'probes'];
        }
      }
    } catch {
      headers = [];
    }
    const kind = suggestKind(fileName, headers, (() => {
      try {
        return JSON.parse(text);
      } catch {
        return undefined;
      }
    })());
    const previewRows = rows.slice(0, 5).map((r) => {
      const out: Record<string, string> = {};
      for (const h of headers) {
        const v = r?.[h];
        out[h] = v === undefined || v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
      }
      return out;
    });
    return {
      headers,
      previewRows,
      totalRows: rows.length,
      suggestedKind: kind,
      suggestedMapping: suggestMapping(headers, kind),
      jsonShape: shape,
    };
  }
  const lines = parseCsvRows(text);
  const headers = (lines[0] ?? []).map((h) => h.trim());
  const previewRows = lines.slice(1, 6).map((cells) => {
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = cells[i] ?? '';
    });
    return row;
  });
  const kind = suggestKind(fileName, headers);
  return {
    headers,
    previewRows,
    totalRows: Math.max(0, lines.length - 1),
    suggestedKind: kind,
    suggestedMapping: suggestMapping(headers, kind),
  };
}

/** Re-mapping a parsed batch without re-reading the file. */
export function applyMapping(
  text: string,
  fileName: string,
  kind: SourceKind,
  mapping: FieldMapping,
): ParseResult {
  return parseSourceText(text, fileName, kind, mapping);
}
