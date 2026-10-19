import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useOnline } from '../lib/net';
import { useSync } from '../lib/syncContext';

export function NetSyncIndicators() {
  const online = useOnline();
  const { pending, conflicts, errors, running } = useSync();
  const queued = pending + errors;
  return (
    <>
      <span className={`badge ${online ? 'ok' : 'warn'}`} title={online ? 'Network interface is up' : 'Device is offline'}>
        {online ? 'Online' : 'Offline'}
      </span>
      {running ? (
        <span className="badge blue">
          <span className="spinner" style={{ width: 10, height: 10, borderWidth: 2 }} /> Syncing
        </span>
      ) : queued > 0 || conflicts > 0 ? (
        <span className={`badge ${conflicts > 0 ? 'err' : 'warn'}`} title={`${queued} waiting, ${conflicts} conflicts`}>
          {queued} to sync{conflicts > 0 ? ` · ${conflicts} conflict${conflicts > 1 ? 's' : ''}` : ''}
        </span>
      ) : (
        <span className="badge ok">Synced</span>
      )}
    </>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  const { profile, signOut, status } = useAuth();
  const { pending, conflicts } = useSync();
  const navigate = useNavigate();
  const isAdmin = profile?.role === 'admin';

  const handleLogout = async () => {
    if (
      (pending > 0 || conflicts > 0) &&
      !window.confirm(
        'You have evaluations that are not synchronized. Logging out on this device will clear local data, including queued evaluations. Continue?',
      )
    ) {
      return;
    }
    await signOut();
    navigate('/login');
  };

  return (
    <div className="layout">
      <header className="topbar">
        <span className="brand">GDGOC IET DAVV</span>
        <nav>
          <NavLink to="/" end>
            Home
          </NavLink>
          {profile && !isAdmin && (
            <>
              <NavLink to="/candidates">Candidates</NavLink>
              <NavLink to="/my-evaluations">My Evaluations</NavLink>
              <NavLink to="/offline">Offline</NavLink>
            </>
          )}
          {isAdmin && (
            <>
              <NavLink to="/admin/results">Results</NavLink>
              <NavLink to="/admin/candidates">Candidates</NavLink>
              <NavLink to="/admin/panels">Panels</NavLink>
              <NavLink to="/admin/judges">Judges</NavLink>
              <NavLink to="/admin/verticals">Verticals</NavLink>
              <NavLink to="/admin/rounds">Rounds</NavLink>
              <NavLink to="/admin/reports">Reports</NavLink>
            </>
          )}
          <NavLink to="/sync">Sync</NavLink>
        </nav>
        <NetSyncIndicators />
        <span className="muted" style={{ fontSize: '0.85rem' }}>
          {profile?.full_name}
          {status === 'offline' ? ' (offline session)' : ''}
        </span>
        <button className="btn secondary small" onClick={handleLogout}>
          Log out
        </button>
      </header>
      <main className="main">{children}</main>
    </div>
  );
}
