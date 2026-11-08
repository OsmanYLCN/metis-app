-- M0.14: atomic task create/rename writer and idempotency journal.
-- Run once as migration administrator after 0002. Set the login password separately.
BEGIN;

CREATE ROLE metis_writer LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

CREATE TABLE metis.task_operations (
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    operation_id uuid NOT NULL CHECK (operation_id <> '00000000-0000-0000-0000-000000000000'::uuid),
    fingerprint char(64) NOT NULL CHECK (fingerprint ~ '^[0-9A-F]{64}$'),
    task_id uuid NOT NULL,
    kind smallint NOT NULL CHECK (kind IN (0,1)),
    applied_revision bigint NOT NULL CHECK (applied_revision > 0),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (user_id, operation_id),
    FOREIGN KEY (user_id, task_id) REFERENCES metis.tasks(user_id, id) ON DELETE RESTRICT
);

ALTER TABLE metis.task_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE metis.task_operations FORCE ROW LEVEL SECURITY;
CREATE POLICY task_operations_writer_own ON metis.task_operations FOR ALL TO metis_writer
    USING (user_id=(SELECT auth.uid()) AND (SELECT auth.jwt()->>'is_anonymous')='false')
    WITH CHECK (user_id=(SELECT auth.uid()) AND (SELECT auth.jwt()->>'is_anonymous')='false');
CREATE POLICY tasks_writer_read ON metis.tasks FOR SELECT TO metis_writer
    USING (user_id=(SELECT auth.uid()) AND (SELECT auth.jwt()->>'is_anonymous')='false');
CREATE POLICY tasks_writer_create ON metis.tasks FOR INSERT TO metis_writer
    WITH CHECK (user_id=(SELECT auth.uid()) AND (SELECT auth.jwt()->>'is_anonymous')='false');
CREATE POLICY tasks_writer_rename ON metis.tasks FOR UPDATE TO metis_writer
    USING (user_id=(SELECT auth.uid()) AND deleted_at IS NULL AND (SELECT auth.jwt()->>'is_anonymous')='false')
    WITH CHECK (user_id=(SELECT auth.uid()) AND deleted_at IS NULL AND (SELECT auth.jwt()->>'is_anonymous')='false');

CREATE FUNCTION metis.apply_task_write(
    p_user_id uuid, p_operation_id uuid, p_task_id uuid, p_kind smallint,
    p_expected_revision bigint, p_title text, p_fingerprint char(64)
) RETURNS TABLE(outcome text, applied_revision bigint)
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,metis,auth AS $$
DECLARE
    existing metis.task_operations%ROWTYPE;
    resulting_revision bigint;
BEGIN
    IF p_user_id IS NULL OR p_user_id <> auth.uid() OR p_operation_id IS NULL OR p_task_id IS NULL
       OR p_operation_id='00000000-0000-0000-0000-000000000000'::uuid
       OR p_task_id='00000000-0000-0000-0000-000000000000'::uuid
       OR p_kind NOT IN (0,1) OR p_fingerprint !~ '^[0-9A-F]{64}$'
       OR char_length(p_title) NOT BETWEEN 1 AND 200 OR p_title<>btrim(p_title) OR p_title~'[[:cntrl:]]'
       OR (p_kind=0 AND p_expected_revision<>0) OR (p_kind=1 AND p_expected_revision<=0) THEN
        RETURN QUERY SELECT 'invalid'::text,NULL::bigint; RETURN;
    END IF;

    -- Serialize the same account/operation pair before checking the immutable journal.
    PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text||':'||p_operation_id::text,0));
    SELECT * INTO existing FROM metis.task_operations
      WHERE user_id=p_user_id AND operation_id=p_operation_id;
    IF FOUND THEN
        RETURN QUERY SELECT CASE WHEN existing.fingerprint=p_fingerprint THEN 'replay' ELSE 'operation_conflict' END,
          CASE WHEN existing.fingerprint=p_fingerprint THEN existing.applied_revision ELSE NULL END;
        RETURN;
    END IF;

    IF p_kind=0 THEN
        INSERT INTO metis.tasks(user_id,id,title) VALUES(p_user_id,p_task_id,p_title)
          ON CONFLICT (user_id,id) DO NOTHING RETURNING revision INTO resulting_revision;
        IF resulting_revision IS NULL THEN RETURN QUERY SELECT 'conflict'::text,NULL::bigint; RETURN; END IF;
    ELSE
        UPDATE metis.tasks SET title=p_title
          WHERE user_id=p_user_id AND id=p_task_id AND deleted_at IS NULL AND revision=p_expected_revision
          RETURNING revision INTO resulting_revision;
        IF resulting_revision IS NULL THEN
            RETURN QUERY SELECT CASE WHEN EXISTS(SELECT 1 FROM metis.tasks WHERE user_id=p_user_id AND id=p_task_id AND deleted_at IS NULL)
              THEN 'conflict' ELSE 'not_found' END,NULL::bigint; RETURN;
        END IF;
    END IF;

    INSERT INTO metis.task_operations(user_id,operation_id,fingerprint,task_id,kind,applied_revision)
      VALUES(p_user_id,p_operation_id,p_fingerprint,p_task_id,p_kind,resulting_revision);
    RETURN QUERY SELECT CASE WHEN p_kind=0 THEN 'created' ELSE 'renamed' END,resulting_revision;
END;
$$;

REVOKE ALL ON metis.task_operations FROM PUBLIC,anon,authenticated,service_role,metis_reader;
REVOKE ALL ON FUNCTION metis.apply_task_write(uuid,uuid,uuid,smallint,bigint,text,char) FROM PUBLIC,anon,authenticated,service_role,metis_reader;
GRANT USAGE ON SCHEMA metis,auth TO metis_writer;
GRANT SELECT ON metis.tasks,metis.task_operations,metis.schema_migrations,metis.installation TO metis_writer;
GRANT INSERT(user_id,id,title) ON metis.tasks TO metis_writer;
GRANT UPDATE(title) ON metis.tasks TO metis_writer;
GRANT INSERT(user_id,operation_id,fingerprint,task_id,kind,applied_revision) ON metis.task_operations TO metis_writer;
GRANT EXECUTE ON FUNCTION auth.uid(),auth.jwt() TO metis_writer;
GRANT EXECUTE ON FUNCTION metis.apply_task_write(uuid,uuid,uuid,smallint,bigint,text,char) TO metis_writer;
INSERT INTO metis.schema_migrations(version,name) VALUES(3,'task_writer');
COMMIT;
