import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { getLastSyncAt } from '../lib/sync';
import { useSync } from '../lib/syncContext';
import { useEffect, useState } from 'react';
import { getMeta } from '../lib/idb';

export function Dashboard() {
  const { profile, panels, status, isOfflineSession } = useAuth();
  const { pending, conflicts, errors, synced, lastReport, syncNow, running } = useSync();
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [prepared, setPrepared] = useState(false);
  const isAdmin = profile?.role === 'admin';

  useEffect(() => {
    void getLastSyncAt().then(setLastSyncAt);
    void getMeta<boolean>('offline_prepared').then((v) => setPrepared(!!v));
  }, [pending, synced]);

  return (
    <>
      <h1>Welcome, {profile?.full_name?.split(' ')[0] || 'there'}</h1>
      {isOfflineSession && (
        <div className="alert warn">
          You are using a locally stored offline session, not a fresh server sign-in. Synchronization
          will require signing in again once you are online.
        </div>
      )}
      {status === 'online' && lastReport && (
        <div className={`alert ${lastReport.errors || lastReport.conflicts ? 'warn' : 'success'}`}>
          {lastReport.message}
        </div>
      )}

      <div className="grid cols-4 mt">
        <div className="card stat">
          <div className="value">{panels.length}</div>
          <div className="label">Panel{panels.length === 1 ? '' : 's'} assigned</div>
        </div>
        {!isAdmin && (
          <>
            <div className="card stat">
              <div className="value">{pending + errors}</div>
              <div className="label">Evaluations waiting to sync</div>
            </div>
            <div className="card stat">
              <div className="value">{synced}</div>
              <div className="label">Synchronized locally</div>
            </div>
            <div className="card stat">
              <div className="value">{conflicts}</div>
              <div className="label">Conflicts to resolve</div>
            </div>
          </>
        )}
        {isAdmin && (
          <div className="card stat">
            <div className="value">Admin</div>
            <div className="label">Full management access</div>
          </div>
        )}
      </div>

      {isAdmin ? (
        <div className="grid cols-2 mt">
          <div className="card">
            <h3>Manage</h3>
            <p><Link to="/admin/results">Results &amp; export</Link></p>
            <p><Link to="/admin/candidates">Candidates &amp; CSV import</Link></p>
            <p><Link to="/admin/panels">Panels, codes &amp; judges</Link></p>
            <p><Link to="/admin/judges">Accounts &amp; roles</Link></p>
            <p><Link to="/admin/rounds">Rounds &amp; criteria</Link></p>
          </div>
        </div>
      ) : (
        <div className="grid cols-2 mt">
          <div className="card">
            <h3>Interviews</h3>
            {panels.length === 0 ? (
              <p className="muted">
                You have no verified panel yet. <Link to="/verify">Verify your panel code</Link> to
                get started.
              </p>
            ) : (
              <>
                <p>
                  <Link to="/candidates">Open candidate list →</Link>
                </p>
                <p>
                  <Link to="/my-evaluations">My evaluation history →</Link>
                </p>
              </>
            )}
          </div>
          <div className="card">
            <h3>Offline readiness</h3>
            <p>
              {prepared ? (
                <span className="badge ok">Prepared for offline interviews</span>
              ) : (
                <span className="badge warn">Not prepared yet</span>
              )}
            </p>
            <p className="muted">
              {lastSyncAt ? `Last successful sync: ${new Date(lastSyncAt).toLocaleString()}` : 'Never synchronized on this device.'}
            </p>
            <div className="btn-row">
              <Link className="btn secondary" to="/offline">
                Prepare / re-check
              </Link>
              <button className="btn secondary" onClick={() => void syncNow()} disabled={running || status !== 'online'}>
                {running ? 'Syncing…' : 'Sync now'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
