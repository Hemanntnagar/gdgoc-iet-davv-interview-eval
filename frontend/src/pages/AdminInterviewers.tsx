import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ConfirmDialog } from '../components/Ui';
import type { Interviewer, ProvisionCredentials, Vertical, Panel } from '../lib/types';

/**
 * Vertical-wise interviewer account provisioning. Login IDs follow the panel
 * convention (Panel 1.1, Panel 1.2 …); generated passwords are shown once.
 */
export function AdminInterviewers() {
  const { getToken, panels } = useAuth();
  const [interviewers, setInterviewers] = useState<Interviewer[]>([]);
  const [verticals, setVerticals] = useState<Vertical[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showCredentials, setShowCredentials] = useState<ProvisionCredentials[] | null>(null);
  const [confirmReset, setConfirmReset] = useState<Interviewer | null>(null);
  const [busy, setBusy] = useState(false);

  const [form, setForm] = useState({
    login_id: '',
    display_name: '',
    vertical_ids: [] as string[],
    panel_ids: [] as string[],
    email: '',
    domain: '',
  });
  const [bulk, setBulk] = useState({ vertical_id: '', count: 10, name_prefix: 'Panel', domain: '' });

  const load = useCallback(async () => {
    const token = await getToken();
    if (!token) return;
    try {
      const [i, v] = await Promise.all([
        api<{ interviewers: Interviewer[] }>('/admin/interviewers', { token }),
        api<{ verticals: Vertical[] }>('/verticals', { token }),
      ]);
      setInterviewers(i.interviewers);
      setVerticals(v.verticals);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load interviewers');
    }
  }, [getToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const provision = async () => {
    setBusy(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) return;
      const res = await api<{ credentials: ProvisionCredentials }>('/admin/interviewers', {
        method: 'POST',
        token,
        body: JSON.stringify({
          ...form,
          email: form.email.trim() || undefined,
          domain: form.domain.trim() || undefined,
          vertical_ids: form.vertical_ids,
          panel_ids: form.panel_ids,
        }),
      });
      setShowCredentials([res.credentials]);
      setNotice(`Provisioned ${res.credentials.login_id}.`);
      setForm({ login_id: '', display_name: '', vertical_ids: [], panel_ids: [], email: '', domain: '' });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Provisioning failed');
    } finally {
      setBusy(false);
    }
  };

  const bulkProvision = async () => {
    setBusy(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) return;
      const res = await api<{ created: unknown[]; credentials: ProvisionCredentials[]; errors: { index: number; reason: string }[] }>(
        '/admin/interviewers/bulk',
        {
          method: 'POST',
          token,
          body: JSON.stringify({ ...bulk, domain: bulk.domain.trim() || undefined }),
        },
      );
      if (res.credentials.length > 0) setShowCredentials(res.credentials);
      setNotice(
        `Created ${res.created.length} account(s)` +
          (res.errors.length ? `, ${res.errors.length} failed: ${res.errors.map((e) => e.reason).join('; ')}` : '') +
          '.',
      );
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Bulk provisioning failed');
    } finally {
      setBusy(false);
    }
  };

  const resetPassword = async (target: Interviewer) => {
    try {
      const token = await getToken();
      if (!token) return;
      const res = await api<{ credentials: ProvisionCredentials }>(
        `/admin/interviewers/${target.id}/reset-password`,
        { method: 'POST', token },
      );
      setShowCredentials([res.credentials]);
      setConfirmReset(null);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Password reset failed');
    }
  };

  const toggleActive = async (target: Interviewer) => {
    try {
      const token = await getToken();
      if (!token) return;
      await api(`/admin/interviewers/${target.id}`, {
        method: 'PATCH',
        token,
        body: JSON.stringify({ is_active: !target.is_active }),
      });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Update failed');
    }
  };

  const verticalName = (id: string) => verticals.find((v) => v.id === id)?.name ?? id;
  const panelName = (id: string) => panels.find((p) => p.id === id)?.name ?? id;

  return (
    <>
      <h1>Interviewers</h1>
      <p className="muted">
        Accounts are provisioned per vertical with panel-style login IDs (Panel 1.1, 1.2 …). The
        generated password is displayed once and never stored — share it over a secure channel.
      </p>
      {error && <div className="alert error">{error}</div>}
      {notice && <div className="alert success">{notice}</div>}

      <div className="grid cols-2 mt">
        <div className="card">
          <h3>Provision one account</h3>
          <label className="field">
            <span>Login ID</span>
            <input
              value={form.login_id}
              onChange={(e) => setForm({ ...form, login_id: e.target.value })}
              placeholder="Panel 1.1"
            />
          </label>
          <label className="field">
            <span>Display name</span>
            <input
              value={form.display_name}
              onChange={(e) => setForm({ ...form, display_name: e.target.value })}
              placeholder="Content Panel 1.1"
            />
          </label>
          <label className="field">
            <span>Full email (optional — any domain)</span>
            <input
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="panel1.1@example.com"
            />
          </label>
          <label className="field">
            <span>Domain (optional — used with Login ID; any domain)</span>
            <input
              value={form.domain}
              onChange={(e) => setForm({ ...form, domain: e.target.value })}
              placeholder="example.com"
            />
          </label>
          <label className="field">
            <span>Verticals</span>
            <select
              multiple
              value={form.vertical_ids}
              onChange={(e) =>
                setForm({
                  ...form,
                  vertical_ids: Array.from(e.target.selectedOptions).map((o) => o.value),
                })
              }
              size={Math.min(verticals.length, 5)}
            >
              {verticals.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Panels (optional)</span>
            <select
              multiple
              value={form.panel_ids}
              onChange={(e) =>
                setForm({ ...form, panel_ids: Array.from(e.target.selectedOptions).map((o) => o.value) })
              }
              size={Math.min(panels.length, 4)}
            >
              {panels.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <button
            className="btn"
            disabled={busy || !form.login_id.trim() || !form.display_name.trim() || form.vertical_ids.length === 0}
            onClick={() => void provision()}
          >
            {busy ? 'Provisioning…' : 'Provision account'}
          </button>
        </div>

        <div className="card">
          <h3>Bulk provision for a vertical</h3>
          <p className="muted">
            Creates one account per active panel of the vertical (falling back to sequential names),
            each with a one-time password.
          </p>
          <label className="field">
            <span>Vertical</span>
            <select value={bulk.vertical_id} onChange={(e) => setBulk({ ...bulk, vertical_id: e.target.value })}>
              <option value="">Choose a vertical…</option>
              {verticals.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Number of accounts</span>
            <input
              type="number"
              min={1}
              max={50}
              value={bulk.count}
              onChange={(e) => setBulk({ ...bulk, count: Number(e.target.value) })}
            />
          </label>
          <label className="field">
            <span>Domain (optional — any domain)</span>
            <input
              value={bulk.domain}
              onChange={(e) => setBulk({ ...bulk, domain: e.target.value })}
              placeholder="example.com"
            />
          </label>
          <button className="btn" disabled={busy || !bulk.vertical_id} onClick={() => void bulkProvision()}>
            {busy ? 'Creating…' : `Create ${bulk.count} account(s)`}
          </button>
        </div>
      </div>

      <div className="table-wrap card mt" style={{ padding: 0 }}>
        <table className="data">
          <thead>
            <tr>
              <th>Login ID</th>
              <th>Display name</th>
              <th>Verticals</th>
              <th>Panels</th>
              <th>Status</th>
              <th>Last reset</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {interviewers.map((it) => (
              <tr key={it.id}>
                <td className="mono">{it.login_id || '—'}</td>
                <td>{it.display_name}</td>
                <td>{it.vertical_ids.map(verticalName).join(', ') || '—'}</td>
                <td>{it.panel_ids.map(panelName).join(', ') || '—'}</td>
                <td>
                  <span className={`badge ${it.is_active ? 'ok' : 'err'}`}>
                    {it.is_active ? 'active' : 'disabled'}
                  </span>
                </td>
                <td className="muted">{it.password_reset_at ? new Date(it.password_reset_at).toLocaleDateString() : '—'}</td>
                <td>
                  <div className="btn-row">
                    <button className="btn secondary small" onClick={() => setConfirmReset(it)}>
                      Reset password
                    </button>
                    <button className="btn secondary small" onClick={() => void toggleActive(it)}>
                      {it.is_active ? 'Disable' : 'Enable'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {interviewers.length === 0 && (
              <tr>
                <td colSpan={7} className="muted" style={{ padding: '1rem' }}>
                  No interviewer accounts provisioned yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showCredentials && showCredentials.length > 0 && (
        <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-label="One-time credentials">
          <div className="dialog" style={{ maxWidth: 520 }}>
            <h3>One-time credentials</h3>
            <p>
              Copy these now — passwords are never displayed again. Store them somewhere safe and
              share them with the interviewer over a secure channel.
            </p>
            <table className="data">
              <thead>
                <tr>
                  <th>Login ID</th>
                  <th>Email</th>
                  <th>Password</th>
                </tr>
              </thead>
              <tbody>
                {showCredentials.map((c) => (
                  <tr key={c.email}>
                    <td className="mono">{c.login_id}</td>
                    <td className="mono">{c.email}</td>
                    <td className="mono" style={{ userSelect: 'all' }}>
                      {c.password}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="btn-row" style={{ justifyContent: 'flex-end', marginTop: '0.75rem' }}>
              <button className="btn" onClick={() => setShowCredentials(null)}>
                I have copied them
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!confirmReset}
        danger
        title="Reset password?"
        message={`A new one-time password will be issued for ${confirmReset?.display_name ?? ''} (${
          confirmReset?.login_id ?? ''
        }). The old password stops working immediately.`}
        confirmLabel="Reset"
        onCancel={() => setConfirmReset(null)}
        onConfirm={() => confirmReset && void resetPassword(confirmReset)}
      />
    </>
  );
}
