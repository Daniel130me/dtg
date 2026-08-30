#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Local sandbox database bootstrap (NOT for production).
#
# The preview sandbox wipes processes and files outside the project directory
# between sessions. This script restores the local PostgreSQL runtime from
# scratch, idempotently:
#   1. installs the pinned embedded-postgres binaries if missing,
#   2. initialises the data directory if missing,
#   3. starts postgres on 127.0.0.1:5432 if not already running,
#   4. creates the `dtg` database if missing.
#
# Usage:  bash scripts/sandbox-db.sh
# After a full reset also re-run (idempotent, run from the project root):
#   bun run db:migrate:deploy
#   ALLOW_OWNER_BOOTSTRAP=true OWNER_EMAIL=... OWNER_DISPLAY_NAME=... \
#     OWNER_PASSWORD=... bunx tsx scripts/bootstrap-owner.ts
#   DATABASE_URL=$DB_URL bunx tsx prisma/seed.ts
# The .env file must point DATABASE_URL/DIRECT_URL at
# postgresql://postgres@127.0.0.1:5432/dtg (recreated by this script when the
# sandbox reverts it).
# ---------------------------------------------------------------------------
set -euo pipefail

cd "$(dirname "$0")/.."

PGROOT=".local-postgres"
PGBIN="$PGROOT/node_modules/@embedded-postgres/linux-x64/native/bin"
PGDATA="$PGROOT/pgdata"
PGPORT=5432
DB_URL="postgresql://postgres@127.0.0.1:${PGPORT}/dtg"

if [ ! -x "$PGBIN/postgres" ]; then
  echo "[sandbox-db] installing embedded-postgres binaries..."
  mkdir -p "$PGROOT"
  (cd "$PGROOT" && bun init -y >/dev/null 2>&1 && bun add embedded-postgres >/dev/null 2>&1)
  (cd "$PGROOT" && bun pm trust @embedded-postgres/linux-x64 >/dev/null 2>&1)
fi

if [ ! -d "$PGDATA" ]; then
  echo "[sandbox-db] initialising data directory..."
  "$PGBIN/initdb" -D "$PGDATA" -U postgres --auth=trust -E UTF8 >/dev/null
fi

if ! "$PGBIN/pg_ctl" -D "$PGDATA" status >/dev/null 2>&1; then
  echo "[sandbox-db] starting postgres on 127.0.0.1:${PGPORT}..."
  "$PGBIN/pg_ctl" -D "$PGDATA" -l "$PGROOT/server.log" \
    -o "-p ${PGPORT} -c listen_addresses=127.0.0.1" start >/dev/null
  sleep 2
else
  echo "[sandbox-db] postgres already running."
fi

if (cd "$PGROOT" && timeout 15 bun -e "const {Client}=require('pg');(async()=>{const c=new Client('postgresql://postgres@127.0.0.1:${PGPORT}/postgres');try{await c.connect();await c.query('CREATE DATABASE dtg');console.log('[sandbox-db] created database dtg')}catch(e){if(!String(e.message).includes('already exists')){console.error(e.message);process.exitCode=1}else{console.log('[sandbox-db] database dtg exists')}}finally{await c.end().catch(()=>{})}})()"); then
  :
fi

# Keep .env pointing at the local postgres (the sandbox may revert it).
if ! grep -q "^DATABASE_URL=$DB_URL$" .env 2>/dev/null; then
  echo "[sandbox-db] restoring .env DATABASE_URL/DIRECT_URL..."
  printf 'DATABASE_URL=%s\nDIRECT_URL=%s\n' "$DB_URL" "$DB_URL" > .env
fi

echo "[sandbox-db] ready: $DB_URL"
echo "[sandbox-db] if the database is empty, run: bun run db:migrate:deploy && bunx tsx prisma/seed.ts"
