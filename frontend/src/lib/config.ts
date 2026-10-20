export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
export const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';
export const OFFLINE_SESSION_HOURS = Number(import.meta.env.VITE_OFFLINE_SESSION_HOURS ?? 12);
export const DEMO_MODE =
  import.meta.env.VITE_DEMO_MODE === 'true' || import.meta.env.VITE_DEMO_MODE === '1';

if (!DEMO_MODE && (!SUPABASE_URL || !SUPABASE_ANON_KEY)) {
  console.warn('Supabase environment variables are not configured.');
}
