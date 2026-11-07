-- Run once as the migration administrator, after 0001, in the intended Supabase project.
-- No password is embedded; provision the login password separately in the dashboard.
BEGIN;
CREATE ROLE metis_reader LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE TABLE metis.installation (
    id integer PRIMARY KEY CHECK (id=1),
    project_ref text NOT NULL CHECK (project_ref ~ '^[a-z0-9][a-z0-9-]{0,62}$')
);
REVOKE ALL ON metis.installation FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA metis, auth TO metis_reader;
GRANT SELECT ON metis.tasks, metis.schema_migrations, metis.installation TO metis_reader;
GRANT EXECUTE ON FUNCTION auth.uid(), auth.jwt() TO metis_reader;
CREATE POLICY tasks_api_read_own ON metis.tasks FOR SELECT TO metis_reader
    USING (user_id=(SELECT auth.uid()) AND deleted_at IS NULL
        AND (SELECT auth.jwt()->>'is_anonymous')='false');
INSERT INTO metis.schema_migrations(version,name) VALUES (2,'task_reader');
-- Installation project binding is populated separately; reads fail closed until then.
COMMIT;
