import { handleAuthProxyRequest } from '@neondatabase/auth/server';
import { z } from 'zod';

export class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
export interface AuthConfig { baseUrl: string; cookieSecret: string; allowedEmails: string[]; allowedIds: string[] }
export function sameOrigin(request: Request) {
  if (request.method !== 'GET' && request.headers.get('origin') !== new URL(request.url).origin)
    throw new HttpError(403, 'Request must come from this app.');
}
const userSchema = z.object({ id: z.string().min(1), email: z.email(), emailVerified: z.boolean() });
const sessionSchema = z.object({ user: userSchema, session: z.object({ userId: z.string(), expiresAt: z.string() }) });
export async function session(request: Request, config: AuthConfig) {
  if (!request.headers.get('cookie')?.includes('__Secure-neon-auth.')) return { user: null, allowed: false, cookies: [] as string[] };
  const headers = new Headers(request.headers);
  headers.delete('content-type'); headers.delete('content-length');
  const response = await handleAuthProxyRequest({
    request: new Request(new URL('/api/auth/get-session', request.url), { headers }), path: 'get-session',
    baseUrl: config.baseUrl, cookieSecret: config.cookieSecret, sessionDataTtl: 0, sameSite: 'strict',
  });
  const parsed = sessionSchema.safeParse(await response.json());
  const cookies = response.headers.getSetCookie();
  if (!response.ok || !parsed.success) return { user: null, allowed: false, cookies };
  const { user, session: s } = parsed.data;
  if (s.userId !== user.id || !(Date.parse(s.expiresAt) > Date.now())) return { user: null, allowed: false, cookies };
  const allowed = config.allowedIds.includes(user.id) ||
    (user.emailVerified && config.allowedEmails.includes(user.email.toLowerCase()));
  return { user, allowed, cookies };
}
// Expose only the sign-in operations used by this app, never generic admin APIs.
const routes = new Set(['get-session', 'sign-in/email', 'sign-up/email', 'sign-out',
  'send-verification-email', 'verify-email', 'request-password-reset', 'reset-password']);
export async function authProxy(request: Request, config: AuthConfig) {
  sameOrigin(request);
  const url=new URL(request.url);
  const path = url.searchParams.get('path') ?? url.pathname.replace(/^\/api\/auth\//, '');
  if (!routes.has(path)) throw new HttpError(404, 'Unknown sign-in operation.');
  if (request.method === 'POST') {
    const text = await request.text();
    if (text.length > 16000) throw new HttpError(413, 'Sign-in request too large.');
    request = new Request(request.url, { method: 'POST', headers: request.headers, body: text });
  }
  const response = await handleAuthProxyRequest({ request, path, baseUrl: config.baseUrl,
    cookieSecret: config.cookieSecret, sessionDataTtl: 0, sameSite: 'strict' });
  response.headers.set('cache-control', 'no-store');
  return response;
}
