// Types for `inject('testInfra')` in integration tests. Deliberately import-free so any
// package can add this file to its tsconfig `include` without depending on devinfra
// (which would be circular: devinfra depends on db and storage).

/** Connection details handed to integration tests (must stay JSON-serializable). */
export interface TestInfra {
  mode: 'docker' | 'native';
  postgres: {
    host: string;
    port: number;
    /** Superuser on the maintenance database. For creating scratch databases only. */
    adminUrl: string;
    /** Owner role on the migrated `invoiceguard` database. */
    ownerUrl: string;
    /** App role (RLS-bound) on the migrated `invoiceguard` database. */
    appUrl: string;
  };
  redisUrl: string;
  /** Present only in docker mode, where an S3-compatible server runs. */
  s3: {
    bucket: string;
    region: string;
    endpoint: string;
    accessKeyId: string;
    secretAccessKey: string;
    forcePathStyle: boolean;
  } | null;
}

declare module 'vitest' {
  export interface ProvidedContext {
    testInfra: TestInfra;
  }
}
