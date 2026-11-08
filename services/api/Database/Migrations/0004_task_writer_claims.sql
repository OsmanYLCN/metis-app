-- M0.16: keep the restricted writer independent from Supabase's protected auth schema.
BEGIN;

DROP POLICY task_operations_writer_own ON metis.task_operations;
DROP POLICY tasks_writer_read ON metis.tasks;
DROP POLICY tasks_writer_create ON metis.tasks;
DROP POLICY tasks_writer_rename ON metis.tasks;

CREATE POLICY task_operations_writer_own ON metis.task_operations FOR ALL TO metis_writer
    USING (user_id=((coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb->>'sub')::uuid)
        AND (coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb->>'role')='authenticated'
        AND (coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb->>'is_anonymous')='false')
    WITH CHECK (user_id=((coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb->>'sub')::uuid)
        AND (coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb->>'role')='authenticated'
        AND (coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb->>'is_anonymous')='false');
CREATE POLICY tasks_writer_read ON metis.tasks FOR SELECT TO metis_writer
    USING (user_id=((coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb->>'sub')::uuid)
        AND (coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb->>'role')='authenticated'
        AND (coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb->>'is_anonymous')='false');
CREATE POLICY tasks_writer_create ON metis.tasks FOR INSERT TO metis_writer
    WITH CHECK (user_id=((coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb->>'sub')::uuid)
        AND (coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb->>'role')='authenticated'
        AND (coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb->>'is_anonymous')='false');
CREATE POLICY tasks_writer_rename ON metis.tasks FOR UPDATE TO metis_writer
    USING (user_id=((coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb->>'sub')::uuid)
        AND deleted_at IS NULL
        AND (coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb->>'role')='authenticated'
        AND (coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb->>'is_anonymous')='false')
    WITH CHECK (user_id=((coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb->>'sub')::uuid)
        AND deleted_at IS NULL
        AND (coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb->>'role')='authenticated'
        AND (coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb->>'is_anonymous')='false');

CREATE OR REPLACE FUNCTION metis.apply_task_write(
    p_user_id uuid, p_operation_id uuid, p_task_id uuid, p_kind smallint,
    p_expected_revision bigint, p_title text, p_fingerprint char(64)
) RETURNS TABLE(outcome text, applied_revision bigint)
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,metis AS $$
DECLARE
    existing metis.task_operations%ROWTYPE;
    resulting_revision bigint;
    request_claims jsonb := coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb;
BEGIN
    IF p_user_id IS NULL OR p_user_id <> ((request_claims->>'sub')::uuid)
       OR (request_claims->>'role')<>'authenticated' OR (request_claims->>'is_anonymous')<>'false'
       OR p_operation_id IS NULL OR p_task_id IS NULL
       OR p_operation_id='00000000-0000-0000-0000-000000000000'::uuid
       OR p_task_id='00000000-0000-0000-0000-000000000000'::uuid
       OR p_kind NOT IN (0,1) OR p_fingerprint !~ '^[0-9A-F]{64}$'
       OR char_length(p_title) NOT BETWEEN 1 AND 200 OR p_title<>btrim(p_title) OR p_title~'[[:cntrl:]]'
       OR (p_kind=0 AND p_expected_revision<>0) OR (p_kind=1 AND p_expected_revision<=0) THEN
        RETURN QUERY SELECT 'invalid'::text,NULL::bigint; RETURN;
    END IF;

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

REVOKE USAGE ON SCHEMA auth FROM metis_writer;
REVOKE EXECUTE ON FUNCTION auth.uid(),auth.jwt() FROM metis_writer;
INSERT INTO metis.schema_migrations(version,name) VALUES(4,'task_writer_claims');
COMMIT;
