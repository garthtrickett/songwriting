import { authProxy, HttpError } from '../server/agent/auth.ts';
import { settings } from '../server/agent/config.ts';
async function handler(request: Request) {
  try { return await authProxy(request, settings().auth); }
  catch (error) { return Response.json({ error: error instanceof HttpError ? error.message : 'Sign-in is temporarily unavailable.' },
    { status: error instanceof HttpError ? error.status : 503, headers: { 'cache-control': 'no-store' } }); }
}
export { handler as GET, handler as POST };
