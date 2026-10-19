import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './api';
import { OFFLINE_SESSION_HOURS, SUPABASE_ANON_KEY, SUPABASE_URL } from './config';
import {
  getOfflineSession,
  saveOfflineSession,
  wipeLocalData,
  type OfflineSession,
} from './idb';
import { createClient } from '@supabase/supabase-js';
import type { Panel, Profile } from './types';

interface MeResponse {
  profile: Profile;
  panels: Panel[];
  is_admin: boolean;
}

interface AuthState {
  status: 'loading' | 'online' | 'offline' | 'signed_out';
  session: Session | null;
  profile: Profile | null;
  panels: Panel[];
  offlineSession: OfflineSession | null;
  signIn: (email: string, password: string) => Promise<void>;
  register: (
    fullName: string,
    email: string,
    password: string,
    adminCode?: string,
  ) => Promise<string | null>;
  signOut: () => Promise<void>;
  getToken: () => Promise<string | null>;
  refreshMe: () => Promise<void>;
  /** True when we only have a local offline session (not fresh server auth). */
  isOfflineSession: boolean;
}

const PENDING_ADMIN_CODE_KEY = 'gdgoc-pending-admin-code';

/** Promotes the signed-in account to admin using the secret code. */
async function claimAdmin(token: string, code: string): Promise<void> {
  await api('/admin/claim', { token, method: 'POST', body: JSON.stringify({ code }) });
}

const AuthContext = createContext<AuthState | null>(null);

let sb: SupabaseClient | null = null;
export function supabase(): SupabaseClient {
  if (!sb) {
    sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'gdgoc-auth' },
    });
  }
  return sb;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthState['status']>('loading');
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [panels, setPanels] = useState<Panel[]>([]);
  const [offlineSession, setOfflineSession] = useState<OfflineSession | null>(null);

  const loadMe = useCallback(async (token: string) => {
    const me = await api<MeResponse>('/me', { token });
    setProfile(me.profile);
    setPanels(me.panels);
    await saveOfflineSession({
      user_id: me.profile.id,
      email: me.profile.email,
      full_name: me.profile.full_name,
      role: me.profile.role,
      panel_ids: me.panels.map((p) => p.id),
      expires_at: new Date(Date.now() + OFFLINE_SESSION_HOURS * 3_600_000).toISOString(),
    });
  }, []);

  const bootstrap = useCallback(async () => {
    const sbClient = supabase();
    const { data } = await sbClient.auth.getSession();
    const s = data.session;
    setSession(s);
    if (s) {
      try {
        await loadMe(s.access_token);
        setStatus('online');
        setOfflineSession(await getOfflineSession());
        return;
      } catch {
        // Token valid but backend unreachable — fall back to offline session.
        const off = await getOfflineSession();
        if (off) {
          setOfflineSession(off);
          setProfile({
            id: off.user_id,
            email: off.email,
            full_name: off.full_name,
            role: off.role,
          });
          setStatus('offline');
          return;
        }
      }
    }
    const off = await getOfflineSession();
    if (off) {
      setOfflineSession(off);
      setProfile({
        id: off.user_id,
        email: off.email,
        full_name: off.full_name,
        role: off.role,
      });
      setStatus('offline');
      return;
    }
    setStatus('signed_out');
  }, [loadMe]);

  useEffect(() => {
    void bootstrap();
    const { data: sub } = supabase().auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, [bootstrap]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const { error } = await supabase().auth.signInWithPassword({ email, password });
      if (error) throw new Error(error.message);
      const { data } = await supabase().auth.getSession();
      setSession(data.session);
      if (!data.session) throw new Error('Sign-in did not produce a session');
      await loadMe(data.session.access_token);
      setOfflineSession(await getOfflineSession());
      setStatus('online');
      // A secret admin code entered during registration (before email
      // confirmation) is retried here, once the account can authenticate.
      const pending = localStorage.getItem(PENDING_ADMIN_CODE_KEY);
      if (pending) {
        localStorage.removeItem(PENDING_ADMIN_CODE_KEY);
        try {
          await claimAdmin(data.session.access_token, pending);
          await loadMe(data.session.access_token);
        } catch {
          /* wrong code — the account stays a judge */
        }
      }
    },
    [loadMe],
  );

  const register = useCallback(
    async (fullName: string, email: string, password: string, adminCode?: string) => {
      const { data, error } = await supabase().auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName } },
      });
      if (error) throw new Error(error.message);
      if (data.user && !data.session) {
        if (adminCode) localStorage.setItem(PENDING_ADMIN_CODE_KEY, adminCode);
        return 'Account created. Check your email to confirm, then sign in.';
      }
      if (adminCode && data.session) {
        // A wrong code is silently ignored — never reveal that the field
        // exists or that it grants anything.
        await claimAdmin(data.session.access_token, adminCode).catch(() => {});
      }
      return null;
    },
    [],
  );

  const signOut = useCallback(async () => {
    try {
      await supabase().auth.signOut({ scope: 'local' });
    } catch {
      /* offline — local wipe still proceeds */
    }
    await wipeLocalData();
    setSession(null);
    setProfile(null);
    setPanels([]);
    setOfflineSession(null);
    setStatus('signed_out');
  }, []);

  const getToken = useCallback(async () => {
    const { data } = await supabase().auth.getSession();
    return data.session?.access_token ?? null;
  }, []);

  const refreshMe = useCallback(async () => {
    const token = await getToken();
    if (!token) throw new Error('Not signed in');
    await loadMe(token);
    setStatus('online');
  }, [getToken, loadMe]);

  const value = useMemo<AuthState>(
    () => ({
      status,
      session,
      profile,
      panels,
      offlineSession,
      signIn,
      register,
      signOut,
      getToken,
      refreshMe,
      isOfflineSession: status === 'offline',
    }),
    [status, session, profile, panels, offlineSession, signIn, register, signOut, getToken, refreshMe],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
