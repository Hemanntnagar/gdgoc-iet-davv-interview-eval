import 'dotenv/config';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { makeSupabaseTokenVerifier } from './lib/supabaseAuth.js';
import { SupabaseStore } from './store/supabase.js';

const config = loadConfig();
const store = new SupabaseStore(config.supabaseUrl, config.serviceRoleKey);
const app = createApp({ store, verifyToken: makeSupabaseTokenVerifier(config.supabaseUrl), config });

app.listen(config.port, () => {
  console.log(`GDGOC backend listening on http://localhost:${config.port}`);
});
