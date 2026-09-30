# ADR-0007: Own authentication on argon2id and database sessions (not Auth.js)

- Status: Accepted
- Date: 2026-09-30
- Source: ARCHITECTURE.md section 15, item 7 ("decided at M1 with reasons")

## Context

M1 needs email and password signup with verification, magic-link login, password reset,
invites, multiple organizations per user with org switching, and per-org roles
(FR-AUTH-1/2, FR-ORG-1/2/3). The security checklist (ARCHITECTURE.md section 13) asks for
argon2id, revocable httpOnly sessions, rotation on privilege change, CSRF protection and
rate-limited login. ARCHITECTURE.md section 2 allowed "own implementation on argon2 plus DB
sessions (or Auth.js if simpler)".

## Options

**Auth.js (NextAuth v5).** Brings OAuth providers, adapters and CSRF handling. But:

- its Credentials provider (email and password, our primary login) works only with JWT
  sessions, not database sessions. A JWT cannot be revoked server-side, and FR-AUTH-2 plus
  the checklist need exactly that: sign out everywhere on password reset, and end access at
  once when a member is removed;
- it has no concept of organizations, active org, roles or invites. Those are most of M1 and
  would be custom code either way, next to a framework whose session model fights them;
- its adapters expect to own `users`/`sessions` tables with their own shapes, while we need
  RLS on every table and hashed tokens (ADR-0015);
- v5 has spent years in beta, and the project is now maintained by the Better Auth team.
  That makes it a moving target for a security-critical dependency.

**Own implementation.** More code to own, but each piece is small and standard, and all of it
is testable against the real database.

## Decision

Own implementation, with no new runtime dependency for cryptography:

- **Passwords**: argon2id via Node's built-in `crypto.argon2` (Node >= 24.7; this repo pins
  Node 24), OWASP parameters (19 MiB, 2 passes, 1 lane), NFKC-normalized input, stored as PHC
  strings. Tests pin the implementation to the RFC 9106 argon2id vector and the reference
  CLI's PHC output. Because the format is standard, `@node-rs/argon2` could replace the
  built-in without rehashing. Unknown-email sign-ins run a dummy verification to equalize
  timing. Policy: 12 to 128 characters, no composition rules (NIST SP 800-63B).
- **Sessions**: 256-bit random tokens in a cookie; the database stores only
  `HMAC-SHA256(SESSION_SECRET, token)`. Cookie: httpOnly, SameSite=Lax, Path=/, and over
  HTTPS `Secure` with the `__Host-` prefix. 30-day absolute lifetime. The token is rotated
  when the active org changes (switch, create, accept invite). Password reset deletes every
  session. Removing a member clears the active org of their sessions through a foreign key.
- **Email tokens** (verification 24 h, reset 1 h, magic link 15 min, invites 7 days) are the
  same kind of token, stored as HMACs, single-use, and consumed atomically in the database.
  Using one retires the user's other tokens of that purpose. Links carry tokens in the URL
  fragment (ADR-0017), and the landing pages need a click to POST them, so link scanners
  do not consume them.
- **Signup does not reveal accounts**: signup, magic link, reset and resend all answer
  202 for any address. For an existing address the owner gets a "you already have an
  account" email instead. A session starts only after the email is confirmed. Invitees who
  sign up from the link start verified, since holding the link proves the mailbox.
- **CSRF**: every non-GET `/api/v1` request must carry an `Origin` equal to `APP_URL`
  (or `Sec-Fetch-Site: same-origin` when Origin is absent), on top of SameSite=Lax.
- **Rate limits** (Redis, per email fingerprint, fail-open): 10 sign-in attempts per 15
  minutes, 5 emails per hour per address. Per-IP limits and lockout are M8.
- **Authorization**: `authorize()` from `packages/shared/permissions.ts`, applied by the
  single route wrapper (`apps/web/src/server/api.ts`) and inside services.

Endpoints (`/api/v1`): `auth/signup`, `auth/verify`, `auth/verify/resend`, `auth/login`,
`auth/logout`, `auth/magic-link`, `auth/magic-link/consume`, `auth/password-reset`,
`auth/password-reset/confirm`, `me`, `orgs`, `orgs/:id/switch`, `members`, `members/:id`,
`invites`, `invites/:id`, `invites/preview`, `invites/accept`. These refine the auth paths
sketched in ARCHITECTURE.md section 9.

## Consequences

- No OAuth/SSO. If customers need it, add providers behind the same session model (a new
  reviewed definer function for lookup by provider identity).
- Rotating `SESSION_SECRET` signs everyone out and invalidates outstanding links; that is the
  intended emergency lever.
- `crypto.argon2` is "release candidate" stability in Node 24. The pinned test vectors fail
  loudly if its behaviour ever changes.
