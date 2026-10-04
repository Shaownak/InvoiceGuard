import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { uniqueEmail, withPgClient } from '@invoiceguard/db/testing';
import {
  EmailNotVerifiedError,
  GoneError,
  UnauthenticatedError,
} from '@invoiceguard/shared/errors';
import { META, auditActions, createTestServices, type TestServices } from '../testing';

const infra = inject('testInfra');
const OWNER = infra.postgres.ownerUrl;
const PASSWORD = 'correct horse battery staple';

let t: TestServices;
beforeAll(() => {
  t = createTestServices(infra);
});
afterAll(() => t.close());

/** Signs up and confirms the email; returns the session and the new org id. */
async function signedUpUser(orgName = 'Acme') {
  const email = uniqueEmail('owner');
  await t.services.auth.signup({ name: 'Olive Owner', email, password: PASSWORD, orgName }, META);
  const session = await t.services.auth.verifyEmail(
    t.mailer.tokenFrom(email, '/verify-email'),
    META,
  );
  if (session.orgId === null) throw new Error('signup created no org');
  return { email, session, orgId: session.orgId };
}

describe('signup and email verification', () => {
  it('creates the user and org, emails a link, and signs in only after confirming', async () => {
    const email = uniqueEmail('new');
    await t.services.auth.signup(
      { name: 'Nia New', email, password: PASSWORD, orgName: 'Nia Co' },
      META,
    );
    await expect(t.services.auth.login({ email, password: PASSWORD }, META)).rejects.toBeInstanceOf(
      EmailNotVerifiedError,
    );

    const issued = await t.services.auth.verifyEmail(
      t.mailer.tokenFrom(email, '/verify-email'),
      META,
    );
    const session = await t.services.auth.authenticate(issued.token);
    expect(session).toMatchObject({ user: { email, name: 'Nia New' }, org: { role: 'owner' } });
    expect(session?.org?.id).toBe(issued.orgId);
    expect(await auditActions(OWNER, issued.orgId ?? '')).toEqual([
      'org.created',
      'session.signed_in',
    ]);
  });

  it('does not reveal an existing account: same result, and the owner gets a notice', async () => {
    const { email } = await signedUpUser();
    const before = t.mailer.countTo(email);
    await expect(
      t.services.auth.signup({ name: 'Imposter', email, password: PASSWORD, orgName: 'X' }, META),
    ).resolves.toBeUndefined();
    expect(t.mailer.countTo(email)).toBe(before + 1);
    expect(t.mailer.sent.at(-1)?.subject).toBe('You already have an InvoiceGuard account');
    const orgs = await withPgClient(OWNER, (c) =>
      c.query(`SELECT 1 FROM memberships m JOIN users u ON u.id = m.user_id WHERE u.email = $1`, [
        email,
      ]),
    );
    expect(orgs.rowCount).toBe(1);
  });

  it('confirmation links work once', async () => {
    const email = uniqueEmail('once');
    await t.services.auth.signup({ name: 'O', email, password: PASSWORD, orgName: 'O' }, META);
    const token = t.mailer.tokenFrom(email, '/verify-email');
    await t.services.auth.verifyEmail(token, META);
    await expect(t.services.auth.verifyEmail(token, META)).rejects.toBeInstanceOf(GoneError);
    await expect(t.services.auth.verifyEmail('garbage', META)).rejects.toBeInstanceOf(GoneError);
  });

  it('signing in unverified re-sends the confirmation link', async () => {
    const email = uniqueEmail('unver');
    await t.services.auth.signup({ name: 'U', email, password: PASSWORD, orgName: 'U' }, META);
    const before = t.mailer.countTo(email);
    await expect(t.services.auth.login({ email, password: PASSWORD }, META)).rejects.toBeInstanceOf(
      EmailNotVerifiedError,
    );
    expect(t.mailer.countTo(email)).toBe(before + 1);
  });
});

describe('login and logout', () => {
  it('signs in with the right password, case-insensitively by email', async () => {
    const { email, orgId } = await signedUpUser();
    const issued = await t.services.auth.login(
      { email: email.toUpperCase(), password: PASSWORD },
      META,
    );
    expect(issued.orgId).toBe(orgId);
    expect(await t.services.auth.authenticate(issued.token)).not.toBeNull();
  });

  it('gives the same error for a wrong password and an unknown email', async () => {
    const { email } = await signedUpUser();
    const wrong = t.services.auth.login({ email, password: 'wrong password here' }, META);
    const unknown = t.services.auth.login(
      { email: uniqueEmail('ghost'), password: PASSWORD },
      META,
    );
    await expect(wrong).rejects.toThrow(new UnauthenticatedError('Email or password is incorrect'));
    await expect(unknown).rejects.toThrow(
      new UnauthenticatedError('Email or password is incorrect'),
    );
  });

  it('logout ends the session', async () => {
    const { session } = await signedUpUser();
    const ctx = await t.services.auth.authenticate(session.token);
    if (ctx === null) throw new Error('expected a session');
    await t.services.auth.logout(ctx);
    expect(await t.services.auth.authenticate(session.token)).toBeNull();
  });

  it('rejects malformed and unknown session tokens', async () => {
    expect(await t.services.auth.authenticate('')).toBeNull();
    expect(await t.services.auth.authenticate('a'.repeat(43))).toBeNull();
  });
});

describe('magic link', () => {
  it('signs in once with the emailed link', async () => {
    const { email, orgId } = await signedUpUser();
    await t.services.auth.requestMagicLink(email);
    const token = t.mailer.tokenFrom(email, '/magic-link');
    expect((await t.services.auth.consumeMagicLink(token, META)).orgId).toBe(orgId);
    await expect(t.services.auth.consumeMagicLink(token, META)).rejects.toBeInstanceOf(GoneError);
  });

  it('sends nothing for an unknown address, without an error', async () => {
    const email = uniqueEmail('nobody');
    await t.services.auth.requestMagicLink(email);
    expect(t.mailer.countTo(email)).toBe(0);
  });
});

describe('password reset', () => {
  it('sets the new password, signs out other sessions, and audits the reset', async () => {
    const { email, session, orgId } = await signedUpUser();
    await t.services.auth.requestPasswordReset(email);
    const token = t.mailer.tokenFrom(email, '/reset-password/confirm');
    const fresh = await t.services.auth.resetPassword(token, 'a brand new passphrase', META);

    expect(await t.services.auth.authenticate(session.token)).toBeNull();
    expect(await t.services.auth.authenticate(fresh.token)).not.toBeNull();
    await expect(t.services.auth.login({ email, password: PASSWORD }, META)).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
    await t.services.auth.login({ email, password: 'a brand new passphrase' }, META);
    await expect(
      t.services.auth.resetPassword(token, 'another passphrase!', META),
    ).rejects.toBeInstanceOf(GoneError);
    expect(await auditActions(OWNER, orgId)).toContain('user.password_reset');
  });

  it('sends nothing for an unknown address', async () => {
    const email = uniqueEmail('nobody');
    await t.services.auth.requestPasswordReset(email);
    expect(t.mailer.countTo(email)).toBe(0);
  });
});
