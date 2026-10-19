import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { AuthShell } from '../components/Ui';
import type { Panel } from '../lib/types';

export function PanelVerify() {
  const { getToken, refreshMe } = useAuth();
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error('Session expired — sign in again');
      const res = await api<{ status: string; panel: Panel }>('/panels/verify', {
        method: 'POST',
        token,
        body: JSON.stringify({ code: code.trim().toUpperCase() }),
      });
      await refreshMe();
      void res;
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      compact
      title="Verify panel"
      subtitle="Enter the verification code provided by the administrators for your interview panel."
    >
      {error && <div className="alert error">{error}</div>}
      <form onSubmit={submit}>
        <label className="field">
          <span>Panel code</span>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            required
            minLength={4}
            maxLength={32}
            autoCapitalize="characters"
            autoComplete="off"
            style={{ textTransform: 'uppercase', letterSpacing: '0.1em' }}
          />
        </label>
        <button className="btn" disabled={busy} style={{ width: '100%' }}>
          {busy ? 'Verifying…' : 'Verify panel'}
        </button>
      </form>
    </AuthShell>
  );
}
