-- Run once after 0006; no passwords or installation values to edit.
BEGIN;
ALTER TABLE metis.changes DROP CONSTRAINT changes_entity_check;
ALTER TABLE metis.changes ADD CONSTRAINT changes_entity_check CHECK(entity IN ('task','project','note'));
CREATE TABLE metis.workspace_entries (
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 id uuid NOT NULL CHECK(id<>'00000000-0000-0000-0000-000000000000'),
 kind text NOT NULL CHECK(kind IN ('note','project')),
 title text NOT NULL CHECK(char_length(title) BETWEEN 1 AND 200 AND title=btrim(title) AND title !~ '[[:cntrl:]]'),
 body text NOT NULL CHECK(char_length(body)<=20000 AND translate(body,E'\n\r\t','') !~ '[[:cntrl:]]'),
 state text NOT NULL, pinned boolean NOT NULL,
 revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(), deleted_at timestamptz,
 PRIMARY KEY(user_id,id),
 CHECK((kind='note' AND state='active') OR (kind='project' AND NOT pinned AND state IN ('active','paused','done')))
);
CREATE TABLE metis.workspace_operations (
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 operation_id uuid NOT NULL, request jsonb NOT NULL, applied_revision bigint NOT NULL CHECK(applied_revision>0),
 PRIMARY KEY(user_id,operation_id)
);
ALTER TABLE metis.workspace_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE metis.workspace_entries FORCE ROW LEVEL SECURITY;
ALTER TABLE metis.workspace_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE metis.workspace_operations FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_read ON metis.workspace_entries FOR SELECT TO metis_reader
 USING(user_id=(SELECT auth.uid()) AND (SELECT auth.jwt()->>'role')='authenticated'
 AND (SELECT auth.jwt()->>'is_anonymous')='false');
REVOKE ALL ON metis.workspace_entries,metis.workspace_operations FROM PUBLIC,anon,authenticated,service_role,metis_reader,metis_writer;
GRANT SELECT ON metis.workspace_entries TO metis_reader;

CREATE FUNCTION metis.capture_workspace_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE pos bigint;
BEGIN
 INSERT INTO metis.change_heads(user_id,position) VALUES(NEW.user_id,1)
 ON CONFLICT(user_id) DO UPDATE SET position=metis.change_heads.position+1 RETURNING position INTO pos;
 INSERT INTO metis.changes(user_id,position,entity,entity_id,revision,deleted,snapshot)
 VALUES(NEW.user_id,pos,NEW.kind,NEW.id,NEW.revision,NEW.deleted_at IS NOT NULL,
 jsonb_build_object('id',NEW.id,'kind',NEW.kind,'title',NEW.title,'body',NEW.body,'state',NEW.state,'pinned',NEW.pinned,
 'revision',NEW.revision,'createdAt',NEW.created_at,'updatedAt',NEW.updated_at,'deletedAt',NEW.deleted_at));
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION metis.capture_workspace_change() FROM PUBLIC,anon,authenticated,service_role,metis_reader,metis_writer;
CREATE TRIGGER workspace_capture AFTER INSERT OR UPDATE ON metis.workspace_entries
 FOR EACH ROW EXECUTE FUNCTION metis.capture_workspace_change();

-- The login can execute this bounded operation only, never write tables directly.
-- Definer access is restricted by verified transaction claims and explicit owner predicates.
CREATE FUNCTION metis.apply_workspace_write(p_user uuid,p_operation uuid,p_id uuid,p_kind text,p_action text,p_expected bigint,p_payload jsonb)
RETURNS TABLE(outcome text,applied_revision bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE claims jsonb:=coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb;
 req jsonb; receipt metis.workspace_operations%ROWTYPE; current_entry metis.workspace_entries%ROWTYPE; rev bigint; stamp timestamptz;
BEGIN
 IF session_user<>'metis_writer' OR p_user IS NULL OR p_user IS DISTINCT FROM (claims->>'sub')::uuid
 OR (claims->>'role') IS DISTINCT FROM 'authenticated' OR (claims->>'is_anonymous') IS DISTINCT FROM 'false'
 OR p_operation IS NULL OR p_operation='00000000-0000-0000-0000-000000000000'
 OR p_id IS NULL OR p_id='00000000-0000-0000-0000-000000000000'
 OR p_kind IS NULL OR p_kind NOT IN ('note','project') OR p_action IS NULL OR p_action NOT IN ('create','update','delete')
 OR p_expected IS NULL OR (p_action='create' AND p_expected<>0) OR (p_action<>'create' AND p_expected<1)
 OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN
 RETURN QUERY SELECT 'invalid'::text,NULL::bigint; RETURN; END IF;
 IF p_action='delete' THEN
  IF p_payload<>'{}'::jsonb THEN RETURN QUERY SELECT 'invalid'::text,NULL::bigint; RETURN; END IF;
 ELSE
  IF (SELECT count(*) FROM jsonb_object_keys(p_payload))<>4
  OR jsonb_typeof(p_payload->'title') IS DISTINCT FROM 'string' OR jsonb_typeof(p_payload->'body') IS DISTINCT FROM 'string'
  OR jsonb_typeof(p_payload->'state') IS DISTINCT FROM 'string' OR jsonb_typeof(p_payload->'pinned') IS DISTINCT FROM 'boolean'
  OR char_length(p_payload->>'title') NOT BETWEEN 1 AND 200 OR (p_payload->>'title')<>btrim(p_payload->>'title')
  OR (p_payload->>'title')~'[[:cntrl:]]' OR char_length(p_payload->>'body')>20000
  OR translate(p_payload->>'body',E'\n\r\t','')~'[[:cntrl:]]'
  OR NOT ((p_kind='note' AND p_payload->>'state'='active') OR
    (p_kind='project' AND p_payload->>'pinned'='false' AND p_payload->>'state' IN ('active','paused','done'))) THEN
   RETURN QUERY SELECT 'invalid'::text,NULL::bigint; RETURN;
  END IF;
 END IF;
 req:=jsonb_build_object('id',p_id,'kind',p_kind,'action',p_action,'expectedRevision',p_expected,'payload',p_payload);
 -- Account lock also serializes concurrent creates on previously absent IDs.
 PERFORM pg_advisory_xact_lock(hashtextextended('workspace:'||p_user::text,0));
 SELECT * INTO receipt FROM metis.workspace_operations WHERE user_id=p_user AND operation_id=p_operation;
 IF FOUND THEN RETURN QUERY SELECT CASE WHEN receipt.request=req THEN 'replay' ELSE 'operation_conflict' END,
 CASE WHEN receipt.request=req THEN receipt.applied_revision ELSE NULL END; RETURN; END IF;
 SELECT * INTO current_entry FROM metis.workspace_entries WHERE user_id=p_user AND id=p_id FOR UPDATE;
 IF p_action='create' THEN
  IF FOUND THEN RETURN QUERY SELECT 'conflict'::text,NULL::bigint; RETURN; END IF;
  INSERT INTO metis.workspace_entries(user_id,id,kind,title,body,state,pinned)
  VALUES(p_user,p_id,p_kind,p_payload->>'title',p_payload->>'body',p_payload->>'state',(p_payload->>'pinned')::boolean)
  RETURNING revision INTO rev;
 ELSE
  IF NOT FOUND OR current_entry.kind<>p_kind OR current_entry.deleted_at IS NOT NULL THEN RETURN QUERY SELECT 'not_found'::text,NULL::bigint; RETURN; END IF;
  IF current_entry.revision<>p_expected OR p_expected=9223372036854775807 THEN RETURN QUERY SELECT 'conflict'::text,NULL::bigint; RETURN; END IF;
  stamp:=greatest(clock_timestamp(),current_entry.updated_at);
  UPDATE metis.workspace_entries SET
   title=CASE WHEN p_action='delete' THEN title ELSE p_payload->>'title' END,
   body=CASE WHEN p_action='delete' THEN body ELSE p_payload->>'body' END,
   state=CASE WHEN p_action='delete' THEN state ELSE p_payload->>'state' END,
   pinned=CASE WHEN p_action='delete' THEN pinned ELSE (p_payload->>'pinned')::boolean END,
   revision=revision+1,updated_at=stamp,deleted_at=CASE WHEN p_action='delete' THEN stamp ELSE NULL END
  WHERE user_id=p_user AND id=p_id RETURNING revision INTO rev;
 END IF;
 INSERT INTO metis.workspace_operations VALUES(p_user,p_operation,req,rev);
 RETURN QUERY SELECT 'applied'::text,rev;
END; $$;
REVOKE ALL ON FUNCTION metis.apply_workspace_write(uuid,uuid,uuid,text,text,bigint,jsonb) FROM PUBLIC,anon,authenticated,service_role,metis_reader;
GRANT EXECUTE ON FUNCTION metis.apply_workspace_write(uuid,uuid,uuid,text,text,bigint,jsonb) TO metis_writer;
INSERT INTO metis.schema_migrations(version,name) VALUES(7,'workspace');
COMMIT;
