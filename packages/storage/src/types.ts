export type StorageDriver = 'fs' | 's3';

/**
 * Object storage used for uploaded documents and generated reports. Keys are always built by
 * server code (never taken from user input) and validated by `assertValidKey`.
 */
export interface ObjectStorage {
  readonly driver: StorageDriver;
  /** Verifies the backend is reachable and usable; used by readiness checks. */
  ping(): Promise<void>;
  put(key: string, body: Uint8Array, options: { contentType: string }): Promise<void>;
  /** Throws NotFoundError when the key does not exist. */
  get(key: string): Promise<Uint8Array>;
  /** Idempotent: deleting a missing key succeeds. */
  delete(key: string): Promise<void>;
}
