import { beforeEach, describe, expect, it, vi } from 'vitest';

// In-memory stand-in for the IndexedDB module
const store = new Map<string, any>();
const outbox = new Map<string, any>();

vi.mock('../src/lib/idb', () => {
  const putOutboxItem = async (item: any) => {
    outbox.set(item.id, { ...item });
  };
  return {
    putOutboxItem,
    getOutboxItem: async (id: string) => outbox.get(id),
    listOutbox: async (status?: string) => {
      const all = [...outbox.values()];
      const rows = status ? all.filter((o) => o.status === status) : all;
      return rows.sort((a, b) => a.client_created_at.localeCompare(b.client_created_at));
    },
    deleteOutboxItem: async (id: string) => {
      outbox.delete(id);
    },
    getMeta: async (key: string) => store.get(`meta:${key}`),
    setMeta: async (key: string, value: unknown) => {
      store.set(`meta:${key}`, value);
    },
  };
});

vi.mock('../src/lib/api', () => {
  return {
    api: async (path: string, options: any) => {
      const handler = (globalThis as any).__apiHandler;
      return handler(path, options);
    },
  };
});

import { SyncEngine } from '../src/lib/sync';
import { listOutbox, putOutboxItem } from '../src/lib/idb';
import type { OutboxItem } from '../src/lib/types';

function item(id: string, extra: Partial<OutboxItem> = {}): OutboxItem {
  return {
    id,
    candidate_id: 'cand-1',
    candidate_name: 'Ada',
    round_id: 'round-1',
    round_name: 'Round 1',
    panel_id: 'panel-1',
    feedback: '',
    overall_score: 8,
    scores: {},
    client_created_at: new Date().toISOString(),
    status: 'pending',
    attempts: 0,
    ...extra,
  };
}

describe('SyncEngine', () => {
  beforeEach(() => {
    store.clear();
    outbox.clear();
    (globalThis as any).__apiHandler = undefined;
  });

  it('marks items synced only after server confirmation', async () => {
    (globalThis as any).__apiHandler = async () => ({
      results: [{ id: 'e1', status: 'ok' }],
    });
    await putOutboxItem(item('e1'));
    const engine = new SyncEngine(async () => 'token');
    const report = await engine.syncNow();
    expect(report.synced).toBe(1);
    const rows = await listOutbox();
    expect(rows[0].status).toBe('synced');
  });

  it('keeps items queued when the network fails', async () => {
    (globalThis as any).__apiHandler = async () => {
      throw new Error('network down');
    };
    await putOutboxItem(item('e1'));
    const engine = new SyncEngine(async () => 'token');
    const report = await engine.syncNow();
    expect(report.synced).toBe(0);
    expect(report.errors).toBe(1);
    const rows = await listOutbox();
    expect(rows[0].status).toBe('pending');
    expect(rows[0].attempts).toBe(1);
    expect(rows[0].last_error).toContain('network down');
  });

  it('handles partial failures without losing successful items', async () => {
    (globalThis as any).__apiHandler = async () => ({
      results: [
        { id: 'good', status: 'ok' },
        { id: 'bad', status: 'error', message: 'Invalid scores' },
      ],
    });
    await putOutboxItem(item('good'));
    await putOutboxItem(item('bad'));
    const engine = new SyncEngine(async () => 'token');
    const report = await engine.syncNow();
    expect(report.synced).toBe(1);
    expect(report.errors).toBe(1);
    const rows = await listOutbox();
    expect(rows.find((r) => r.id === 'good')?.status).toBe('synced');
    expect(rows.find((r) => r.id === 'bad')?.status).toBe('error');
    expect(rows.find((r) => r.id === 'bad')?.last_error).toBe('Invalid scores');
  });

  it('preserves local copies for conflicts', async () => {
    (globalThis as any).__apiHandler = async () => ({
      results: [{ id: 'e1', status: 'conflict', message: 'already exists', existing: { id: 'srv' } }],
    });
    await putOutboxItem(item('e1'));
    const engine = new SyncEngine(async () => 'token');
    const report = await engine.syncNow();
    expect(report.conflicts).toBe(1);
    const rows = await listOutbox();
    expect(rows[0].status).toBe('conflict');
    expect(rows[0].conflict?.message).toBe('already exists');
  });

  it('does not sync without an auth token', async () => {
    await putOutboxItem(item('e1'));
    const engine = new SyncEngine(async () => null);
    const report = await engine.syncNow();
    expect(report.synced).toBe(0);
    expect(report.message).toMatch(/sign in/i);
    const rows = await listOutbox();
    expect(rows[0].status).toBe('pending');
  });

  it('retries a previously failed item on the next sync', async () => {
    (globalThis as any).__apiHandler = async () => {
      throw new Error('offline');
    };
    await putOutboxItem(item('e1'));
    const engine = new SyncEngine(async () => 'token');
    await engine.syncNow();
    (globalThis as any).__apiHandler = async () => ({ results: [{ id: 'e1', status: 'ok' }] });
    const report = await engine.syncNow();
    expect(report.synced).toBe(1);
    const rows = await listOutbox();
    expect(rows[0].status).toBe('synced');
  });
});
