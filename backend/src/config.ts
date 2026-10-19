export interface AppConfig {
  supabaseUrl: string;
  serviceRoleKey: string;
  codePepper: string;
  corsOrigin: string | string[];
  verifyLockoutMinutes: number;
  port: number;
  // addendum: workbook + spreadsheet sync + interviewer provisioning
  loginEmailDomain: string;
  googleSheetsCredentials: string | null;
  defaultSpreadsheetId: string;
  interviewersPerVertical: number;
  goTrueAdminTimeoutMs: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const supabaseUrl = env.SUPABASE_URL ?? '';
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  const codePepper = env.CODE_PEPPER ?? '';
  if (!supabaseUrl || !serviceRoleKey || !codePepper) {
    // Only enforced when the Supabase store is actually constructed.
    if (env.NODE_ENV !== 'test') {
      throw new Error(
        'Missing required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CODE_PEPPER',
      );
    }
  }
  return {
    supabaseUrl,
    serviceRoleKey,
    codePepper,
    corsOrigin: env.CORS_ORIGIN?.split(',').map((s) => s.trim()).filter(Boolean) ?? '*',
    verifyLockoutMinutes: Number(env.VERIFY_ATTEMPT_LOCKOUT_MINUTES ?? 10),
    port: Number(env.PORT ?? 4000),
    loginEmailDomain: env.LOGIN_EMAIL_DOMAIN ?? 'gdgoc.iet-davv.club',
    googleSheetsCredentials: env.GOOGLE_SHEETS_CREDENTIALS?.trim() || null,
    defaultSpreadsheetId: env.SPREADSHEET_ID ?? '',
    interviewersPerVertical: Number(env.INTERVIEWERS_PER_VERTICAL ?? 10),
    goTrueAdminTimeoutMs: Number(env.GOTRUE_ADMIN_TIMEOUT_MS ?? 10_000),
  };
}
