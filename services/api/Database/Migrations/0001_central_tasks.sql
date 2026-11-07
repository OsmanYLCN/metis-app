-- Supabase PostgreSQL foundation. Apply manually only in a separate connection slice.
-- Transactional, fail-fast migration: re-running against existing objects does not reset data.
BEGIN;

CREATE SCHEMA metis;
REVOKE ALL ON SCHEMA metis FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE metis.schema_migrations (
    version integer PRIMARY KEY CHECK (version > 0),
    name text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE metis.tasks (
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    id uuid NOT NULL CHECK (id <> '00000000-0000-0000-0000-000000000000'::uuid),
    title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200 AND title = btrim(title)
                              AND char_length(btrim(title)) > 0 AND title !~ '[[:cntrl:]]'),
    completed boolean NOT NULL DEFAULT false,
    revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    deleted_at timestamptz,
    PRIMARY KEY (user_id, id),
    CHECK (updated_at >= created_at),
    CHECK (deleted_at IS NULL OR deleted_at >= created_at)
);

-- Server-owned timestamps/revisions, including a future tombstone update.
CREATE FUNCTION metis.guard_task_write() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        NEW.created_at := clock_timestamp();
        NEW.updated_at := NEW.created_at;
        NEW.revision := 1;
        NEW.deleted_at := NULL;
    ELSE
        IF NEW.id <> OLD.id OR NEW.user_id <> OLD.user_id THEN
            RAISE EXCEPTION 'Task identity is immutable' USING ERRCODE = '42501';
        END IF;
        NEW.created_at := OLD.created_at;
        NEW.updated_at := greatest(clock_timestamp(), OLD.updated_at);
        NEW.revision := OLD.revision + 1;
        IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
            NEW.deleted_at := NEW.updated_at;
        ELSE
            NEW.deleted_at := OLD.deleted_at;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION metis.guard_task_write() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER tasks_guard BEFORE INSERT OR UPDATE ON metis.tasks
    FOR EACH ROW EXECUTE FUNCTION metis.guard_task_write();

ALTER TABLE metis.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE metis.tasks FORCE ROW LEVEL SECURITY;
CREATE POLICY tasks_read_own ON metis.tasks FOR SELECT TO authenticated
    USING (user_id = (SELECT auth.uid()) AND deleted_at IS NULL
        AND (SELECT auth.jwt() ->> 'is_anonymous') = 'false');

-- No client write privileges/policies in this slice. No service_role fallback.
REVOKE ALL ON ALL TABLES IN SCHEMA metis FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA metis TO authenticated;
GRANT SELECT ON metis.tasks TO authenticated;
INSERT INTO metis.schema_migrations(version, name) VALUES (1, 'central_tasks');

COMMIT;
