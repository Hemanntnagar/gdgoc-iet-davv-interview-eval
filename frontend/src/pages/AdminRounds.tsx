import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { Criterion, Round } from '../lib/types';

export function AdminRounds() {
  const { getToken } = useAuth();
  const [rounds, setRounds] = useState<Round[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [criteria, setCriteria] = useState<Criterion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [newRound, setNewRound] = useState({ name: '', allow_edit_after_submit: false });
  const [newCriterion, setNewCriterion] = useState({
    name: '',
    description: '',
    min_score: 1,
    max_score: 10,
    weight: 1,
  });

  const load = useCallback(async () => {
    const token = await getToken();
    if (!token) return;
    const res = await api<{ rounds: Round[] }>('/rounds', { token });
    setRounds(res.rounds);
    if (!selected && res.rounds.length > 0) setSelected(res.rounds[0].id);
  }, [getToken, selected]);

  useEffect(() => {
    void load().catch((e) => setError(String(e.message ?? e)));
  }, [load]);

  useEffect(() => {
    void (async () => {
      if (!selected) return;
      const token = await getToken();
      if (!token) return;
      const res = await api<{ criteria: Criterion[] }>(`/rounds/${selected}/criteria`, { token });
      setCriteria(res.criteria);
    })();
  }, [selected, getToken, notice]);

  const createRound = async () => {
    const token = await getToken();
    if (!token || !newRound.name.trim()) return;
    try {
      await api('/rounds', {
        method: 'POST',
        token,
        body: JSON.stringify({
          name: newRound.name.trim(),
          is_open: true,
          allow_edit_after_submit: newRound.allow_edit_after_submit,
        }),
      });
      setNewRound({ name: '', allow_edit_after_submit: false });
      setNotice('Round created.');
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to create round');
    }
  };

  const patchRound = async (id: string, patch: Partial<Round>) => {
    const token = await getToken();
    if (!token) return;
    await api(`/rounds/${id}`, { method: 'PATCH', token, body: JSON.stringify(patch) });
    setNotice('Round updated.');
    await load();
  };

  const createCriterion = async () => {
    const token = await getToken();
    if (!token || !selected || !newCriterion.name.trim()) return;
    try {
      await api(`/rounds/${selected}/criteria`, {
        method: 'POST',
        token,
        body: JSON.stringify({ ...newCriterion, sort_order: criteria.length }),
      });
      setNewCriterion({ name: '', description: '', min_score: 1, max_score: 10, weight: 1 });
      setNotice('Criterion added.');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to add criterion');
    }
  };

  const toggleCriterion = async (c: Criterion) => {
    const token = await getToken();
    if (!token) return;
    await api(`/criteria/${c.id}`, {
      method: 'PATCH',
      token,
      body: JSON.stringify({ is_active: !c.is_active }),
    });
  };

  return (
    <>
      <h1>Rounds &amp; criteria</h1>
      <p className="muted">
        Configure the evaluation rubric before interviews. If a round has active criteria, the overall
        score is the weighted mean of criterion scores. If it has none, judges enter a single overall
        score (1–10). Edits after submission are only possible when explicitly enabled per round.
      </p>
      {error && <div className="alert error">{error}</div>}
      {notice && <div className="alert success">{notice}</div>}

      <div className="card">
        <h3>New round</h3>
        <div className="filters">
          <div>
            <label>Round name</label>
            <input
              value={newRound.name}
              onChange={(e) => setNewRound({ ...newRound, name: e.target.value })}
            />
          </div>
          <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={newRound.allow_edit_after_submit}
              onChange={(e) => setNewRound({ ...newRound, allow_edit_after_submit: e.target.checked })}
              style={{ width: 'auto' }}
            />
            Allow judges to edit after submit
          </label>
          <button className="btn" onClick={() => void createRound()} disabled={!newRound.name.trim()}>
            Create round
          </button>
        </div>
      </div>

      <div className="card">
        <h3>Existing rounds</h3>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Name</th>
                <th>Open</th>
                <th>Edits allowed</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rounds.map((r) => (
                <tr key={r.id}>
                  <td>
                    <button
                      className="btn secondary small"
                      onClick={() => setSelected(r.id)}
                      style={selected === r.id ? { borderColor: 'var(--blue)' } : undefined}
                    >
                      {r.name}
                    </button>
                  </td>
                  <td>
                    <button
                      className={`btn small ${r.is_open ? 'secondary' : ''}`}
                      onClick={() => void patchRound(r.id, { is_open: !r.is_open })}
                    >
                      {r.is_open ? 'Open' : 'Closed'}
                    </button>
                  </td>
                  <td>{r.allow_edit_after_submit ? 'Yes' : 'No'}</td>
                  <td className="muted">{r.closes_at ? `closes ${new Date(r.closes_at).toLocaleString()}` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rounds.length === 0 && <div className="empty">No rounds yet.</div>}
        </div>
      </div>

      {selected && (
        <div className="card">
          <h3>Criteria for selected round</h3>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Range</th>
                  <th>Weight</th>
                  <th>Active</th>
                </tr>
              </thead>
              <tbody>
                {criteria.map((c) => (
                  <tr key={c.id} style={!c.is_active ? { opacity: 0.5 } : undefined}>
                    <td>
                      {c.name}
                      {c.description && <div className="muted">{c.description}</div>}
                    </td>
                    <td>
                      {c.min_score}–{c.max_score}
                    </td>
                    <td>{c.weight}</td>
                    <td>
                      <button className="btn secondary small" onClick={() => void toggleCriterion(c)}>
                        {c.is_active ? 'Disable' : 'Enable'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {criteria.length === 0 && (
              <div className="empty">No criteria — judges will submit a single overall score.</div>
            )}
          </div>
          <div className="filters mt">
            <div>
              <label>Criterion name</label>
              <input
                value={newCriterion.name}
                onChange={(e) => setNewCriterion({ ...newCriterion, name: e.target.value })}
              />
            </div>
            <div>
              <label>Min</label>
              <input
                type="number"
                value={newCriterion.min_score}
                onChange={(e) => setNewCriterion({ ...newCriterion, min_score: Number(e.target.value) })}
              />
            </div>
            <div>
              <label>Max</label>
              <input
                type="number"
                value={newCriterion.max_score}
                onChange={(e) => setNewCriterion({ ...newCriterion, max_score: Number(e.target.value) })}
              />
            </div>
            <div>
              <label>Weight</label>
              <input
                type="number"
                step="0.1"
                min="0.1"
                value={newCriterion.weight}
                onChange={(e) => setNewCriterion({ ...newCriterion, weight: Number(e.target.value) })}
              />
            </div>
            <button className="btn" onClick={() => void createCriterion()} disabled={!newCriterion.name.trim()}>
              Add criterion
            </button>
          </div>
        </div>
      )}
    </>
  );
}
