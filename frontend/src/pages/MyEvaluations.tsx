import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { listOutbox } from '../lib/idb';
import { useOnline } from '../lib/net';
import { useSync } from '../lib/syncContext';
import { SortableTh, useSort } from '../components/Sortable';
import type { EvaluationWithScores, OutboxItem, Vertical } from '../lib/types';

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
  const [verticals, setVerticals] = useState<Vertical[]>([]);

  const getSortValue = useCallback((e: EvaluationWithScores, key: string): unknown => {
    switch (key) {
      case 'candidate':
        return e.candidate_name ?? e.candidate_id;
      case 'round':
        return e.round_name ?? e.round_id;
      case 'score':
        return e.overall_score;
      case 'version':
        return e.version;
      case 'submitted':
        return e.submitted_at;
      default:
        return '';
    }
  }, []);
  const sort = useSort(server ?? [], getSortValue, 'submitted', 'desc');

  useEffect(() => {
    if (!online) return;
    void getToken()
      .then((token) => (token ? api<{ verticals: Vertical[] }>('/verticals', { token }) : null))
      .then((r) => r && setVerticals(r.verticals))
      .catch(() => undefined);
  }, [online, getToken]);

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
                <SortableTh label="Candidate" sortKey="candidate" state={sort} />
                <SortableTh label="Round" sortKey="round" state={sort} />
                <th>Preferred vertical</th>
                <SortableTh label="Score" sortKey="score" state={sort} />
                <SortableTh label="Version" sortKey="version" state={sort} />
                <SortableTh label="Submitted" sortKey="submitted" state={sort} />
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sort.sorted.map((e) => (
                <tr key={e.id}>
                  <td>{e.candidate_name ?? e.candidate_id}</td>
                  <td>{e.round_name ?? e.round_id}</td>
                  <td>
                    {e.preferred_vertical_id
                      ? verticals.find((v) => v.id === e.preferred_vertical_id)?.name ?? e.preferred_vertical_id
                      : '—'}
                  </td>
                  <td>{e.overall_score ?? '—'}</td>
                  <td>v{e.version}</td>
                  <td>{new Date(e.submitted_at).toLocaleString()}</td>
                  <td>
                    <Link className="btn secondary small" to={`/candidates/${e.candidate_id}/evaluate`}>
                      Edit
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
