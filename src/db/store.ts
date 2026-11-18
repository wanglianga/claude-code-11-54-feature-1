/** IndexedDB persistence. All data stays in the browser. */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type {
  AddressAssertion,
  AnalysisConfig,
  AnalysisRun,
  ImportBatch,
  MappingVersion,
} from '../types';
import { DEFAULT_CONFIG } from '../types';

interface ConsoleDB extends DBSchema {
  batches: { key: string; value: ImportBatch };
  files: { key: string; value: { batchId: string; text: string } };
  mappings: { key: string; value: MappingVersion; indexes: { 'by-version': number } };
  assertions: { key: string; value: AddressAssertion };
  runs: { key: string; value: AnalysisRun; indexes: { 'by-created': number } };
  meta: { key: string; value: { key: string; value: unknown } };
}

const DB_NAME = 'heat-comparability-console';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<ConsoleDB>> | null = null;

export function getDB(): Promise<IDBPDatabase<ConsoleDB>> {
  if (!dbPromise) {
    dbPromise = openDB<ConsoleDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('batches')) db.createObjectStore('batches', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'batchId' });
        if (!db.objectStoreNames.contains('mappings')) {
          const store = db.createObjectStore('mappings', { keyPath: 'id' });
          store.createIndex('by-version', 'version');
        }
        if (!db.objectStoreNames.contains('assertions')) db.createObjectStore('assertions', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('runs')) {
          const store = db.createObjectStore('runs', { keyPath: 'id' });
          store.createIndex('by-created', 'createdAt');
        }
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
      },
      blocked() {
        console.warn('IndexedDB upgrade blocked by another tab');
      },
    });
  }
  return dbPromise;
}

export async function listBatches(): Promise<ImportBatch[]> {
  const db = await getDB();
  const all = await db.getAll('batches');
  return all.sort((a, b) => a.importedAt - b.importedAt);
}

export async function putBatch(batch: ImportBatch, rawText: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['batches', 'files'], 'readwrite');
  await tx.objectStore('batches').put(batch);
  await tx.objectStore('files').put({ batchId: batch.id, text: rawText });
  await tx.done;
}

export async function deleteBatch(id: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['batches', 'files'], 'readwrite');
  await tx.objectStore('batches').delete(id);
  await tx.objectStore('files').delete(id);
  await tx.done;
}

export async function getBatchText(batchId: string): Promise<string | null> {
  const db = await getDB();
  const row = await db.get('files', batchId);
  return row?.text ?? null;
}

export async function listMappings(): Promise<MappingVersion[]> {
  const db = await getDB();
  const all = await db.getAll('mappings');
  return all.sort((a, b) => a.version - b.version);
}

export async function putMapping(version: MappingVersion): Promise<void> {
  const db = await getDB();
  await db.put('mappings', version);
}

export async function latestMapping(): Promise<MappingVersion | null> {
  const all = await listMappings();
  return all.length ? all[all.length - 1] : null;
}

export async function listAssertions(): Promise<AddressAssertion[]> {
  const db = await getDB();
  const all = await db.getAll('assertions');
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export async function putAssertion(a: AddressAssertion): Promise<void> {
  const db = await getDB();
  await db.put('assertions', a);
}

export async function listRuns(): Promise<AnalysisRun[]> {
  const db = await getDB();
  const all = await db.getAll('runs');
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export async function getRun(id: string): Promise<AnalysisRun | null> {
  const db = await getDB();
  return (await db.get('runs', id)) ?? null;
}

export async function putRun(run: AnalysisRun): Promise<void> {
  const db = await getDB();
  await db.put('runs', run);
}

export async function deleteRun(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('runs', id);
}

export async function getMeta<T>(key: string, fallback: T): Promise<T> {
  const db = await getDB();
  const row = await db.get('meta', key);
  return (row?.value as T) ?? fallback;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  const db = await getDB();
  await db.put('meta', { key, value });
}

export async function getConfig(): Promise<AnalysisConfig> {
  return { ...DEFAULT_CONFIG, ...(await getMeta<Partial<AnalysisConfig>>('config', {})) };
}

export async function setConfig(config: AnalysisConfig): Promise<void> {
  await setMeta('config', config);
}

export async function getActiveMappingId(): Promise<string | null> {
  return getMeta<string | null>('activeMappingId', null);
}

export async function setActiveMappingId(id: string | null): Promise<void> {
  await setMeta('activeMappingId', id);
}

export async function clearAll(): Promise<void> {
  const db = await getDB();
  const stores: Array<'batches' | 'files' | 'mappings' | 'assertions' | 'runs' | 'meta'> = [
    'batches',
    'files',
    'mappings',
    'assertions',
    'runs',
    'meta',
  ];
  const tx = db.transaction(stores, 'readwrite');
  await Promise.all(stores.map((s) => tx.objectStore(s).clear()));
  await tx.done;
}

export async function storageEstimate(): Promise<{ usage: number; quota: number }> {
  try {
    const est = await navigator.storage?.estimate?.();
    return { usage: est?.usage ?? 0, quota: est?.quota ?? 0 };
  } catch {
    return { usage: 0, quota: 0 };
  }
}
