-- Runs once when the Postgres volume is created (docker-entrypoint-initdb.d).
-- Two roles so that Row Level Security actually applies to the app:
--   salon_owner  owns the tables and runs migrations (table owners bypass RLS)
--   salon_app    what the web app connects as; subject to every policy
CREATE ROLE salon_owner LOGIN PASSWORD 'owner';
CREATE ROLE salon_app LOGIN PASSWORD 'app';
CREATE DATABASE salon OWNER salon_owner;
\connect salon
ALTER SCHEMA public OWNER TO salon_owner;
CREATE EXTENSION IF NOT EXISTS btree_gist;
