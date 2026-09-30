import { z } from 'zod';
import { ConfigError } from './errors';

/**
 * Environment validation. Each process (web, worker, migrate) parses only the variables it
 * needs, so a missing Stripe key can never stop the migration runner, and conditional
 * requirements (e.g. S3 settings only when STORAGE_DRIVER=s3) live next to the variable.
 * See docs/adr/0009-environment-validation.md.
 */

const postgresUrl = z
  .url({ protocol: /^postgres(ql)?$/, error: 'must be a postgres:// or postgresql:// URL' })
  .describe('Postgres connection URL');

const redisUrl = z.url({ protocol: /^rediss?$/, error: 'must be a redis:// or rediss:// URL' });

const baseSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

const s3StorageSchema = z.object({
  STORAGE_DRIVER: z.literal('s3'),
  S3_ENDPOINT: z.url().optional(),
  S3_REGION: z.string().min(1),
  S3_BUCKET: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/, 'must be a valid bucket name'),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: z.stringbool().default(false),
});

const fsStorageSchema = z.object({
  STORAGE_DRIVER: z.literal('fs'),
  STORAGE_FS_ROOT: z.string().min(1),
});

const storageSchema = z.discriminatedUnion('STORAGE_DRIVER', [s3StorageSchema, fsStorageSchema], {
  error: 'must be "s3" or "fs"',
});

/** The filesystem driver exists for local development without Docker; never in production. */
function forbidFsStorageInProduction(
  env: { NODE_ENV: string; STORAGE_DRIVER: string },
  ctx: z.RefinementCtx,
): void {
  if (env.NODE_ENV === 'production' && env.STORAGE_DRIVER === 'fs') {
    ctx.addIssue({
      code: 'custom',
      path: ['STORAGE_DRIVER'],
      message: 'the fs driver is for local development only; use s3 in production',
    });
  }
}

export const webEnvSchema = baseSchema
  .extend({
    APP_URL: z.url(),
    DATABASE_URL: postgresUrl,
    REDIS_URL: redisUrl,
  })
  .and(storageSchema)
  .superRefine(forbidFsStorageInProduction);

export const workerEnvSchema = baseSchema
  .extend({
    DATABASE_URL: postgresUrl,
    REDIS_URL: redisUrl,
    WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(4),
  })
  .and(storageSchema)
  .superRefine(forbidFsStorageInProduction);

export const migrateEnvSchema = baseSchema.extend({
  DATABASE_OWNER_URL: postgresUrl,
});

export const storageEnvSchema = baseSchema
  .and(storageSchema)
  .superRefine(forbidFsStorageInProduction);

export type WebEnv = z.infer<typeof webEnvSchema>;
export type WorkerEnv = z.infer<typeof workerEnvSchema>;
export type MigrateEnv = z.infer<typeof migrateEnvSchema>;
export type StorageEnv = z.infer<typeof storageSchema>;

type EnvSource = Readonly<Record<string, string | undefined>>;

/**
 * Parses an environment source against a schema. Empty strings count as unset, which matches
 * how `.env` files are usually written (`FOO=`). On failure throws a ConfigError whose message
 * lists variable names and reasons only: values are never included because they may be secrets.
 */
export function parseEnv<S extends z.ZodType>(schema: S, source: EnvSource): z.infer<S> {
  const cleaned: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && value !== '') cleaned[key] = value;
  }
  const result = schema.safeParse(cleaned);
  if (result.success) return result.data;

  const problems = result.error.issues.map((issue) => {
    const variable = issue.path.length > 0 ? issue.path.join('.') : '(root)';
    const reason =
      issue.code === 'invalid_type' && issue.input === undefined ? 'is required' : issue.message;
    return { variable, reason };
  });
  const summary = problems.map((p) => `  - ${p.variable}: ${p.reason}`).join('\n');
  throw new ConfigError(`Invalid environment configuration:\n${summary}`, { problems });
}
