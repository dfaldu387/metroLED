-- Database-side defaults that Prisma used to fill in from application code.
--
--  * "id" TEXT primary keys default to a random UUID (Prisma generated cuid()
--    client-side; existing ids are kept, and both formats are opaque text).
--  * "updatedAt" defaults to now() on insert and is refreshed by a trigger on
--    every UPDATE, replacing Prisma's @updatedAt.
--  * Columns are TIMESTAMP WITHOUT TIME ZONE holding UTC, so both use
--    now() AT TIME ZONE 'UTC' and are correct whatever the connection's zone.
--
-- Written against the catalog rather than table by table, so it covers every
-- table in the 001 schema. Requires PostgreSQL 13+ (gen_random_uuid built in).

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.table_name
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.column_name = 'id'
      AND c.data_type = 'text'
      AND c.column_default IS NULL
      AND c.table_name NOT IN ('schema_migrations', '_prisma_migrations')
  LOOP
    EXECUTE format('ALTER TABLE %I ALTER COLUMN "id" SET DEFAULT gen_random_uuid()::text', r.table_name);
  END LOOP;
END
$$;

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW."updatedAt" := (now() AT TIME ZONE 'UTC');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.table_name
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.column_name = 'updatedAt'
      AND c.table_name NOT IN ('schema_migrations', '_prisma_migrations')
  LOOP
    EXECUTE format('ALTER TABLE %I ALTER COLUMN "updatedAt" SET DEFAULT (now() AT TIME ZONE ''UTC'')', r.table_name);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', r.table_name || '_set_updated_at', r.table_name);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
      r.table_name || '_set_updated_at',
      r.table_name
    );
  END LOOP;
END
$$;

-- Defaults inherited from 001 ("createdAt" etc.) used CURRENT_TIMESTAMP, which
-- follows the connection's TimeZone. Make them UTC like every other write.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.table_name, c.column_name
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.data_type = 'timestamp without time zone'
      AND c.column_default = 'CURRENT_TIMESTAMP'
      AND c.table_name NOT IN ('schema_migrations', '_prisma_migrations')
  LOOP
    EXECUTE format('ALTER TABLE %I ALTER COLUMN %I SET DEFAULT (now() AT TIME ZONE ''UTC'')', r.table_name, r.column_name);
  END LOOP;
END
$$;
