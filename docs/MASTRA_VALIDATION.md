# Mastra integration evidence

Status: M1 implementation and protected preview, 2026-09-08. The deployed
authenticated acceptance gate remains open; production has not been changed.

Preview: https://songwriting-agent-preview-garth-tricketts-projects.vercel.app

## Implemented

- Thin Vercel Node API, server-side Neon session verification, verified-email/ID
  invite policy, same-origin mutation checks and owner-scoped Postgres operations.
- Email/password sign-in and registration in the existing agent panel. Ordinary
  local editing remains available without sign-in.
- Mastra/Postgres suspend-and-resume loop, explicit completion, generation-fenced
  commands and separate run/thread identities after interrupted workers.
- IndexedDB song change and outbox receipt in one transaction. Reload, lost
  request/acknowledgement and duplicate result delivery retain exactly one effect.
- Browser Web Locks, account-change fencing, stale revision checks, cancellation,
  late receipt reconciliation, saved submission identity, review and ordinary undo.
- Reserved model budgets with idempotent usage settlement observed directly from
  the provider stream, including when Mastra suspends before its usage callback.
  Unknown usage keeps the conservative reservation. Rate limits wait one minute,
  retry at most twice, then preserve partial work for explicit Resume.
- Persisted guidance snapshot, streamed text, task status, error/retry visibility.
  There is no background song executor: the song must be open in a connected tab.

## Configuration

- Vercel project `songwriting`, team `garth-tricketts-projects`.
- Neon resource `songwriting-agent`, Free plan `free_v3`, region `iad1`.
  Connected to development and preview only; Auth provisioning is enabled.
- Explicit direct migrations created private `songwriting_mastra` and
  `songwriting_agent` schemas; runtime uses the pooled `pg` connection.
- Server-only variables: `DATABASE_URL`, `DATABASE_URL_UNPOOLED`,
  `NEON_AUTH_BASE_URL`, `NEON_AUTH_COOKIE_SECRET`, `AGENT_ALLOWED_EMAILS`
  (or explicit `AGENT_ALLOWED_IDS`), `AGENT_ENABLED=true`, `AGENT_MODEL`.
- Preview model is `google/gemini-2.5-flash` through Vercel AI Gateway's existing
  credentials/free credits. No billing upgrade was performed. Model charges are
  separate from the Neon plan.
- `VITE_AGENT_MODE=hosted` enables the hosted connection in local development;
  production builds default to hosted. `VITE_AGENT_MODE=local` selects the original
  loopback bridge explicitly. Never expose database/model secrets with `VITE_`.

Neon currently returns **403 Invalid origin / Invalid callbackURL** for the
preview. Manual CLI deployment did not register its auth origin automatically.
The Vercel CLI can produce a Neon SSO link, but opening that console still needs
the owner's browser session; the available CLI token cannot administer it.
In Neon → branch → Auth → Configuration → Domains, register:

- `https://songwriting-agent-preview-garth-tricketts-projects.vercel.app`
- `https://songwriting-orpin.vercel.app` for the eventual production branch

Use the [Neon trusted-domain configuration](https://neon.com/docs/auth/guides/configure-domains).
Production must have isolated database/auth data and its own credentials before
release. No preview database credentials have been connected to production.

## Reproduction

Use Bun 1.4.2, pinned by the repository. For a linked Vercel checkout:

```sh
vercel env pull .env.local --environment=development
bun --env-file=.env.local run db:migrate
```

Migration requires `DATABASE_URL_UNPOOLED`; it never runs during an API request.
Use a disposable Postgres database for tests, not a user's data:

```sh
AGENT_TEST_DATABASE_URL=postgres://songwriting:local-test-only@127.0.0.1:55439/songwriting bun run test:hosted
bun run verify
bun run test:browser
bun run test:hosted-browser
git diff --check
```

CI provisions Postgres 17 and runs both browser suites. Missing hosted test
database configuration fails instead of silently skipping tests.

## Evidence and its limits

- `bun run verify`: strict application TypeScript checks, 94 unit tests / 582
  assertions, and the Vite production build pass.
- `bun run test:browser`: all 33 existing editor/browser regressions pass.
- `bun run test:hosted-browser`: five Chromium tests pass with a deterministic
  HTTP peer. They exercise the real UI, browser storage, Web Locks, lost requests
  and acknowledgements, reload/undo, stale edits, cancellation, sign-out and a second tab.
- `bun run test:hosted`: 12 tests / 55 assertions pass with actual Postgres and
  Mastra. Fresh pools/storage/agent instances resume durable suspensions; duplicate
  receipts, worker fencing, ownership, quotas, rate limits, late receipts and
  competing resumptions are tested. The two-account HTTP test mocks only Neon's
  upstream session response; it is not proof of deployed Neon authentication.
- A real Gemini/Mastra/Neon run read context, saved the title
  `Neon Recovery Proof`, read it back, and explicitly completed. Undo restored
  `Before`. Token-based accounting settled at approximately $0.00125. This harness
  used the actual controller/commands with simulated IndexedDB, not a signed-in
  browser calling Vercel. Calls were spaced 45 seconds apart after a prior run hit
  free-tier rate limits. The automatic retry path is separately covered by tests.
- The protected Vercel preview builds using frozen Bun 1.4.2 dependencies and
  serves its editor and unauthenticated API status. Auth proxy requests reach Neon
  and fail at the trusted-origin configuration described above.

These are complementary tests, not substitutes for the deployed end-to-end gate.
No real user's song or credentials are included in fixtures or committed logs.

## TypeScript and deployment

Mastra bundles third-party declarations with incompatible internal paths. Its
shipped server docs specify `skipLibCheck: true`; apply that only to
`tsconfig.agent.json`. All application strictness flags remain enabled, while
the existing editor/bridge project retains declaration checks. Both are checked.
The API-local tsconfig omits ambient test types for Vercel's isolated transpiler;
the server project still typechecks these handlers with their actual imports.

Vercel's root install explicitly uses frozen Bun 1.4.2. Set
`VERCEL_INSTALL_COMPLETED=1` for the subsequent function packaging pass so it does
not repeat installation with the builder's older Bun and rewrite the lockfile.
The auth catch-all is an explicit rewrite to a single `api/auth.ts` handler.

## Remaining gate

1. Configure Neon trusted origins; prove real sign-in, expiry/sign-out and
   two-account isolation on the deployed API.
2. Through that signed-in browser, prove an actual edit, reload/duplicate-result
   recovery, different-instance continuation and undo on Vercel.
3. Isolate production data/auth, configure production environment, run the release
   smoke test, and only then claim the hosted agent is live.

Full catalog parity, media handles, richer conversation/checkpoints/questions,
longer collaborative workflows and real-model musical evaluations remain M2–M5.
The current preview has the M1 `context`/`read`/`mutate` primitives plus completion.
