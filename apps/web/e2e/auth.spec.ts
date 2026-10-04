import { expect, test, type Page } from '@playwright/test';
import { uniqueEmail, waitForLink } from './mail';

// M1 end to end: signup and email confirmation, invites, org switching, password reset,
// magic link, and the signed-out guard. Emails are read from Mailpit (CI) or .eml files.

const PASSWORD = 'e2e passphrase long enough';

async function signUpAndConfirm(page: Page, orgName: string): Promise<string> {
  const email = uniqueEmail('owner');
  await page.goto('/signup');
  await page.getByLabel('Your name').fill('Erin Owner');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByLabel('Organization name').fill(orgName);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('main').getByRole('status')).toContainText('Check your inbox');

  await page.goto(await waitForLink(email, '/verify-email'));
  await page.getByRole('button', { name: 'Confirm email' }).click();
  await expect(page.getByRole('heading', { level: 1, name: orgName })).toBeVisible();
  return email;
}

async function signOut(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);
}

test('signup, invite a colleague who joins, then switch organizations', async ({
  page,
  browser,
}) => {
  const orgName = `Acme ${String(Date.now())}`;
  await signUpAndConfirm(page, orgName);
  await expect(page.getByText('· Owner')).toBeVisible();

  const invitee = uniqueEmail('reviewer');
  await page.getByRole('link', { name: 'Members' }).click();
  await page.getByLabel('Email').fill(invitee);
  await page.getByLabel('Role', { exact: true }).selectOption('reviewer');
  await page.getByRole('button', { name: 'Send invitation' }).click();
  await expect(page.getByRole('main').getByRole('status')).toContainText(
    `Invitation sent to ${invitee}`,
  );
  await expect(page.getByText(`${invitee} · Reviewer`)).toBeVisible();

  const inviteeContext = await browser.newContext();
  const other = await inviteeContext.newPage();
  await other.goto(await waitForLink(invitee, '/invite'));
  await expect(other.getByText(`You are invited to join ${orgName} as Reviewer`)).toBeVisible();
  await other.getByRole('button', { name: 'Create my account' }).click();
  await other.getByLabel('Your name').fill('Rae Reviewer');
  await other.getByLabel('Password').fill(PASSWORD);
  await other.getByRole('button', { name: /Create account and join/ }).click();
  await expect(other.getByRole('heading', { level: 1, name: orgName })).toBeVisible();
  await expect(other.getByText('· Reviewer')).toBeVisible();

  // Reviewers see members but cannot manage them.
  await other.getByRole('link', { name: 'Members' }).click();
  await expect(other.getByRole('cell', { name: 'Erin Owner', exact: true })).toBeVisible();
  await expect(other.getByRole('button', { name: 'Send invitation' })).toHaveCount(0);

  // A second org of their own, then switch back.
  await other.getByRole('link', { name: 'New organization' }).click();
  await other.getByLabel('Organization name').fill('Rae Consulting');
  await other.getByRole('button', { name: 'Create organization' }).click();
  await expect(other.getByRole('heading', { level: 1, name: 'Rae Consulting' })).toBeVisible();
  await other.getByLabel('Organization').selectOption({ label: orgName });
  await expect(other.getByRole('heading', { level: 1, name: orgName })).toBeVisible();
  await expect(other.getByText('· Reviewer')).toBeVisible();
  await inviteeContext.close();

  // The owner sees the new member.
  await page.reload();
  await expect(page.getByRole('cell', { name: 'Rae Reviewer', exact: true })).toBeVisible();
});

test('password reset signs in with the new password; magic link signs in', async ({ page }) => {
  const orgName = `Reset ${String(Date.now())}`;
  const email = await signUpAndConfirm(page, orgName);
  await signOut(page);

  await page.getByRole('link', { name: 'Forgot password?' }).click();
  // Wait for the new page: the sign-in page also has an Email field.
  await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible();
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Email me a reset link' }).click();
  await expect(page.getByRole('main').getByRole('status')).toContainText('If an account exists');
  await page.goto(await waitForLink(email, '/reset-password/confirm'));
  await page.getByLabel('New password', { exact: true }).fill('a different e2e passphrase');
  await page.getByLabel('Confirm new password').fill('a different e2e passphrase');
  await page.getByRole('button', { name: 'Set new password' }).click();
  await expect(page.getByRole('heading', { level: 1, name: orgName })).toBeVisible();
  await signOut(page);

  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText(
    'Email or password is incorrect',
  );

  await page.getByRole('button', { name: 'Email me a sign-in link instead' }).click();
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
  await expect(page.getByRole('main').getByRole('status')).toContainText('sign-in link');
  await page.goto(await waitForLink(email, '/magic-link'));
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { level: 1, name: orgName })).toBeVisible();
});

test('signed-out visitors are sent to sign in', async ({ page }) => {
  await page.goto('/app/settings/members');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});
