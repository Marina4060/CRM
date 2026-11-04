#!/usr/bin/env bash
# Fresh database for tests/e2e_hosted.js (uses PGHOST / PGPORT / PGUSER).
set -e
DIR="$(cd "$(dirname "$0")/.." && pwd)"
DB=${PGDATABASE:-crm_e2e}
psql -d postgres -X -q -c "drop database if exists $DB" -c "create database $DB"
psql -d "$DB" -X -q -v ON_ERROR_STOP=1 -f "$DIR/supabase/tests/stub_supabase.sql"
for f in "$DIR"/supabase/migrations/*.sql; do psql -d "$DB" -X -q -v ON_ERROR_STOP=1 -f "$f"; done
psql -d "$DB" -X -q -c "insert into storage.objects (bucket_id, name) values ('app', 'crm.html'), ('app', 'version.json')"
echo "database $DB ready"
