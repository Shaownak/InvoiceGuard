import { ROLE_LABELS, type Role } from '@invoiceguard/shared/permissions';

/**
 * Transactional emails. Names and org names are user input, so every interpolated value is
 * HTML-escaped (CLAUDE.md rule 5). Links carry the token in the URL fragment, which browsers
 * never send to the server, so tokens stay out of access logs and Referer headers.
 */

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ESCAPES[ch] ?? ch);
}

/** Collapses whitespace and line breaks so user input cannot forge extra header-like lines. */
function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function linkWithToken(appUrl: string, path: string, token: string): string {
  const url = new URL(path, appUrl);
  url.hash = `token=${token}`;
  return url.toString();
}

function layout(paragraphs: string[], action: { label: string; url: string }, footer: string) {
  const body = paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join('\n');
  const html = `<!doctype html><html><body style="font-family:system-ui,sans-serif;line-height:1.5;color:#0f172a">
${body}
<p><a href="${escapeHtml(action.url)}" style="display:inline-block;padding:10px 16px;background:#047857;color:#fff;border-radius:6px;text-decoration:none">${escapeHtml(action.label)}</a></p>
<p style="color:#475569;font-size:13px">${escapeHtml(footer)}</p>
</body></html>`;
  const text = `${paragraphs.join('\n\n')}\n\n${action.label}: ${action.url}\n\n${footer}\n`;
  return { html, text };
}

export function verifyEmail(input: { name: string; url: string }): RenderedEmail {
  return {
    subject: 'Confirm your email for InvoiceGuard',
    ...layout(
      [
        `Hi ${oneLine(input.name)},`,
        'Confirm your email address to finish setting up InvoiceGuard.',
      ],
      { label: 'Confirm email', url: input.url },
      'This link expires in 24 hours. If you did not sign up, you can ignore this email.',
    ),
  };
}

export function accountExists(input: { loginUrl: string }): RenderedEmail {
  return {
    subject: 'You already have an InvoiceGuard account',
    ...layout(
      [
        'Someone tried to create an InvoiceGuard account with this email address, which already has one.',
        'If it was you, sign in instead. If you forgot your password, you can reset it from the sign-in page.',
      ],
      { label: 'Sign in', url: input.loginUrl },
      'If it was not you, no action is needed.',
    ),
  };
}

export function passwordReset(input: { url: string }): RenderedEmail {
  return {
    subject: 'Reset your InvoiceGuard password',
    ...layout(
      ['We received a request to reset the password for this email address.'],
      { label: 'Choose a new password', url: input.url },
      'This link expires in 1 hour and signs you out of other devices. If you did not ask for it, ignore this email.',
    ),
  };
}

export function magicLink(input: { url: string }): RenderedEmail {
  return {
    subject: 'Your InvoiceGuard sign-in link',
    ...layout(
      ['Use this link to sign in to InvoiceGuard.'],
      { label: 'Sign in', url: input.url },
      'This link expires in 15 minutes and works once. If you did not ask for it, ignore this email.',
    ),
  };
}

export function invite(input: {
  inviterName: string;
  orgName: string;
  role: Role;
  url: string;
}): RenderedEmail {
  const org = oneLine(input.orgName);
  return {
    subject: `You are invited to ${org} on InvoiceGuard`,
    ...layout(
      [
        `${oneLine(input.inviterName)} invited you to join ${org} on InvoiceGuard as ${ROLE_LABELS[input.role]}.`,
      ],
      { label: 'Accept invitation', url: input.url },
      'This invitation expires in 7 days.',
    ),
  };
}
