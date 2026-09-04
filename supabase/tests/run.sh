#!/usr/bin/env bash
# Applies every migration to a throwaway Postgres database, then runs the
# access-control, operations and admin suites against it.
#
#   supabase/tests/run.sh
#   PGPORT=5432 supabase/tests/run.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$HERE")"
PGHOST="${PGHOST:-/tmp}"
PGPORT="${PGPORT:-5433}"
PGUSER="${PGUSER:-postgres}"
DB="${TEST_DB:-lp_test}"
PSQL=(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER")

"${PSQL[@]}" -q -c "drop database if exists $DB;" -c "create database $DB;" >/dev/null
"${PSQL[@]}" -d "$DB" -v ON_ERROR_STOP=1 -q -f "$HERE/harness.sql" >/dev/null

for f in $(ls "$ROOT"/migrations/*.sql | sort); do
  if "${PSQL[@]}" -d "$DB" -v ON_ERROR_STOP=1 -q -f "$f" 2>&1 | grep -E "^psql.*ERROR"; then
    echo "migration failed: $f" && exit 1
  fi
done
echo "migrations applied"

"${PSQL[@]}" -d "$DB" -v ON_ERROR_STOP=1 -q -f "$HERE/seed_test.sql" >/dev/null

fail=0
for t in test_security.sql test_ops.sql test_admin.sql; do
  echo "--- $t"
  out=$("${PSQL[@]}" -d "$DB" -f "$HERE/$t" 2>&1 | grep -E "PASS|FAIL|ERROR" | sed 's/^psql:[^ ]*: NOTICE:  //') || true
  echo "$out"
  if echo "$out" | grep -qE "FAIL|ERROR"; then fail=1; fi
done
if [ "$fail" = 0 ]; then echo "ALL TESTS PASSED"; else echo "TESTS FAILED"; exit 1; fi
