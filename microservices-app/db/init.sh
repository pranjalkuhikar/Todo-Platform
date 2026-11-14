#!/bin/bash
# Runs once, when the Postgres volume is first created.
# One database per service: the services never read each other's tables (that is the point of microservices).
# The tables themselves are created by each service's own migrations on startup.
set -e
for db in tododb; do
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres -c "CREATE DATABASE $db"
done
