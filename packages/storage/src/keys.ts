import { ValidationError } from '@invoiceguard/shared/errors';

const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const MAX_KEY_LENGTH = 512;

/**
 * Rejects keys that could escape the storage root or behave differently across backends:
 * empty or dot-leading segments (`..`, `.env`), backslashes, absolute paths, and anything
 * outside a conservative character set.
 */
export function assertValidKey(key: string): void {
  if (key.length === 0 || key.length > MAX_KEY_LENGTH) {
    throw new ValidationError('Invalid storage key length');
  }
  const segments = key.split('/');
  if (!segments.every((segment) => SEGMENT.test(segment))) {
    throw new ValidationError('Invalid storage key');
  }
}
