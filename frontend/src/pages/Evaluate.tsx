import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  getOutboxItem,
  listCachedCandidates,
  listCachedCriteria,
  listCachedRounds,
  listOutbox,
  putOutboxItem,
  setMeta,
} from '../lib/idb';
import { useOnline } from '../lib/net';
import { useSync } from '../lib/syncContext';
import type { Candidate, Criterion, OutboxItem, Round } from '../lib/types';

export function Evaluate() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { getToken, panels } = useAuth();
  const online = useOnline();
  const { syncNow } = useSync();

  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [rounds, setRounds] = useState<Round[]>([]);
  const [roundId, setRoundId] = useState('');
  const [criteria, setCriteria] = useState<Criterion[]>([]);
  const [scores, setScores] = useState<Record<string, string>>({});
  const [overall, setOverall] = useState('');
  const [feedback, setFeedback] = useState('');
  const [existingLocal, setExistingLocal] = useState<OutboxItem | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err' | 'info' | 'warn'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [savingLocal, setSavingLocal] = useState(false);

  const loadCandidate = useCallback(async () => {
    if (!id) return;
    if (online) {
      try {
        const token = await getToken();
        if (token) {
          const res = await api<{ candidate: Candidate }>(`/candidates/${id}`, { token });
          setCandidate(res.candidate);
          return;
        }
      } catch {
        /* fall back to cache */
      }
    }
    const cached = await listCachedCandidates(panels.map((p) => p.id));
    setCandidate(cached.find((c) => c.id === id) ?? null);
  }, [id, online, getToken, panels]);

  useEffect(() => {
    void loadCandidate();
  }, [loadCandidate]);

  useEffect(() => {
    void (async () => {
      let rs: Round[] = [];
      if (online) {
        try {
          const token = await getToken();
          if (token) {
            const res = await api<{ rounds: Round[] }>('/rounds', { token });
            rs = res.rounds;
          }
        } catch {
          /* cache */
        }
      }
      if (rs.length === 0) rs = await listCachedRounds();
      const open = rs.filter((r) => r.is_open);
      setRounds(open);
      if (open.length > 0 && !roundId) setRoundId(open[0].id);
    })();
  }, [online, getToken, roundId]);

  useEffect(() => {
    void (async () => {
      if (!roundId) {
        setCriteria([]);
        return;
      }
      let cs: Criterion[] = [];
      if (online) {
        try {
          const token = await getToken();
          if (token) {
            const res = await api<{ criteria: Criterion[] }>(`/rounds/${roundId}/criteria`, { token });
            cs = res.criteria.filter((c) => c.is_active);
          }
        } catch {
          /* cache */
        }
      }
      if (cs.length === 0) cs = (await listCachedCriteria(roundId)).filter((c) => c.is_active);
      setCriteria(cs);
    })();
  }, [roundId, online, getToken]);

  // Existing unsynced local evaluation for this candidate+round
  useEffect(() => {
    void (async () => {
      const list = await listOutbox();
      const match = list.find(
        (o) => o.candidate_id === id && o.round_id === roundId && o.status !== 'synced',
      );
      setExistingLocal(match ?? null);
      if (match) {
        setFeedback(match.feedback);
        if (match.overall_score !== null) setOverall(String(match.overall_score));
        const s: Record<string, string> = {};
        for (const [k, v] of Object.entries(match.scores)) s[k] = String(v);
        setScores(s);
      } else {
        setFeedback('');
        setOverall('');
        setScores({});
      }
    })();
  }, [id, roundId]);

  const validate = (): string | null => {
    if (!roundId) return 'Select an interview round';
    if (criteria.length > 0) {
      for (const c of criteria) {
        const raw = scores[c.id];
        const n = Number(raw);
        if (raw === undefined || raw === '' || Number.isNaN(n)) return `Score required: ${c.name}`;
        if (n < c.min_score || n > c.max_score) {
          return `${c.name} must be between ${c.min_score} and ${c.max_score}`;
        }
      }
    } else {
      const n = Number(overall);
      if (!overall || Number.isNaN(n) || n < 1 || n > 10) return 'Overall score between 1 and 10 is required';
    }
    return null;
  };

  const buildPayload = (itemId: string): OutboxItem => {
    const round = rounds.find((r) => r.id === roundId);
    const sc: Record<string, number> = {};
    for (const c of criteria) sc[c.id] = Number(scores[c.id]);
    const numericScores = Object.values(sc);
    const computedOverall =
      criteria.length > 0
        ? Math.round((numericScores.reduce((a, b) => a + b, 0) / numericScores.length) * 100) / 100
        : Number(overall);
    return {
      id: itemId,
      candidate_id: id!,
      candidate_name: candidate?.full_name ?? '',
      round_id: roundId,
      round_name: round?.name ?? '',
      panel_id: candidate?.panel_id ?? '',
      feedback: feedback.trim(),
      overall_score: computedOverall,
      scores: sc,
      client_created_at: new Date().toISOString(),
      status: 'pending',
      attempts: existingLocal?.attempts ?? 0,
    };
  };

  const saveLocally = async (itemId: string) => {
    setSavingLocal(true);
    try {
      const item = buildPayload(itemId);
      await putOutboxItem(item);
      await setMeta('last_local_save_at', new Date().toISOString());
      setExistingLocal(item);
      setMessage({ kind: 'ok', text: 'Saved on this device. It will upload when connected.' });
    } finally {
      setSavingLocal(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const problem = validate();
    if (problem) {
      setMessage({ kind: 'err', text: problem });
      return;
    }
    setBusy(true);
    setMessage(null);
    const itemId = existingLocal?.id ?? crypto.randomUUID();
    try {
      if (!online) {
        await saveLocally(itemId);
        return;
      }
      const token = await getToken();
      if (!token) {
        // No fresh auth — persist locally rather than losing the evaluation.
        await saveLocally(itemId);
        setMessage({ kind: 'warn', text: 'Session expired — evaluation saved locally. Sign in again to sync.' });
        return;
      }
      const payload = buildPayload(itemId);
      try {
        const res = await api<{ status: string; evaluation: { id: string } }>('/evaluations', {
          method: 'POST',
          token,
          body: JSON.stringify({
            id: payload.id,
            candidate_id: payload.candidate_id,
            round_id: payload.round_id,
            feedback: payload.feedback,
            overall_score: criteria.length === 0 ? payload.overall_score : null,
            scores: payload.scores,
            client_created_at: payload.client_created_at,
            replace_existing: rounds.find((r) => r.id === roundId)?.allow_edit_after_submit ?? false,
          }),
        });
        if (res.status === 'ok') {
          setMessage({ kind: 'ok', text: 'Evaluation submitted and saved on the server.' });
          if (existingLocal) {
            await putOutboxItem({ ...payload, status: 'synced' });
            setExistingLocal(null);
          }
          void syncNow();
          setTimeout(() => navigate('/candidates'), 900);
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          setMessage({
            kind: 'err',
            text: `${err.message} Your local edits (if any) remain on this device.`,
          });
          await saveLocally(itemId);
          return;
        }
        // Any other network/server failure: keep the evaluation locally.
        await saveLocally(itemId);
        if (err instanceof ApiError && err.details) {
          const details = err.details as Record<string, string>;
          setMessage({
            kind: 'err',
            text: `Saved locally. Server rejected the scores: ${Object.values(details).join('; ')}`,
          });
        } else {
          setMessage({
            kind: 'warn',
            text: `Could not reach the server (${err instanceof Error ? err.message : 'error'}). Evaluation saved locally.`,
          });
        }
      }
    } finally {
      setBusy(false);
    }
  };

  if (!candidate) {
    return (
      <div className="empty">
        <span className="spinner" /> Loading candidate…
      </div>
    );
  }

  return (
    <>
      <div className="btn-row mb">
        <Link className="btn secondary small" to="/candidates">
          ← Back
        </Link>
      </div>
      <h1>{candidate.full_name}</h1>
      <p className="muted">
        {candidate.branch}
        {candidate.application_id ? ` · ${candidate.application_id}` : ''} ·{' '}
        <span className="badge neutral">{candidate.interview_status.replace('_', ' ')}</span>
      </p>

      {message && (
        <div
          className={`alert ${
            message.kind === 'ok' ? 'success' : message.kind === 'warn' ? 'warn' : message.kind === 'info' ? 'info' : 'error'
          }`}
        >
          {message.text}
        </div>
      )}

      <form className="card" onSubmit={submit}>
        <label className="field">
          <span>Interview round</span>
          <select value={roundId} onChange={(e) => setRoundId(e.target.value)} required>
            {rounds.length === 0 && <option value="">No open rounds</option>}
            {rounds.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
                {r.allow_edit_after_submit ? ' (edits allowed)' : ''}
              </option>
            ))}
          </select>
        </label>

        {criteria.length > 0 ? (
          <div>
            <h3>Rubric</h3>
            {criteria.map((c) => (
              <div className="score-row" key={c.id}>
                <div>
                  <strong>{c.name}</strong>
                  {c.description && <div className="muted">{c.description}</div>}
                  <div className="muted">
                    {c.min_score}–{c.max_score}
                    {Number(c.weight) !== 1 ? ` · weight ${c.weight}` : ''}
                  </div>
                </div>
                <input
                  type="number"
                  min={c.min_score}
                  max={c.max_score}
                  step="any"
                  value={scores[c.id] ?? ''}
                  onChange={(e) => setScores((s) => ({ ...s, [c.id]: e.target.value }))}
                  required
                />
              </div>
            ))}
          </div>
        ) : (
          <label className="field">
            <span>Overall score (1–10)</span>
            <input
              type="number"
              min={1}
              max={10}
              step="any"
              value={overall}
              onChange={(e) => setOverall(e.target.value)}
              required
            />
          </label>
        )}

        <label className="field mt">
          <span>Written feedback (optional)</span>
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            maxLength={5000}
            placeholder="Strengths, concerns, recommendation…"
          />
        </label>

        <div className="btn-row">
          <button className="btn" disabled={busy || savingLocal || rounds.length === 0}>
            {busy ? 'Submitting…' : online ? 'Submit evaluation' : 'Save evaluation (offline)'}
          </button>
          {online && (
            <button
              type="button"
              className="btn secondary"
              disabled={savingLocal || busy}
              onClick={() => void saveLocally(existingLocal?.id ?? crypto.randomUUID())}
            >
              {savingLocal ? 'Saving…' : 'Save to device only'}
            </button>
          )}
          {existingLocal && (
            <span className="badge warn">
              Unsynced copy on this device ({existingLocal.status})
            </span>
          )}
        </div>
      </form>
    </>
  );
}
