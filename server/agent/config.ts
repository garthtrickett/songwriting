import type { AuthConfig } from './auth.ts';
export function settings(env: Record<string, string | undefined> = process.env) {
  function required(name: string) {
    const value = env[name];
    if (!value) throw new Error(`Configure ${name} before enabling the hosted agent.`);
    return value;
  }
  const csv = (name: string) => (env[name] ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const auth: AuthConfig = { baseUrl: required('NEON_AUTH_BASE_URL'), cookieSecret: required('NEON_AUTH_COOKIE_SECRET'),
    allowedEmails: csv('AGENT_ALLOWED_EMAILS'), allowedIds: (env.AGENT_ALLOWED_IDS ?? '').split(',').filter(Boolean) };
  if (!auth.baseUrl.startsWith('https://') || auth.cookieSecret.length < 32) throw new Error('Invalid hosted authentication configuration.');
  return { auth, databaseUrl: required('DATABASE_URL'), model: env.AGENT_MODEL ?? 'google/gemini-2.5-flash', enabled: env.AGENT_ENABLED === 'true' };
}
