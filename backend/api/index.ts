// Vercel Functions entry point. vercel.json routes /api/* to this file.
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { makeSupabaseTokenVerifier } from '../src/lib/supabaseAuth.js';
import { SupabaseStore } from '../src/store/supabase.js';

const config = loadConfig();
const store = new SupabaseStore(config.supabaseUrl, config.serviceRoleKey);

export default createApp({
  store,
  verifyToken: makeSupabaseTokenVerifier(config.supabaseUrl),
  config,
});
