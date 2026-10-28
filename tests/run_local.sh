#!/usr/bin/env bash
# Run the access-rule tests against a scratch database.
# Usage: PGHOST=... PGPORT=... PGUSER=postgres tests/run_local.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DB=${TEST_DB:-soc_rls_test}
psql -q -c "drop database if exists $DB" -c "create database $DB" >/dev/null
psql -q -d "$DB" -c 'create extension if not exists pgcrypto' -f tests/stub_supabase.sql >/dev/null
for f in schema auth_upgrade seed_practices upgrade_v2; do psql -q -d "$DB" -v ON_ERROR_STOP=1 -f "supabase/$f.sql" >/dev/null 2>&1 || { echo "failed loading $f.sql"; psql -d "$DB" -v ON_ERROR_STOP=1 -f "supabase/$f.sql" | tail -5; exit 1; }; done
psql -q -d "$DB" -v ON_ERROR_STOP=1 -f tests/rls_tests.sql 2>&1 | sed 's/^psql:[^:]*:[0-9]*: //; s/^NOTICE:  //' | grep -v '^CONTEXT'
test "${PIPESTATUS[0]}" -eq 0
