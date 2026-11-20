/** Runtime import helpers used by the UI for sample files and user uploads. */
import type { FieldMapping, ImportBatch, ParsedFilePreview, SourceKind } from '../types';
import { PARSER_VERSION, parseSourceText, previewFile, suggestMapping } from './parse';
import { sha256Hex } from './hash';
import { heatingDayKey } from './time';

export function buildCoverage(kind: SourceKind, source: ImportBatch['data']): ImportBatch['coverage'] {
  let startTs: number | null = null;
  let endTs: number | null = null;
  const sensorIds = new Set<string>();
  const buildingIds = new Set<string>();
  const dayCounts = new Map<string, number>();
  const touch = (ts: number) => {
    if (startTs === null || ts < startTs) startTs = ts;
    if (endTs === null || ts > endTs) endTs = ts;
    const day = heatingDayKey(ts);
    dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1);
  };
  if (kind === 'readings') {
    for (const r of source.readings ?? []) {
      sensorIds.add(r.sensorId);
      touch(r.ts);
    }
  } else if (kind === 'weather') {
    for (const w of source.weather ?? []) touch(w.ts);
  } else if (kind === 'work_orders') {
    for (const o of source.workOrders ?? []) touch(o.startTs);
  } else if (kind === 'complaints') {
    for (const c of source.complaints ?? []) touch(c.windowStartTs);
  } else {
    for (const b of source.buildings ?? []) buildingIds.add(b.id);
  }
  return {
    startTs,
    endTs,
    sensorIds: [...sensorIds].sort(),
    buildingIds: [...buildingIds].sort(),
    dayCounts: [...dayCounts.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([dayKey, count]) => ({ dayKey, count })),
  };
}

export interface IngestedFile {
  fileName: string;
  ok: boolean;
  error?: string;
  text: string;
  preview: ParsedFilePreview | null;
  batch: ImportBatch | null;
}

export async function ingestFiles(
  files: { name: string; text: string }[],
  kinds: Record<string, SourceKind>,
  mappingOverride: Record<string, FieldMapping> = {},
): Promise<IngestedFile[]> {
  const out: IngestedFile[] = [];
  for (const file of files) {
    try {
      const preview = previewFile(file.text, file.name);
      const kind = kinds[file.name] ?? preview.suggestedKind;
      const mapping =
        mappingOverride[file.name] ??
        (kind === preview.suggestedKind ? preview.suggestedMapping : suggestMapping(preview.headers, kind));
      const parsed = parseSourceText(file.text, file.name, kind, mapping);
      const hash = await sha256Hex(file.text);
      const now = Date.now();
      const batch: ImportBatch = {
        id: `batch-${hash.slice(0, 10)}-${now.toString(36)}-${Math.floor(Math.random() * 1e4).toString(36)}`,
        kind,
        fileName: file.name,
        fileHash: hash,
        byteSize: new TextEncoder().encode(file.text).byteLength,
        importedAt: now,
        ingestedAt: now,
        rowCount: parsed.rowCount,
        invalidCount: parsed.invalidCount,
        duplicateCount: parsed.duplicateCount,
        coverage: buildCoverage(kind, parsed.source),
        fieldMapping: mapping,
        parserVersion: PARSER_VERSION,
        issues: parsed.issues,
        textPreview: preview.previewRows,
        data: parsed.source,
      };
      out.push({ fileName: file.name, ok: true, text: file.text, preview, batch });
    } catch (err) {
      out.push({
        fileName: file.name,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        text: file.text,
        preview: null,
        batch: null,
      });
    }
  }
  return out;
}
