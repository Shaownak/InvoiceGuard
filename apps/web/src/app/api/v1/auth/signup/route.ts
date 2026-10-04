import { z } from 'zod';
import { apiRoute } from '@/server/api';
import {
  emailField,
  orgNameField,
  passwordField,
  personNameField,
  tokenField,
} from '@/server/schemas';

const body = z.union([
  z.strictObject({
    name: personNameField,
    email: emailField,
    password: passwordField,
    orgName: orgNameField,
  }),
  z.strictObject({ name: personNameField, password: passwordField, inviteToken: tokenField }),
]);

/**
 * Self-serve signup: 202 and a confirmation email, whether or not the address was already
 * registered. With an invite token: creates a verified account in the inviting org and signs in.
 */
export const POST = apiRoute({ auth: 'public', body }, async ({ body, services, meta }) => {
  if ('inviteToken' in body) {
    const session = await services.orgs.signupFromInvite(
      { token: body.inviteToken, name: body.name, password: body.password },
      meta,
    );
    return { status: 201, body: { status: 'signed_in' }, session };
  }
  await services.auth.signup(body, meta);
  return { status: 202, body: { status: 'verification_sent' } };
});
