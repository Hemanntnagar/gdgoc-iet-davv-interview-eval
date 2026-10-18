import { Fragment, useCallback, useEffect, useState } from 'react';
import { api, downloadCsv } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { Panel, ResultRow } from '../lib/types';

type SortKey = 'name' | 'branch' | 'average';

export function AdminResults() {
  const { getToken } = useAuth();
  const [rows, setRows] = useState<ResultRow[]>([]);
  const [panels, setPanels] = useState<Panel[]>([]);
  const [search, setSearch] = useState('');
  const [branch, setBranch] = useState('');
  const [panelId, setPanelId] = useState('');
  const [evalStatus, setEvalStatus] = useState('');
  const [interviewStatus, setInterviewStatus] = useState('');
  const [sort, setSort] = useState<SortKey>('average');
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const qs = useCallback(() => {
    const p = new URLSearchParams();
    if (search) p.set('search', search);
    if (branch) p.set('branch', branch);
    if (panelId) p.set('panelId', panelId);
    if (evalStatus) p.set('evaluationStatus', evalStatus);
    if (interviewStatus) p.set('interviewStatus', interviewStatus);
    p.set('sort', sort);
    p.set('order', order);
    return p.toString();
  }, [search, branch, panelId, evalStatus, interviewStatus, sort, order]);

  const load = useCallback(async () => {
    const token = await getToken();
    if (!token) return;
    try {
      const res = await api<{ results: ResultRow[] }>(`/results?${qs()}`, { token });
      setRows(res.results);
      const p = await api<{ panels: Panel[] }>('/panels', { token });
      setPanels(p.panels);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load results');
    }
  }, [getToken, qs]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 200);
    return () => clearTimeout(t);
  }, [load]);

  const exportCsv = async (kind: 'summary' | 'detailed') => {
    const token = await getToken();
    if (!token) return;
    try {
      await downloadCsv(`/export/${kind}.csv?${qs()}`, token, `results-${kind}.csv`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed');
    }
  };

  const toggleSort = (key: SortKey) => {
    if (sort === key) setOrder(order === 'asc' ? 'desc' : 'asc');
    else {
      setSort(key);
      setOrder(key === 'average' ? 'desc' : 'asc');
    }
  };

  const arrow = (key: SortKey) => (sort === key ? (order === 'asc' ? ' ↑' : ' ↓') : '');

  return (
    <>
      <h1>Results</h1>
      {error && <div className="alert error">{error}</div>}
      <div className="card">
        <div className="filters">
          <div>
            <label>Name / application ID</label>
            <input value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div>
            <label>Branch</label>
            <input value={branch} onChange={(e) => setBranch(e.target.value)} />
          </div>
          <div>
            <label>Panel</label>
            <select value={panelId} onChange={(e) => setPanelId(e.target.value)}>
              <option value="">All</option>
              {panels.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>Evaluation completion</label>
            <select value={evalStatus} onChange={(e) => setEvalStatus(e.target.value)}>
              <option value="">Any</option>
              <option value="not_started">Not started</option>
              <option value="in_progress">In progress</option>
              <option value="complete">Complete</option>
            </select>
          </div>
          <div>
            <label>Interview status</label>
            <select value={interviewStatus} onChange={(e) => setInterviewStatus(e.target.value)}>
              <option value="">Any</option>
              <option value="pending">Pending</option>
              <option value="in_progress">In progress</option>
              <option value="completed">Completed</option>
              <option value="no_show">No show</option>
            </select>
          </div>
          <button className="btn" onClick={() => void exportCsv('summary')}>
            Export summary CSV
          </button>
          <button className="btn secondary" onClick={() => void exportCsv('detailed')}>
            Export detailed CSV
          </button>
        </div>
      </div>

      <div className="table-wrap card" style={{ padding: 0 }}>
        <table className="data">
          <thead>
            <tr>
              <th>
                <button onClick={() => toggleSort('name')}>
                  Candidate{arrow('name')}
                </button>
              </th>
              <th>
                <button onClick={() => toggleSort('branch')}>
                  Branch{arrow('branch')}
                </button>
              </th>
              <th>Panel</th>
              <th>
                <button onClick={() => toggleSort('average')}>
                  Average{arrow('average')}
                </button>
              </th>
              <th>Evaluations</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <Fragment key={r.candidate_id}>
                <tr>
                  <td>
                    <button
                      className="btn secondary small"
                      onClick={() => setExpanded(expanded === r.candidate_id ? null : r.candidate_id)}
                    >
                      {expanded === r.candidate_id ? '▾' : '▸'} {r.full_name}
                    </button>
                  </td>
                  <td>{r.branch}</td>
                  <td>{r.panel_name}</td>
                  <td>
                    {r.average_score === null ? (
                      <span className="muted">—</span>
                    ) : (
                      <strong>{r.average_score.toFixed(2)}</strong>
                    )}
                  </td>
                  <td>
                    {r.evaluation_count}/{r.expected_evaluations}{' '}
                    <span
                      className={`badge ${
                        r.evaluation_status === 'complete' ? 'ok' : r.evaluation_status === 'in_progress' ? 'warn' : 'neutral'
                      }`}
                    >
                      {r.evaluation_status.replace('_', ' ')}
                    </span>
                  </td>
                  <td>
                    <span className="badge neutral">{r.interview_status.replace('_', ' ')}</span>{' '}
                    <span className="badge blue">{r.shortlisting_status}</span>
                  </td>
                </tr>
                {expanded === r.candidate_id && (
                  <tr>
                    <td colSpan={6}>
                      {r.judge_ratings.length === 0 ? (
                        <span className="muted">No evaluations yet — not counted as zero.</span>
                      ) : (
                        <table className="data" style={{ background: 'transparent' }}>
                          <thead>
                            <tr>
                              <th>Judge</th>
                              <th>Score</th>
                              <th>Version</th>
                              <th>Submitted</th>
                            </tr>
                          </thead>
                          <tbody>
                            {r.judge_ratings.map((jr) => (
                              <tr key={jr.evaluation_id}>
                                <td>{jr.judge_name || jr.judge_id}</td>
                                <td>{jr.score ?? '—'}</td>
                                <td>v{jr.version}</td>
                                <td>{new Date(jr.submitted_at).toLocaleString()}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <div className="empty">No candidates match the filters.</div>}
      </div>
    </>
  );
}
