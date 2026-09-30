/**
 * Fixed Postgres role names. Migrations grant privileges to APP_ROLE by name, so these must
 * match infra/postgres/bootstrap-roles.sql. Passwords come from the environment only.
 */
export const OWNER_ROLE = 'ig_owner';
export const APP_ROLE = 'ig_app';
