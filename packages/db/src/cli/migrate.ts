import { parseEnv, migrateEnvSchema } from '@invoiceguard/shared/env';
import { loadWorkspaceEnvFile } from '@invoiceguard/shared/env-file';
import { createLogger } from '@invoiceguard/shared/logger';
import { runMigrations } from '../migrate';

loadWorkspaceEnvFile();
const env = parseEnv(migrateEnvSchema, process.env);
const log = createLogger({ name: 'migrate', level: env.LOG_LEVEL });

try {
  const result = await runMigrations(env.DATABASE_OWNER_URL);
  log.info(
    { appliedBefore: result.appliedBefore, appliedAfter: result.appliedAfter },
    result.appliedAfter > result.appliedBefore
      ? `applied ${String(result.appliedAfter - result.appliedBefore)} migration(s)`
      : 'database is up to date',
  );
} catch (err) {
  log.error({ err }, 'migration failed');
  process.exitCode = 1;
}
