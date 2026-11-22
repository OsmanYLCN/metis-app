-- Run once after 0007. Four domain payloads share transactional delivery mechanics.
BEGIN;
CREATE FUNCTION metis.valid_record_date(value text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
BEGIN
 IF value IS NULL OR value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR left(value,4)='0000' THEN RETURN false; END IF;
 RETURN to_char(value::date,'YYYY-MM-DD')=value;
EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN RETURN false;
END; $$;
CREATE FUNCTION metis.valid_record_text(value jsonb,maximum integer,multiline boolean) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT coalesce(jsonb_typeof(value)='string' AND char_length(value#>>'{}')<=maximum AND
 CASE WHEN multiline THEN translate(value#>>'{}',E'\n\r\t','') !~ '[[:cntrl:]]'
 ELSE char_length(value#>>'{}')>0 AND (value#>>'{}')=btrim(value#>>'{}') AND (value#>>'{}') !~ '[[:cntrl:]]' END,false)
$$;
CREATE FUNCTION metis.valid_domain_payload(kind text,p jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE fields text[]; n numeric;
BEGIN
 IF p IS NULL OR jsonb_typeof(p)<>'object' THEN RETURN false; END IF;
 fields:=CASE kind
 WHEN 'goal' THEN ARRAY['title','description','state','targetDate','progress']
 WHEN 'event' THEN ARRAY['title','details','eventDate','startTime','endTime']
 WHEN 'finance' THEN ARRAY['title','direction','category','amountCents','entryDate','currency']
 WHEN 'budget' THEN ARRAY['month','category','limitCents','currency'] ELSE NULL END;
 IF fields IS NULL OR NOT (p ?& fields) OR (SELECT count(*) FROM jsonb_object_keys(p))<>cardinality(fields) THEN RETURN false; END IF;
 IF kind<>'budget' AND NOT metis.valid_record_text(p->'title',200,false) THEN RETURN false; END IF;
 IF kind='goal' THEN
  IF NOT metis.valid_record_text(p->'description',10000,true) OR jsonb_typeof(p->'progress')<>'number' THEN RETURN false; END IF;
  n:=(p->>'progress')::numeric;
  RETURN coalesce(p->>'state' IN ('active','paused','done') AND n=trunc(n) AND n BETWEEN 0 AND 100
   AND ((p->'targetDate')='null'::jsonb OR (jsonb_typeof(p->'targetDate')='string' AND metis.valid_record_date(p->>'targetDate'))),false);
 ELSIF kind='event' THEN
  RETURN coalesce(metis.valid_record_text(p->'details',5000,true) AND metis.valid_record_date(p->>'eventDate')
   AND ((p->'startTime')='null'::jsonb OR (jsonb_typeof(p->'startTime')='string' AND p->>'startTime' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'))
   AND ((p->'endTime')='null'::jsonb OR (jsonb_typeof(p->'endTime')='string' AND p->>'endTime' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    AND jsonb_typeof(p->'startTime')='string' AND p->>'endTime'>p->>'startTime')),false);
 ELSE
  IF NOT metis.valid_record_text(p->'category',60,false) OR p->>'currency' IS DISTINCT FROM 'TRY' THEN RETURN false; END IF;
  IF kind='finance' THEN
   IF jsonb_typeof(p->'amountCents')<>'number' THEN RETURN false; END IF;
   n:=(p->>'amountCents')::numeric;
   RETURN coalesce(n=trunc(n) AND n BETWEEN 1 AND 999999999999 AND p->>'direction' IN ('income','expense') AND metis.valid_record_date(p->>'entryDate'),false);
  ELSE
   IF jsonb_typeof(p->'limitCents')<>'number' THEN RETURN false; END IF;
   n:=(p->>'limitCents')::numeric;
   RETURN coalesce(n=trunc(n) AND n BETWEEN 1 AND 999999999999 AND jsonb_typeof(p->'month')='string'
    AND length(p->>'month')=7 AND metis.valid_record_date((p->>'month')||'-01'),false);
  END IF;
 END IF;
END; $$;
REVOKE ALL ON FUNCTION metis.valid_record_date(text),metis.valid_record_text(jsonb,integer,boolean),metis.valid_domain_payload(text,jsonb)
 FROM PUBLIC,anon,authenticated,service_role,metis_reader,metis_writer;
CREATE TABLE metis.domain_records (
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 id uuid NOT NULL CHECK(id<>'00000000-0000-0000-0000-000000000000'),
 kind text NOT NULL CHECK(kind IN ('goal','event','finance','budget')),
 payload jsonb NOT NULL CHECK(metis.valid_domain_payload(kind,payload)),
 revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),deleted_at timestamptz,
 PRIMARY KEY(user_id,id)
);
-- Budgets have a stable record ID for sync AND a unique active natural key.
CREATE UNIQUE INDEX domain_budget_key ON metis.domain_records(user_id,(payload->>'month'),(payload->>'category'),(payload->>'currency'))
 WHERE kind='budget' AND deleted_at IS NULL;
CREATE TABLE metis.domain_operations (
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 operation_id uuid NOT NULL,request jsonb NOT NULL,applied_revision bigint NOT NULL CHECK(applied_revision>0),PRIMARY KEY(user_id,operation_id)
);
ALTER TABLE metis.domain_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE metis.domain_records FORCE ROW LEVEL SECURITY;
ALTER TABLE metis.domain_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE metis.domain_operations FORCE ROW LEVEL SECURITY;
CREATE POLICY domain_read ON metis.domain_records FOR SELECT TO metis_reader USING
 (user_id=(SELECT auth.uid()) AND (SELECT auth.jwt()->>'role')='authenticated' AND (SELECT auth.jwt()->>'is_anonymous')='false');
REVOKE ALL ON metis.domain_records,metis.domain_operations FROM PUBLIC,anon,authenticated,service_role,metis_reader,metis_writer;
GRANT SELECT ON metis.domain_records TO metis_reader;
ALTER TABLE metis.changes DROP CONSTRAINT changes_entity_check;
ALTER TABLE metis.changes ADD CONSTRAINT changes_entity_check CHECK(entity IN ('task','note','project','goal','event','finance','budget'));
CREATE FUNCTION metis.capture_domain_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE pos bigint;
BEGIN
 INSERT INTO metis.change_heads(user_id,position) VALUES(NEW.user_id,1)
 ON CONFLICT(user_id) DO UPDATE SET position=metis.change_heads.position+1 RETURNING position INTO pos;
 INSERT INTO metis.changes(user_id,position,entity,entity_id,revision,deleted,snapshot)
 VALUES(NEW.user_id,pos,NEW.kind,NEW.id,NEW.revision,NEW.deleted_at IS NOT NULL,
 NEW.payload || jsonb_build_object('id',NEW.id,'kind',NEW.kind,'revision',NEW.revision,'createdAt',NEW.created_at,'updatedAt',NEW.updated_at,'deletedAt',NEW.deleted_at));
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION metis.capture_domain_change() FROM PUBLIC,anon,authenticated,service_role,metis_reader,metis_writer;
CREATE TRIGGER domain_capture AFTER INSERT OR UPDATE ON metis.domain_records FOR EACH ROW EXECUTE FUNCTION metis.capture_domain_change();
CREATE FUNCTION metis.apply_domain_write(p_user uuid,p_operation uuid,p_id uuid,p_kind text,p_action text,p_expected bigint,p_payload jsonb)
RETURNS TABLE(outcome text,applied_revision bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE claims jsonb:=coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb;
 req jsonb; receipt metis.domain_operations%ROWTYPE; current_entry metis.domain_records%ROWTYPE; rev bigint; stamp timestamptz;
BEGIN
 IF session_user<>'metis_writer' OR p_user IS NULL OR p_user IS DISTINCT FROM (claims->>'sub')::uuid
 OR (claims->>'role') IS DISTINCT FROM 'authenticated' OR (claims->>'is_anonymous') IS DISTINCT FROM 'false'
 OR p_operation IS NULL OR p_operation='00000000-0000-0000-0000-000000000000'
 OR p_id IS NULL OR p_id='00000000-0000-0000-0000-000000000000'
 OR p_kind IS NULL OR p_kind NOT IN ('goal','event','finance','budget') OR p_action IS NULL OR p_action NOT IN ('create','update','delete')
 OR p_expected IS NULL OR (p_action='create' AND p_expected<>0) OR (p_action<>'create' AND p_expected<1)
 OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN
 RETURN QUERY SELECT 'invalid'::text,NULL::bigint; RETURN; END IF;
 IF p_action='delete' THEN
  IF p_payload<>'{}'::jsonb THEN RETURN QUERY SELECT 'invalid'::text,NULL::bigint; RETURN; END IF;
 ELSE
  IF NOT metis.valid_domain_payload(p_kind,p_payload) THEN RETURN QUERY SELECT 'invalid'::text,NULL::bigint; RETURN; END IF;
 END IF;
 req:=jsonb_build_object('id',p_id,'kind',p_kind,'action',p_action,'expectedRevision',p_expected,'payload',p_payload);
 -- Account lock also serializes concurrent creates on previously absent IDs.
 PERFORM pg_advisory_xact_lock(hashtextextended('domain:'||p_user::text,0));
 SELECT * INTO receipt FROM metis.domain_operations WHERE user_id=p_user AND operation_id=p_operation;
 IF FOUND THEN RETURN QUERY SELECT CASE WHEN receipt.request=req THEN 'replay' ELSE 'operation_conflict' END,
 CASE WHEN receipt.request=req THEN receipt.applied_revision ELSE NULL END; RETURN; END IF;
 SELECT * INTO current_entry FROM metis.domain_records WHERE user_id=p_user AND id=p_id FOR UPDATE;
 IF p_action='create' THEN
  IF FOUND THEN RETURN QUERY SELECT 'conflict'::text,NULL::bigint; RETURN; END IF;
  INSERT INTO metis.domain_records(user_id,id,kind,payload) VALUES(p_user,p_id,p_kind,p_payload) RETURNING revision INTO rev;
 ELSE
  IF NOT FOUND OR current_entry.kind<>p_kind OR current_entry.deleted_at IS NOT NULL THEN RETURN QUERY SELECT 'not_found'::text,NULL::bigint; RETURN; END IF;
  IF current_entry.revision<>p_expected OR p_expected=9223372036854775807 THEN RETURN QUERY SELECT 'conflict'::text,NULL::bigint; RETURN; END IF;
  stamp:=greatest(clock_timestamp(),current_entry.updated_at);
  UPDATE metis.domain_records SET payload=CASE WHEN p_action='delete' THEN payload ELSE p_payload END,
   revision=revision+1,updated_at=stamp,deleted_at=CASE WHEN p_action='delete' THEN stamp ELSE NULL END
  WHERE user_id=p_user AND id=p_id RETURNING revision INTO rev;
 END IF;
 INSERT INTO metis.domain_operations VALUES(p_user,p_operation,req,rev);
 RETURN QUERY SELECT 'applied'::text,rev;
EXCEPTION WHEN unique_violation THEN
 -- Natural-key conflicts roll back mutation, counter and receipt together.
 RETURN QUERY SELECT 'conflict'::text,NULL::bigint;
END; $$;
REVOKE ALL ON FUNCTION metis.apply_domain_write(uuid,uuid,uuid,text,text,bigint,jsonb) FROM PUBLIC,anon,authenticated,service_role,metis_reader;
GRANT EXECUTE ON FUNCTION metis.apply_domain_write(uuid,uuid,uuid,text,text,bigint,jsonb) TO metis_writer;
INSERT INTO metis.schema_migrations(version,name) VALUES(8,'domain_records');
COMMIT;
