import { api } from './api';
import { deleteOutboxItem, getMeta, listOutbox, putOutboxItem, setMeta } from './idb';
import type { OutboxItem, SyncResultRow } from './types';

export interface SyncReport {
  attempted: number;
  synced: number;
  conflicts: number;
  errors: number;
  message: string;
}

type Listener = () => void;

/**
 * Durable outbox synchronizer.
 * - Items are written to IndexedDB before any network attempt.
 * - Server confirmation (per item) is required before an item counts as synced.
 * - Failures keep the item queued for retry; partial batch failures never
 *   discard successful items.
 * - Idempotency is provided by client-generated evaluation UUIDs.
 */
export class SyncEngine {
  private running = false;
  private listeners = new Set<Listener>();
  private lastReport: SyncReport | null = null;

  constructor(private getToken: () => Promise<string | null>) {}

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }

  getLastReport(): SyncReport | null {
    return this.lastReport;
  }

  isRunning(): boolean {
    return this.running;
  }

  async pendingCount(): Promise<number> {
    const items = await listOutbox();
    return items.filter((o) => o.status === 'pending' || o.status === 'error').length;
  }

  async enqueue(item: OutboxItem): Promise<void> {
    await putOutboxItem(item);
    this.emit();
  }

  async syncNow(): Promise<SyncReport> {
    if (this.running) {
      return this.lastReport ?? { attempted: 0, synced: 0, conflicts: 0, errors: 0, message: 'Sync already running' };
    }
    this.running = true;
    this.emit();
    try {
      const token = await this.getToken();
      if (!token) {
        const report: SyncReport = {
          attempted: 0,
          synced: 0,
          conflicts: 0,
          errors: 0,
          message: 'Session expired — sign in again to synchronize',
        };
        this.lastReport = report;
        return report;
      }
      const items = (await listOutbox()).filter((o) => o.status === 'pending' || o.status === 'error');
      if (items.length === 0) {
        const report: SyncReport = { attempted: 0, synced: 0, conflicts: 0, errors: 0, message: 'Nothing to synchronize' };
        this.lastReport = report;
        return report;
      }
      let synced = 0;
      let conflicts = 0;
      let errors = 0;
      // Controlled batches of up to 20
      for (let i = 0; i < items.length; i += 20) {
        const chunk = items.slice(i, i + 20);
        for (const item of chunk) {
          await putOutboxItem({ ...item, status: 'syncing', last_attempt_at: new Date().toISOString() });
        }
        this.emit();
        try {
          const res = await api<{ results: SyncResultRow[] }>('/sync/evaluations', {
            method: 'POST',
            token,
            body: JSON.stringify({
              evaluations: chunk.map((item) => ({
                id: item.id,
                candidate_id: item.candidate_id,
                round_id: item.round_id,
                feedback: item.feedback,
                overall_score: item.overall_score,
                scores: item.scores,
                criterion_feedbacks: item.criterion_feedbacks ?? {},
                preferred_vertical_id: item.preferred_vertical_id ?? null,
                client_created_at: item.client_created_at,
                replace_existing: true,
              })),
            }),
          });
          for (const result of res.results) {
            const item = chunk.find((c) => c.id === result.id);
            if (!item) continue;
            if (result.status === 'ok') {
              await putOutboxItem({
                ...item,
                status: 'synced',
                last_error: undefined,
                conflict: undefined,
              });
              synced += 1;
            } else if (result.status === 'conflict') {
              await putOutboxItem({
                ...item,
                status: 'conflict',
                conflict: { message: result.message ?? 'Conflict with server record', server: result.existing },
                last_error: result.message,
              });
              conflicts += 1;
            } else {
              await putOutboxItem({
                ...item,
                status: 'error',
                attempts: item.attempts + 1,
                last_error: result.message ?? 'Upload failed',
              });
              errors += 1;
            }
          }
        } catch (e) {
          // Network/transport failure: return the whole chunk to pending.
          const message = e instanceof Error ? e.message : 'Network error';
          for (const item of chunk) {
            await putOutboxItem({
              ...item,
              status: 'pending',
              attempts: item.attempts + 1,
              last_error: message,
            });
          }
          errors += chunk.length;
          this.lastReport = {
            attempted: items.length,
            synced,
            conflicts,
            errors,
            message: `Synchronization interrupted: ${message}. Items remain queued.`,
          };
          return this.lastReport;
        }
      }
      await setMeta('last_sync_at', new Date().toISOString());
      const report: SyncReport = {
        attempted: items.length,
        synced,
        conflicts,
        errors,
        message:
          errors === 0 && conflicts === 0
            ? `All ${synced} evaluation(s) synchronized`
            : `Synchronized ${synced}; ${conflicts} conflict(s); ${errors} error(s)`,
      };
      this.lastReport = report;
      return report;
    } finally {
      this.running = false;
      this.emit();
    }
  }

  /** Resolve a conflicted item: discard the local copy (server wins). */
  async discardConflicting(id: string): Promise<void> {
    await deleteOutboxItem(id);
    this.emit();
  }

  /** Remove locally synced items from the outbox after review. */
  async clearSynced(): Promise<void> {
    const items = await listOutbox('synced');
    for (const item of items) await deleteOutboxItem(item.id);
    this.emit();
  }
}

export async function getLastSyncAt(): Promise<string | null> {
  return (await getMeta<string>('last_sync_at')) ?? null;
}
