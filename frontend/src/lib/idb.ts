import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Candidate, Criterion, OutboxItem, Profile, Round } from './types';

interface OfflineDB extends DBSchema {
  candidates: {
    key: string;
    value: Candidate;
    indexes: { panel_id: string };
  };
  outbox: {
    key: string;
    value: OutboxItem;
    indexes: { status: string; candidate_id: string };
  };
  meta: {
    key: string;
    value: { key: string; value: unknown };
  };
  rounds: { key: string; value: Round };
  criteria: { key: string; value: Criterion };
}

const DB_NAME = 'gdgoc-offline';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<OfflineDB>> | null = null;

export function getDb(): Promise<IDBPDatabase<OfflineDB>> {
  if (!dbPromise) {
    dbPromise = openDB<OfflineDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        const candidates = db.createObjectStore('candidates', { keyPath: 'id' });
        candidates.createIndex('panel_id', 'panel_id');
        const outbox = db.createObjectStore('outbox', { keyPath: 'id' });
        outbox.createIndex('status', 'status');
        outbox.createIndex('candidate_id', 'candidate_id');
        db.createObjectStore('meta', { keyPath: 'key' });
        db.createObjectStore('rounds', { keyPath: 'id' });
        db.createObjectStore('criteria', { keyPath: 'id' });
      },
    });
  }
  return dbPromise;
}

// ---- meta -----------------------------------------------------------------
export async function setMeta<T>(key: string, value: T): Promise<void> {
  const db = await getDb();
  await db.put('meta', { key, value });
}
export async function getMeta<T>(key: string): Promise<T | undefined> {
  const db = await getDb();
  const row = await db.get('meta', key);
  return row?.value as T | undefined;
}

// ---- candidates -------------------------------------------------------------
export async function saveCandidates(candidates: Candidate[]): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('candidates', 'readwrite');
  await Promise.all(candidates.map((c) => tx.store.put(c)));
  await tx.done;
}
export async function listCachedCandidates(panelIds?: string[]): Promise<Candidate[]> {
  const db = await getDb();
  const all = await db.getAll('candidates');
  if (!panelIds || panelIds.length === 0) return all;
  return all.filter((c) => panelIds.includes(c.panel_id));
}
export async function clearCachedCandidates(): Promise<void> {
  const db = await getDb();
  await db.clear('candidates');
}

// ---- rounds & criteria --------------------------------------------------------
export async function saveRounds(rounds: Round[]): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('rounds', 'readwrite');
  await Promise.all(rounds.map((r) => tx.store.put(r)));
  await tx.done;
}
export async function listCachedRounds(): Promise<Round[]> {
  return (await getDb()).getAll('rounds');
}
export async function saveCriteria(criteria: Criterion[]): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('criteria', 'readwrite');
  await Promise.all(criteria.map((c) => tx.store.put(c)));
  await tx.done;
}
export async function listCachedCriteria(roundId?: string): Promise<Criterion[]> {
  const all = await (await getDb()).getAll('criteria');
  return roundId ? all.filter((c) => c.round_id === roundId) : all;
}

// ---- outbox -------------------------------------------------------------------
export async function putOutboxItem(item: OutboxItem): Promise<void> {
  await (await getDb()).put('outbox', item);
}
export async function getOutboxItem(id: string): Promise<OutboxItem | undefined> {
  return (await getDb()).get('outbox', id);
}
export async function listOutbox(status?: OutboxItem['status']): Promise<OutboxItem[]> {
  const db = await getDb();
  const all = await db.getAllFromIndex('outbox', 'status');
  // idb index getAll returns all; filter in case of partial ranges
  const rows = status ? all.filter((o) => o.status === status) : all;
  return rows.sort((a, b) => a.client_created_at.localeCompare(b.client_created_at));
}
export async function deleteOutboxItem(id: string): Promise<void> {
  await (await getDb()).delete('outbox', id);
}

// ---- offline session ----------------------------------------------------------------
export interface OfflineSession {
  user_id: string;
  email: string;
  full_name: string;
  role: 'judge' | 'admin';
  panel_ids: string[];
  expires_at: string;
}

export async function saveOfflineSession(session: OfflineSession): Promise<void> {
  await setMeta('offline_session', session);
}
export async function getOfflineSession(): Promise<OfflineSession | null> {
  const s = await getMeta<OfflineSession>('offline_session');
  if (!s) return null;
  if (new Date(s.expires_at).getTime() < Date.now()) return null;
  return s;
}

/** Wipes all local data — used on logout (important on shared devices). */
export async function wipeLocalData(): Promise<void> {
  const db = await getDb();
  await db.clear('candidates');
  await db.clear('outbox');
  await db.clear('meta');
  await db.clear('rounds');
  await db.clear('criteria');
}

export type { Profile };
