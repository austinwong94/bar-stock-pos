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
case "$PGHOST" in
  /tmp|localhost|127.0.0.1|::1) ;;
  *) echo "Tests require local PostgreSQL, not a cloud database." >&2; exit 1 ;;
esac
DB="lp_test_$(node -e 'process.stdout.write(require("node:crypto").randomUUID().replaceAll("-", ""))')"
PSQL=(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER")

"${PSQL[@]}" -v ON_ERROR_STOP=1 -q -c "create database $DB;" >/dev/null
trap '"${PSQL[@]}" -q -c "drop database if exists $DB;" >/dev/null' EXIT
"${PSQL[@]}" -d "$DB" -v ON_ERROR_STOP=1 -q -f "$HERE/harness.sql" >/dev/null

for f in "$ROOT"/migrations/*.sql; do
  "${PSQL[@]}" -d "$DB" -v ON_ERROR_STOP=1 -q -f "$f" >/dev/null
done
echo "migrations applied"

"${PSQL[@]}" -d "$DB" -v ON_ERROR_STOP=1 -q -f "$HERE/seed_test.sql" >/dev/null

fail=0
for t in test_security.sql test_ops.sql test_admin.sql test_kitchen_ops.sql test_trips_items.sql test_pickup.sql; do
  echo "--- $t"
  out=$("${PSQL[@]}" -d "$DB" -v ON_ERROR_STOP=1 -f "$HERE/$t" 2>&1) || { printf '%s\n' "$out"; exit 1; }
  echo "$out"
  if echo "$out" | grep -qE "FAIL|ERROR"; then fail=1; fi
done
if [ "$fail" = 0 ]; then echo "ALL TESTS PASSED"; else echo "TESTS FAILED"; exit 1; fi
