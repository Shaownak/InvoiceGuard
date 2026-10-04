# ADR-0017: Email transports (SMTP or file) and token links in the URL fragment

- Status: Accepted
- Date: 2026-09-30
- Follows: ADR-0011 (run with or without Docker), which deferred email to M1

## Context

M1 sends verification, password reset, magic-link and invite emails. Docker development has
Mailpit (SMTP on 1025, UI on 8025). The primary development machine cannot run Docker
(ADR-0011), and downloading and running a Mailpit binary there would mean installing
software from outside the package manager.

## Decision

1. **Nodemailer** (the stack choice in ARCHITECTURE.md section 2) with two transports,
   selected by `EMAIL_TRANSPORT`:
   - `smtp` with `SMTP_URL`: Mailpit in Docker development and CI, a real provider in
     production;
   - `file` with `EMAIL_FILE_DIR` (default `.local/mail`): each message is written as an
     `.eml` file (open it in any mail client or text editor). The server logs only the file
     path, never the message, since it contains sign-in links. Like `STORAGE_DRIVER=fs`, it
     is rejected when `NODE_ENV=production`.
2. **Tokens travel in the URL fragment**: `/verify-email#token=...`. Browsers do not send the
   fragment to the server, so tokens never reach access logs, the Next.js request log,
   proxies, or `Referer` headers. The page reads the fragment and POSTs it to the API.
3. **Landing pages require a click** (confirm, sign in, accept) before the POST, so link
   scanners in mail gateways cannot consume single-use tokens.
4. Emails are sent after the database transaction commits. If sending fails, the request
   fails. Every flow can be retried: resend verification, request a new link, re-invite
   (which replaces the open invite).
5. User-supplied values in emails (names, org names) are HTML-escaped and collapsed to one
   line.

## Consequences

- Native development needs no mail server. The e2e helper reads `.eml` files when
  `EMAIL_TRANSPORT=file` and the Mailpit API when `smtp` (CI).
- A background email queue (retries, bounce handling) is not needed yet; revisit if
  sending in the request path becomes a latency or reliability problem.
