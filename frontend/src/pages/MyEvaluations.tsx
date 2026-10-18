import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { listOutbox } from '../lib/idb';
import { useOnline } from '../lib/net';
import { useSync } from '../lib/syncContext';
import type { EvaluationWithScores, OutboxItem } from '../lib/types';

const statusBadge = (s: OutboxItem['status']) => {
  switch (s) {
    case 'synced':
      return <span className="badge ok">Synced</span>;
    case 'conflict':
      return <span className="badge err">Conflict</span>;
    case 'error':
      return <span className="badge err">Failed</span>;
    case 'syncing':
      return <span className="badge blue">Syncing</span>;
    default:
      return <span className="badge warn">Pending</span>;
  }
};

export function MyEvaluations() {
  const { getToken } = useAuth();
  const online = useOnline();
  const { refresh } = useSync();
  const [server, setServer] = useState<EvaluationWithScores[] | null>(null);
  const [local, setLocal] = useState<OutboxItem[]>([]);

  useEffect(() => {
    void (async () => {
      await refresh();
      setLocal(await listOutbox());
      if (online) {
        try {
          const token = await getToken();
          if (token) {
            const res = await api<{ evaluations: EvaluationWithScores[] }>('/evaluations/mine', { token });
            setServer(res.evaluations);
          }
        } catch {
          setServer(null);
        }
      }
    })();
  }, [getToken, online, refresh]);

  return (
    <>
      <h1>My evaluations</h1>
      <h2>On this device</h2>
      {local.length === 0 ? (
        <div className="card empty">No locally stored evaluations.</div>
      ) : (
        local
          .slice()
          .reverse()
          .map((item) => (
            <div className="card tight outbox-item" key={item.id}>
              <div className="head">
                <strong>{item.candidate_name || item.candidate_id}</strong>
                <span>{statusBadge(item.status)}</span>
              </div>
              <div className="muted">
                {item.round_name} · score {item.overall_score ?? '—'} ·{' '}
                {new Date(item.client_created_at).toLocaleString()}
                {item.attempts > 0 ? ` · ${item.attempts} attempt(s)` : ''}
              </div>
              {item.last_error && <div className="muted">Last error: {item.last_error}</div>}
              <div className="btn-row mt">
                <Link className="btn secondary small" to={`/candidates/${item.candidate_id}/evaluate`}>
                  Open
                </Link>
                <Link className="btn secondary small" to="/sync">
                  Sync status
                </Link>
              </div>
            </div>
          ))
      )}

      <h2>Submitted (server)</h2>
      {!online ? (
        <div className="alert warn">Offline — server history is unavailable.</div>
      ) : server === null ? (
        <div className="empty">
          <span className="spinner" /> Loading…
        </div>
      ) : server.length === 0 ? (
        <div className="card empty">No submitted evaluations yet.</div>
      ) : (
        <div className="table-wrap card" style={{ padding: 0 }}>
          <table className="data">
            <thead>
              <tr>
                <th>Candidate</th>
                <th>Round</th>
                <th>Score</th>
                <th>Version</th>
                <th>Submitted</th>
              </tr>
            </thead>
            <tbody>
              {server.map((e) => (
                <tr key={e.id}>
                  <td>{e.candidate_name ?? e.candidate_id}</td>
                  <td>{e.round_name ?? e.round_id}</td>
                  <td>{e.overall_score ?? '—'}</td>
                  <td>v{e.version}</td>
                  <td>{new Date(e.submitted_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
