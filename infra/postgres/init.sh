#!/bin/bash
# Runs once, the first time the Postgres volume is created.
# One database per app so the Next.js and Express results never mix.
set -e
for db in nextapp nodeapp; do
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres -c "CREATE DATABASE $db"
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$db" <<'SQL'
CREATE TABLE todos (
  id         SERIAL PRIMARY KEY,
  title      TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  done       BOOLEAN NOT NULL DEFAULT false,
  user_id    TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX todos_user_id_idx ON todos (user_id);
INSERT INTO todos (title) VALUES ('First todo (seeded)');
SQL
done
