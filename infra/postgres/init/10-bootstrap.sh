#!/bin/sh
# Runs once, on first start of the Postgres container (docker-entrypoint-initdb.d).
# Creates the ig_owner / ig_app roles and the invoiceguard database owned by ig_owner.
set -eu

psql -v ON_ERROR_STOP=1 \
  -v owner_password="$IG_OWNER_PASSWORD" \
  -v app_password="$IG_APP_PASSWORD" \
  --username "$POSTGRES_USER" --dbname postgres <<'EOSQL'
SELECT set_config('ig.owner_password', :'owner_password', false);
SELECT set_config('ig.app_password', :'app_password', false);
\i /bootstrap/bootstrap-roles.sql
SELECT 'CREATE DATABASE invoiceguard OWNER ig_owner'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'invoiceguard')\gexec
EOSQL
