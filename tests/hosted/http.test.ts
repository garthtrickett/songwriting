import {expect,test} from 'bun:test';
import {session,sameOrigin,authProxy} from '../../server/agent/auth.ts';
const config={baseUrl:'https://auth.example.invalid',cookieSecret:'test-only-cookie-secret-with-over-32-characters',allowedEmails:['owner@example.invalid'],allowedIds:[]};
test('cross-site mutations are rejected before contacting auth',async()=>{
  const request=new Request('https://app.example/api/agent',{method:'POST',headers:{origin:'https://other.example'}});
  expect(()=>sameOrigin(request)).toThrow('this app');
  await expect(authProxy(new Request('https://app.example/api/auth/sign-out',{method:'POST'}),config)).rejects.toThrow('this app');
});
test('valid-looking client identities never authenticate without a session',async()=>{
  const request=new Request('https://app.example/api/agent',{headers:{'x-owner-id':'owner','authorization':'Bearer fake'}});
  const auth=await session(request,config);
  expect(auth.user).toBeNull();expect(auth.allowed).toBe(false);
});
test('Neon administration routes are not exposed',async()=>{
  await expect(authProxy(new Request('https://app.example/api/auth/admin/list-users'),config)).rejects.toThrow('Unknown');
});
