import { useCallback, useEffect, useState } from 'react';
import { api, downloadCsv, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ConfirmDialog } from '../components/Ui';
import type { Candidate, Panel } from '../lib/types';

export function AdminCandidates() {
  const { getToken } = useAuth();
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [panels, setPanels] = useState<Panel[]>([]);
  const [search, setSearch] = useState('');
  const [branch, setBranch] = useState('');
  const [panelId, setPanelId] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<Partial<Candidate> | null>(null);
  const [confirmArchive, setConfirmArchive] = useState<Candidate | null>(null);
  const [csvText, setCsvText] = useState('');
  const [importResult, setImportResult] = useState<unknown>(null);

  const load = useCallback(async () => {
    const token = await getToken();
    if (!token) return;
    const qs = new URLSearchParams();
    if (search) qs.set('search', search);
    if (branch) qs.set('branch', branch);
    if (panelId) qs.set('panelId', panelId);
    if (includeArchived) qs.set('includeArchived', 'true');
    const res = await api<{ candidates: Candidate[] }>(`/candidates?${qs}`, { token });
    setCandidates(res.candidates);
    const p = await api<{ panels: Panel[] }>('/panels', { token });
    setPanels(p.panels);
  }, [getToken, search, branch, panelId, includeArchived]);

  useEffect(() => {
    const t = setTimeout(() => void load().catch((e) => setError(String(e.message ?? e))), 250);
    return () => clearTimeout(t);
  }, [load]);

  const save = async () => {
    if (!editing) return;
    setError(null);
    const token = await getToken();
    if (!token) return;
    try {
      const body = {
        full_name: editing.full_name,
        branch: editing.branch ?? '',
        application_id: editing.application_id || null,
        panel_id: editing.panel_id,
        interview_status: editing.interview_status,
        shortlisting_status: editing.shortlisting_status,
      };
      if (editing.id) {
        await api(`/candidates/${editing.id}`, { method: 'PATCH', token, body: JSON.stringify(body) });
      } else {
        await api('/candidates', { method: 'POST', token, body: JSON.stringify(body) });
      }
      setEditing(null);
      setNotice('Candidate saved.');
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Save failed');
    }
  };

  const doArchive = async (candidate: Candidate, archived: boolean) => {
    const token = await getToken();
    if (!token) return;
    await api(`/candidates/${candidate.id}/archive`, {
      method: 'POST',
      token,
      body: JSON.stringify({ archived }),
    });
    setConfirmArchive(null);
    setNotice(archived ? 'Candidate archived.' : 'Candidate restored.');
    await load();
  };

  const doImport = async () => {
    setError(null);
    setImportResult(null);
    const token = await getToken();
    if (!token) return;
    try {
      const res = await api<unknown>('/candidates/import', {
        method: 'POST',
        token,
        body: JSON.stringify({ csv: csvText }),
      });
      setImportResult(res);
      const r = res as { imported: number };
      setNotice(`Import finished: ${r.imported} imported.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed');
    }
  };

  return (
    <>
      <h1>Candidates</h1>
      {error && <div className="alert error">{error}</div>}
      {notice && <div className="alert success">{notice}</div>}

      <div className="card">
        <div className="filters">
          <div>
            <label>Search</label>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name or application ID" />
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
          <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={(e) => setIncludeArchived(e.target.checked)}
              style={{ width: 'auto' }}
            />
            Show archived
          </label>
          <button
            className="btn"
            onClick={() => setEditing({ panel_id: panels[0]?.id ?? '', branch: '' })}
            disabled={panels.length === 0}
          >
            Add candidate
          </button>
          <button
            className="btn secondary"
            onClick={() => {
              void (async () => {
                const token = await getToken();
                if (token) await downloadCsv('/candidates/import/template.csv', token, 'candidates-template.csv');
              })().catch((e) => setError(e instanceof Error ? e.message : 'Download failed'));
            }}
          >
            Download CSV template
          </button>
        </div>
      </div>

      {editing && (
        <div className="card">
          <h3>{editing.id ? 'Edit candidate' : 'New candidate'}</h3>
          <div className="grid cols-2">
            <label className="field">
              <span>Full name</span>
              <input
                value={editing.full_name ?? ''}
                onChange={(e) => setEditing({ ...editing, full_name: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Branch</span>
              <input value={editing.branch ?? ''} onChange={(e) => setEditing({ ...editing, branch: e.target.value })} />
            </label>
            <label className="field">
              <span>Application ID (optional, unique)</span>
              <input
                value={editing.application_id ?? ''}
                onChange={(e) => setEditing({ ...editing, application_id: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Panel</span>
              <select
                value={editing.panel_id ?? ''}
                onChange={(e) => setEditing({ ...editing, panel_id: e.target.value })}
              >
                {panels.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Interview status</span>
              <select
                value={editing.interview_status ?? 'pending'}
                onChange={(e) => setEditing({ ...editing, interview_status: e.target.value as Candidate['interview_status'] })}
              >
                <option value="pending">Pending</option>
                <option value="in_progress">In progress</option>
                <option value="completed">Completed</option>
                <option value="no_show">No show</option>
              </select>
            </label>
            <label className="field">
              <span>Shortlisting status</span>
              <select
                value={editing.shortlisting_status ?? 'pending'}
                onChange={(e) => setEditing({ ...editing, shortlisting_status: e.target.value as Candidate['shortlisting_status'] })}
              >
                <option value="pending">Pending</option>
                <option value="shortlisted">Shortlisted</option>
                <option value="waitlisted">Waitlisted</option>
                <option value="rejected">Rejected</option>
              </select>
            </label>
          </div>
          <div className="btn-row">
            <button className="btn" onClick={() => void save()} disabled={!editing.full_name?.trim()}>
              Save
            </button>
            <button className="btn secondary" onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="table-wrap card" style={{ padding: 0 }}>
        <table className="data">
          <thead>
            <tr>
              <th>Name</th>
              <th>Branch</th>
              <th>Application</th>
              <th>Panel</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {candidates.map((c) => (
              <tr key={c.id} style={c.archived_at ? { opacity: 0.55 } : undefined}>
                <td>{c.full_name}</td>
                <td>{c.branch}</td>
                <td className="mono">{c.application_id ?? '—'}</td>
                <td>{panels.find((p) => p.id === c.panel_id)?.name ?? c.panel_id}</td>
                <td>
                  <span className="badge neutral">{c.interview_status.replace('_', ' ')}</span>{' '}
                  <span className="badge blue">{c.shortlisting_status}</span>
                  {c.archived_at && <span className="badge err">archived</span>}
                </td>
                <td>
                  <div className="btn-row">
                    <button className="btn secondary small" onClick={() => setEditing(c)}>
                      Edit
                    </button>
                    {c.archived_at ? (
                      <button className="btn secondary small" onClick={() => void doArchive(c, false)}>
                        Restore
                      </button>
                    ) : (
                      <button className="btn danger small" onClick={() => setConfirmArchive(c)}>
                        Archive
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {candidates.length === 0 && <div className="empty">No candidates found.</div>}
      </div>

      <div className="card mt">
        <h3>CSV import</h3>
        <p className="muted">
          Columns: <code>full_name, branch, application_id, panel</code>. Panel by name or ID.
          Duplicate application IDs are skipped; errors are reported per row.
        </p>
        <textarea
          value={csvText}
          onChange={(e) => setCsvText(e.target.value)}
          placeholder={'full_name,branch,application_id,panel\nAda Lovelace,CSE,APP-001,Panel A'}
          style={{ minHeight: 120 }}
        />
        <div className="btn-row mt">
          <button className="btn" onClick={() => void doImport()} disabled={!csvText.trim()}>
            Import
          </button>
        </div>
        {importResult ? (
          <pre className="mono mt" style={{ whiteSpace: 'pre-wrap', fontSize: '0.82rem' }}>
            {JSON.stringify(importResult, null, 2)}
          </pre>
        ) : null}
      </div>

      <ConfirmDialog
        open={!!confirmArchive}
        danger
        title="Archive candidate?"
        message={`${confirmArchive?.full_name ?? 'This candidate'} will be hidden from judges' lists. Existing evaluations are kept.`}
        confirmLabel="Archive"
        onCancel={() => setConfirmArchive(null)}
        onConfirm={() => confirmArchive && void doArchive(confirmArchive, true)}
      />
    </>
  );
}
