# US-118: Sign-in and role-based access control
**Status:** Ready for UAT · **Category:** security · **Points:** 3 · **Sprint:** –

## Summary
FitHub users now sign in with email and password and are recognised as a member, instructor or club manager. Every `/api` route requires a signed-in user, and only instructors and club managers may use staff-only routes. Staff accounts are created by an operator command.

## What was built
- `api/migrations/0002_create_app_user_and_session.ts`: tables `app_user` and `user_session` with the constraints from the design.
- `api/src/modules/auth/password.ts`: `hashPassword`, `verifyPassword` (scrypt, `scrypt$` format).
- `api/src/modules/auth/session.ts`: `createSession`, `resolveSession`, `deleteSession`, `deleteSessionsOfUser` (tokens stored as SHA-256 hash).
- `api/src/modules/auth/service.ts`: `authenticate`, `login`, `toMeDto`.
- `api/src/modules/auth/hooks.ts`: `authHook`, `originGuard`, `requireRole`, `currentUser`.
- `api/src/modules/auth/routes.ts`: `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/me`.
- `api/src/modules/auth/user-admin.ts` and `api/scripts/user-admin.ts`: `npm run user:create` and `npm run user:set-password`.
- `api/src/shared/errors.ts`: `DomainError` and the global error handler (flat `{ code, message, fieldErrors? }` body).
- `api/src/shared/clock.ts`: `Clock` and `systemClock`.
- `api/src/app.ts`: `buildApp` wiring (route table, log redaction, cookie and rate-limit plugins, `/api` scope with guards).
- `web/src/pages/SignInPage.tsx`, `web/src/components/RequireAuth.tsx`, `web/src/components/AppHeader.tsx`, `web/src/lib/auth.tsx`, `web/src/lib/safe-next.ts`, `web/src/api/client.ts`, `web/src/api/auth.ts`.

## How it works
- **AC 1 Sign-in:** `POST /api/auth/login` returns the user (`MeDto`) and sets the `fithub_session` cookie (HttpOnly, SameSite=Strict, Path=/api, Secure when `SESSION_COOKIE_SECURE=true`). Only the hash of the token is stored.
- **AC 2 Invalid credentials:** wrong password, unknown email or account without password all return 401 `INVALID_CREDENTIALS` with the same message. No cookie, no session row.
- **AC 3 Protection:** every `/api` route except login and logout needs a valid session. Missing, unknown, idle or expired sessions return 401 `UNAUTHENTICATED`.
- **AC 4/5 Roles:** `requireRole([...], message?)` returns 403 `FORBIDDEN` for other roles and lets `instructor` and `club_manager` through.
- **AC 6 Sign-out:** deletes the session row and clears the cookie. Sign-out without a cookie returns 204.
- **AC 7 Brute-force limit:** the 11th attempt for the same email and IP within 15 minutes returns 429 `TOO_MANY_ATTEMPTS`.
- **AC 8 Origin check:** POST/PUT/PATCH/DELETE under `/api` with an `Origin` different from `APP_ORIGIN` return 403.
- **AC 9 No secrets exposed:** passwords, tokens and cookies are redacted from logs and never returned.
- **AC 10 Operator accounts:** `user:create` and `user:set-password` validate input and exit 1 on error, creating nothing.
- **AC 11 Sign-in page:** form with labelled fields, error alert, `next` redirect (same-site paths only), header with name and "Sign out".
- **AC 12 Constraints:** database CHECK constraints enforce member type, club and email rules.

## How to test
Automated: `npm run typecheck`, `npm run lint`, `npm run test:unit -w api`, `npm test -w web`, `npm run build`.
Integration (needs `docker compose up -d db`): `npm run test:integration -w api`.

Manual checks:
- **AC 1:** Sign in at `/sign-in` with `Anna@Example.com`. **Verify:** you land on `/`, the header shows "Anna Berg".
- **AC 2:** Sign in with a wrong password, then an unknown email. **Verify:** "Email or password is incorrect." both times.
- **AC 3:** `curl -i http://localhost:3000/api/clubs`. **Verify:** 401 `UNAUTHENTICATED`.
- **AC 6:** Click "Sign out". **Verify:** redirect to `/sign-in`; the old cookie gets 401 on `/api/me`.
- **AC 7:** 11 wrong sign-ins. **Verify:** the 11th shows the rate-limit message.
- **AC 8:** `curl -i -X POST -H "Origin: https://evil.example" http://localhost:3000/api/auth/logout`. **Verify:** 403.
- **AC 10:** Run `user:create` with an existing email. **Verify:** exit code 1.
- **AC 11:** Open `/` in a private window. **Verify:** redirect to `/sign-in?next=%2F`.

## Deployment notes
**Pre-deploy**
- Product owner confirms the authentication method (assumed: email + password) and session lifetimes (12 h idle / 7 days).
- Set `DATABASE_URL`, `NODE_ENV=production`, `APP_ORIGIN`, `SESSION_COOKIE_SECURE=true`, and `TRUST_PROXY=true` behind a reverse proxy.
- API served over HTTPS on the same origin as the SPA.
- When US-117, US-120 or US-122 merge, their migrations replace the minimal shapes of `0001`, `0003` and `0004`.

**Post-deploy**
- Run `npm run db:migrate`.
- Seed clubs (`npm run db:seed:clubs -w api -- --file <clubs.json>`), then create the first club manager per club with `npm run user:create ... --password-stdin`. Hand over passwords through a secure channel.

**Configuration:** `APP_ORIGIN`, `SESSION_COOKIE_SECURE`, `SESSION_IDLE_TIMEOUT_MINUTES` (720), `SESSION_MAX_AGE_HOURS` (168), `AUTH_SCRYPT_COST` (131072), `LOGIN_RATE_LIMIT_MAX` (10), `LOGIN_RATE_LIMIT_WINDOW_MINUTES` (15), `TRUST_PROXY` (false).

## Known limitations
- Self-registration, invitations, password reset or change by the user are not included.
- No admin UI for users or roles; no deactivation of accounts; no MFA; no SSO.
- No cross-club admin role (open question for the PO).
- Imported and drop-in members have no password until an activation flow is defined.
- Integration tests are not part of `run_checks` and must be run against Postgres before release.
- Authentication method and session lifetimes await PO confirmation.
