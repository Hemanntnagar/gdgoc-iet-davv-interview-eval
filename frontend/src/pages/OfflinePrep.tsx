import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  getMeta,
  listCachedCandidates,
  listCachedCriteria,
  listCachedRounds,
  saveCandidates,
  saveCriteria,
  saveRounds,
  setMeta,
} from '../lib/idb';
import { useOnline } from '../lib/net';
import { useSync } from '../lib/syncContext';
import { getLastSyncAt } from '../lib/sync';
import type { Candidate, Criterion, Round } from '../lib/types';

export function OfflinePrep() {
  const { getToken, panels, profile, status } = useAuth();
  const online = useOnline();
  const { pending, syncNow } = useSync();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [cachedCount, setCachedCount] = useState(0);
  const [roundsCount, setRoundsCount] = useState(0);

  const refreshStatus = useCallback(async () => {
    setReady(!!(await getMeta<boolean>('offline_prepared')));
    setLastSyncAt(await getLastSyncAt());
    setCachedCount((await listCachedCandidates()).length);
    setRoundsCount((await listCachedRounds()).length);
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus, pending]);

  const prepare = async () => {
    setBusy(true);
    setError(null);
    setReport(null);
    try {
      if (!online) throw new Error('You are offline. Connect to the internet to prepare.');
      const token = await getToken();
      if (!token) throw new Error('Session expired — sign in again to prepare.');
      const me = await api<{ panels: { id: string }[] }>('/me', { token });
      const panelIds = me.panels.map((p) => p.id);
      if (panelIds.length === 0) {
        throw new Error('You have no verified panel. Verify your panel code first.');
      }
      // 1. Candidates (only fields the judge is authorized to receive)
      const candRes = await api<{ candidates: Candidate[] }>('/candidates', { token });
      await saveCandidates(candRes.candidates);
      // 2. Rounds + criteria
      const roundRes = await api<{ rounds: Round[] }>('/rounds', { token });
      const openRounds = roundRes.rounds.filter((r) => r.is_open);
      await saveRounds(openRounds);
      const allCriteria: Criterion[] = [];
      for (const r of openRounds) {
        const cRes = await api<{ criteria: Criterion[] }>(`/rounds/${r.id}/criteria`, { token });
        allCriteria.push(...cRes.criteria);
      }
      await saveCriteria(allCriteria);
      // 3. Metadata
      await setMeta('offline_prepared', true);
      await setMeta('last_sync_at', new Date().toISOString());
      await setMeta('prepared_for_user', profile?.id ?? '');
      // 4. Drain any queued evaluations
      await syncNow();
      setReport(
        `Device prepared: ${candRes.candidates.length} candidate(s), ${openRounds.length} open round(s), ${allCriteria.length} criteria stored locally.`,
      );
      await refreshStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Preparation failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h1>Offline preparation</h1>
      <p className="muted">
        Judges can interview and rate candidates without internet after this one-time preparation.
        Evaluations are stored in this browser (IndexedDB) and uploaded automatically when you are
        back online.
      </p>

      <div className="card">
        <h3>Readiness</h3>
        <p>
          {ready ? (
            <span className="badge ok">Ready for offline interviews</span>
          ) : (
            <span className="badge warn">Not ready — run preparation while online</span>
          )}
        </p>
        <ul className="muted">
          <li>Cached candidates: {cachedCount}</li>
          <li>Cached open rounds: {roundsCount}</li>
          <li>
            Last successful sync:{' '}
            {lastSyncAt ? new Date(lastSyncAt).toLocaleString() : 'never on this device'}
          </li>
          <li>Queued evaluations: {pending}</li>
          <li>Network: {online ? 'online' : 'offline'}</li>
          <li>
            App installed / service worker:{' '}
            {typeof window !== 'undefined' && 'serviceWorker' in navigator ? 'supported' : 'not supported'}
          </li>
        </ul>
        {status === 'offline' && (
          <div className="alert warn">
            You are on an offline session. Preparation and synchronization require signing in while
            online.
          </div>
        )}
        {error && <div className="alert error">{error}</div>}
        {report && <div className="alert success">{report}</div>}
        <div className="btn-row">
          <button className="btn" onClick={() => void prepare()} disabled={busy || !online}>
            {busy ? 'Preparing…' : 'Prepare for offline interviews'}
          </button>
          <button className="btn secondary" onClick={() => void syncNow()} disabled={busy || !online}>
            Sync now
          </button>
          <Link className="btn secondary" to="/candidates">
            Open candidate list
          </Link>
        </div>
      </div>

      <div className="card">
        <h3>How offline mode behaves</h3>
        <ul className="muted">
          <li>Once prepared, the app shell loads from a service worker and candidates from IndexedDB.</li>
          <li>Submitted evaluations are saved locally first and confirmed before counting as synced.</li>
          <li>
            The offline session expires after a configurable period (default 12 hours); after that you
            must sign in again.
          </li>
          <li>
            On shared devices, use <strong>Log out</strong> — it wipes all locally cached candidates and
            evaluations.
          </li>
        </ul>
      </div>
    </>
  );
}
