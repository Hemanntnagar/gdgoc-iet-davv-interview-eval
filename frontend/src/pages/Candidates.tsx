import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { listCachedCandidates, saveCandidates } from '../lib/idb';
import { useOnline } from '../lib/net';
import type { Candidate } from '../lib/types';

type SortKey = 'name' | 'branch' | 'average';

export function Candidates() {
  const { getToken, panels } = useAuth();
  const online = useOnline();
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [source, setSource] = useState<'server' | 'cache'>('server');
  const [search, setSearch] = useState('');
  const [branch, setBranch] = useState('');
  const [panelId, setPanelId] = useState('');
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState<SortKey>('name');
  const [order, setOrder] = useState<'asc' | 'desc'>('asc');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    if (online) {
      try {
        const token = await getToken();
        if (!token) throw new Error('Session expired — sign in again');
        const qs = new URLSearchParams();
        if (search) qs.set('search', search);
        if (branch) qs.set('branch', branch);
        if (panelId) qs.set('panelId', panelId);
        if (status) qs.set('interviewStatus', status);
        qs.set('sort', sort);
        qs.set('order', order);
        const res = await api<{ candidates: Candidate[] }>(`/candidates?${qs}`, { token });
        setCandidates(res.candidates);
        setSource('server');
        if (search === '' && branch === '' && !panelId && !status) {
          // Cache the unfiltered panel list for offline use
          void saveCandidates(res.candidates);
        }
        return;
      } catch (e) {
        // fall through to cache
        setError(e instanceof Error ? e.message : 'Failed to load candidates');
      }
    }
    const cached = await listCachedCandidates(panels.map((p) => p.id));
    setCandidates(cached);
    setSource('cache');
  }, [getToken, panels, online, search, branch, panelId, status, sort, order]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 250);
    return () => clearTimeout(t);
  }, [load]);

  const branches = useMemo(() => {
    const set = new Set((candidates ?? []).map((c) => c.branch).filter(Boolean));
    return [...set].sort();
  }, [candidates]);

  return (
    <>
      <h1>Candidates</h1>
      <p className="muted">
        {source === 'cache'
          ? 'Showing locally cached data (offline).'
          : 'Loaded from the server.'}{' '}
        {candidates ? `${candidates.length} shown.` : ''}
      </p>
      {error && source === 'cache' && (
        <div className="alert warn">Could not reach the server ({error}). Using cached data.</div>
      )}
      <div className="card">
        <div className="filters">
          <div>
            <label>Name / application ID</label>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…" />
          </div>
          <div>
            <label>Branch</label>
            <input value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="e.g. CSE" list="branch-list" />
            <datalist id="branch-list">
              {branches.map((b) => (
                <option key={b} value={b} />
              ))}
            </datalist>
          </div>
          <div>
            <label>Panel</label>
            <select value={panelId} onChange={(e) => setPanelId(e.target.value)}>
              <option value="">All my panels</option>
              {panels.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Any</option>
              <option value="pending">Pending</option>
              <option value="in_progress">In progress</option>
              <option value="completed">Completed</option>
              <option value="no_show">No show</option>
            </select>
          </div>
          <div>
            <label>Sort by</label>
            <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
              <option value="name">Name</option>
              <option value="branch">Branch</option>
              <option value="average">Average rating</option>
            </select>
          </div>
          <div>
            <label>Order</label>
            <select
              value={order}
              onChange={(e) => setOrder(e.target.value as 'asc' | 'desc')}
            >
              <option value="asc">Ascending</option>
              <option value="desc">Descending</option>
            </select>
          </div>
        </div>
      </div>

      {candidates === null ? (
        <div className="empty">
          <span className="spinner" /> Loading…
        </div>
      ) : candidates.length === 0 ? (
        <div className="empty">No candidates match your filters.</div>
      ) : (
        <div className="table-wrap card" style={{ padding: 0 }}>
          <table className="data">
            <thead>
              <tr>
                <th>Name</th>
                <th>Branch</th>
                <th>Application</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {candidates.map((c) => (
                <tr key={c.id}>
                  <td>{c.full_name}</td>
                  <td>{c.branch}</td>
                  <td className="mono">{c.application_id ?? '—'}</td>
                  <td>
                    <span className="badge neutral">{c.interview_status.replace('_', ' ')}</span>
                  </td>
                  <td>
                    <Link className="btn small" to={`/candidates/${c.id}/evaluate`}>
                      Evaluate
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
