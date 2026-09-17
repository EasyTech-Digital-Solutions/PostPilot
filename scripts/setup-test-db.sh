#!/usr/bin/env bash
# Creates and migrates the postpilot_test database used by the API's
# integration tests (apps/api/vitest.config.mts). Safe to re-run.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

docker compose up -d postgres
CONTAINER=$(docker compose ps -q postgres)

echo "Waiting for postgres to be ready..."
until docker exec "$CONTAINER" pg_isready -U postpilot >/dev/null 2>&1; do
  sleep 1
done

EXISTS=$(docker exec "$CONTAINER" psql -U postpilot -d postgres -t -A -c \
  "SELECT 1 FROM pg_database WHERE datname='postpilot_test'")

if [ "$EXISTS" != "1" ]; then
  echo "Creating postpilot_test database..."
  docker exec "$CONTAINER" psql -U postpilot -d postgres -c "CREATE DATABASE postpilot_test"
fi

echo "Applying migrations to postpilot_test..."
DATABASE_URL="postgresql://postpilot:postpilot@localhost:5432/postpilot_test?schema=public" \
  npx prisma migrate deploy --schema packages/db/prisma/schema.prisma

echo "Test database ready."
