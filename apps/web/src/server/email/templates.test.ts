import { describe, expect, it } from 'vitest';
import { escapeHtml, invite, linkWithToken, verifyEmail } from './templates';

describe('email templates', () => {
  it('escapes user-controlled names in HTML', () => {
    const email = invite({
      inviterName: '<script>alert(1)</script>',
      orgName: 'Evil "Corp" & <b>Co</b>',
      role: 'reviewer',
      url: 'http://localhost:3000/invite#token=abc',
    });
    expect(email.html).not.toContain('<script>');
    expect(email.html).not.toContain('<b>Co</b>');
    expect(email.html).toContain('&lt;script&gt;');
    expect(email.html).toContain('Evil &quot;Corp&quot; &amp; &lt;b&gt;Co&lt;/b&gt;');
    expect(email.text).toContain('as Reviewer');
  });

  it('keeps user input on one line in subjects', () => {
    const email = invite({
      inviterName: 'A',
      orgName: 'Acme\r\nBcc: victim@example.com',
      role: 'viewer',
      url: 'http://x/invite#token=t',
    });
    expect(email.subject).toBe('You are invited to Acme Bcc: victim@example.com on InvoiceGuard');
    expect(email.subject).not.toMatch(/[\r\n]/);
  });

  it('puts tokens in the URL fragment, not the query string', () => {
    const url = linkWithToken('http://localhost:3000', '/verify-email', 'tok_123');
    expect(url).toBe('http://localhost:3000/verify-email#token=tok_123');
    expect(new URL(url).search).toBe('');
  });

  it('includes the link in both text and HTML parts', () => {
    const url = 'http://localhost:3000/verify-email#token=abc';
    const email = verifyEmail({ name: 'Ann', url });
    expect(email.text).toContain(url);
    expect(email.html).toContain(`href="${url}"`);
  });

  it('escapes all five HTML-significant characters', () => {
    expect(escapeHtml(`<a href="x" onclick='y'>&</a>`)).toBe(
      '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;',
    );
  });
});
