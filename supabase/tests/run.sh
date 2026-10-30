#!/usr/bin/env bash
# Прогон миграций и SQL-тестов на локальном Postgres.
# Локально: ./supabase/tests/run.sh
# CI: DATABASE_URL=postgresql://postgres:postgres@localhost:5432/inventory_test ./supabase/tests/run.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

psql_db() {
  local database_url="$1"
  shift
  if [[ -n "${DATABASE_URL:-}" ]]; then
    psql "$database_url" -v ON_ERROR_STOP=1 "$@"
  else
    sudo -u postgres psql -d "$database_url" -v ON_ERROR_STOP=1 "$@"
  fi
}

prepare_db() {
  local name="$1"
  if [[ -n "${DATABASE_URL:-}" ]]; then
    return
  fi
  sudo -u postgres psql -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS ${name};" >/dev/null
  sudo -u postgres psql -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE ${name};" >/dev/null
}

apply_migrations() {
  local url="$1"
  local file
  for file in "$ROOT"/supabase/migrations/*.sql; do
    echo "== $(basename "$file")"
    psql_db "$url" -f "$file"
  done
}

run_rules() {
  local url="$1"
  echo "== auth stub + migrations"
  psql_db "$url" -f "$ROOT/supabase/tests/00_auth_stub.sql"
  apply_migrations "$url"
  echo "== rules"
  psql_db "$url" -f "$ROOT/supabase/tests/01_rules.sql"
  echo "== parallel inserts"
  local tmp
  tmp="$(mktemp -d)"
  local i pid
  local pids=()
  for i in $(seq 1 20); do
    psql_db "$url" -c "SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false); SELECT set_config('request.jwt.claims', '{\"sub\":\"11111111-1111-4111-8111-111111111111\"}', false); INSERT INTO public.equipment (nomenclature_id, status, location_id) VALUES ('22222222-2222-4222-8222-222222222222', 'in_work', '55555555-5555-4555-8555-555555555551');" \
      >"$tmp/$i.out" 2>"$tmp/$i.err" &
    pids+=("$!")
  done
  local failed=0
  for pid in "${pids[@]}"; do
    if ! wait "$pid"; then
      failed=1
    fi
  done
  if [[ "$failed" -ne 0 ]]; then
    echo "Параллельные вставки завершились с ошибкой" >&2
    cat "$tmp"/*.err >&2 || true
    exit 1
  fi
  echo "== parallel check + rls"
  psql_db "$url" -f "$ROOT/supabase/tests/02_parallel_check.sql"
  psql_db "$url" -f "$ROOT/supabase/tests/03_rls.sql"
  echo "== function locks"
  psql_db "$url" -f "$ROOT/supabase/tests/05_function_locks.sql"
  echo "== locations and responsibles"
  psql_db "$url" -f "$ROOT/supabase/tests/06_locations_stage3.sql"
  echo "== anon function revoke"
  psql_db "$url" -f "$ROOT/supabase/tests/07_anon_function_revoke.sql"
  echo "== journal and bulk"
  psql_db "$url" -f "$ROOT/supabase/tests/08_journal_stage4.sql"
  echo "== verifications and excel"
  psql_db "$url" -f "$ROOT/supabase/tests/09_stage6.sql"
  echo "== users admin rules"
  psql_db "$url" -f "$ROOT/supabase/tests/10_stage7.sql"
  echo "== owner prefix and places"
  psql_db "$url" -f "$ROOT/supabase/tests/11_owner_rules.sql"
  echo "== usernames"
  psql_db "$url" -f "$ROOT/supabase/tests/12_usernames.sql"
  rm -rf "$tmp"
}

run_seed() {
  local url="$1"
  echo "== rich auth stub + migrations + seed"
  psql_db "$url" -f "$ROOT/supabase/tests/00_auth_stub_rich.sql"
  apply_migrations "$url"
  psql_db "$url" -f "$ROOT/supabase/seed.sql"
  psql_db "$url" -f "$ROOT/supabase/tests/04_seed_check.sql"
}

if [[ -n "${DATABASE_URL:-}" ]]; then
  run_rules "$DATABASE_URL"
  if [[ -n "${SEED_DATABASE_URL:-}" ]]; then
    run_seed "$SEED_DATABASE_URL"
  fi
else
  prepare_db inventory_stage2
  run_rules inventory_stage2
  prepare_db inventory_stage2_seed
  run_seed inventory_stage2_seed
fi

echo "SQL-тесты прошли"
