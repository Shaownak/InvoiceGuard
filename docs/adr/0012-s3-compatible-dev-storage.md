# ADR-0012: RustFS instead of MinIO for local S3-compatible storage

- Status: Accepted
- Date: 2026-09-30
- Deviation from: ARCHITECTURE.md sections 1, 2 and 14 ("MinIO locally")

## Context

MinIO stopped distributing community container images and binaries in late 2025. The
`minio/minio` Docker Hub repository now returns 404, so a compose file referencing it would
break on a clean clone.

## Decision

- Local and CI S3 is **RustFS** (`rustfs/rustfs:1.0.0`, Apache-2.0, S3 API compatible, designed
  as a MinIO drop-in), pinned to an exact version.
- The application depends only on the S3 API through `@aws-sdk/client-s3`
  (`packages/storage`), so the choice of dev server does not leak into code. Production uses
  AWS S3, Cloudflare R2 or any S3-compatible service, as planned.
- The bucket is created by `pnpm storage:ensure-bucket` (run by `pnpm services:docker`)
  rather than by an init container, so the same code path works everywhere.

## Consequences

- RustFS reached 1.0 in September 2026 and is younger than MinIO. If compatibility issues
  appear, SeaweedFS (`chrislusf/seaweedfs`, S3 gateway) is the fallback. Swapping is a
  compose-only change.
- ARCHITECTURE.md references to MinIO are updated to "S3-compatible (RustFS locally)".
