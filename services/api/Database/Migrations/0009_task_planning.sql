-- Run once after 0008. No local records are uploaded.
BEGIN;
ALTER TABLE metis.tasks ADD COLUMN project_id uuid, ADD COLUMN due_date date,
 ADD COLUMN priority smallint NOT NULL DEFAULT 0 CHECK(priority BETWEEN 0 AND 3),
 ADD CONSTRAINT task_project_owner FOREIGN KEY(user_id,project_id) REFERENCES metis.workspace_entries(user_id,id),
 ADD CONSTRAINT task_due_range CHECK(due_date IS NULL OR due_date BETWEEN DATE '0001-01-01' AND DATE '9999-12-31');
CREATE INDEX tasks_project_link ON metis.tasks(user_id,project_id) WHERE deleted_at IS NULL AND project_id IS NOT NULL;
CREATE TABLE metis.task_plan_operations (
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 operation_id uuid NOT NULL,request jsonb NOT NULL,applied_revision bigint NOT NULL CHECK(applied_revision>0),PRIMARY KEY(user_id,operation_id)
);
ALTER TABLE metis.task_plan_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE metis.task_plan_operations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON metis.task_plan_operations FROM PUBLIC,anon,authenticated,service_role,metis_reader,metis_writer;

CREATE FUNCTION metis.apply_task_plan(p_user uuid,p_operation uuid,p_id uuid,p_kind text,p_action text,p_expected bigint,p_payload jsonb)
RETURNS TABLE(outcome text,applied_revision bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE claims jsonb:=coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb;
 req jsonb; receipt metis.task_plan_operations%ROWTYPE; task metis.tasks%ROWTYPE; project uuid; rev bigint;
BEGIN
 IF session_user<>'metis_writer' OR p_user IS NULL OR p_user IS DISTINCT FROM (claims->>'sub')::uuid
 OR (claims->>'role') IS DISTINCT FROM 'authenticated' OR (claims->>'is_anonymous') IS DISTINCT FROM 'false'
 OR p_operation IS NULL OR p_operation='00000000-0000-0000-0000-000000000000'
 OR p_id IS NULL OR p_id='00000000-0000-0000-0000-000000000000'
 OR p_kind IS DISTINCT FROM 'taskPlan' OR p_action IS DISTINCT FROM 'update' OR p_expected IS NULL OR p_expected<1
 OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN RETURN QUERY SELECT 'invalid'::text,NULL::bigint; RETURN; END IF;
 IF NOT (p_payload ?& ARRAY['projectId','dueDate','priority']) OR (SELECT count(*) FROM jsonb_object_keys(p_payload))<>3
 OR jsonb_typeof(p_payload->'priority') IS DISTINCT FROM 'number'
 OR NOT ((p_payload->>'priority')::numeric BETWEEN 0 AND 3 AND (p_payload->>'priority')::numeric=trunc((p_payload->>'priority')::numeric))
 OR NOT (p_payload->'dueDate'='null'::jsonb OR (jsonb_typeof(p_payload->'dueDate')='string' AND metis.valid_record_date(p_payload->>'dueDate')))
 OR NOT (p_payload->'projectId'='null'::jsonb OR (jsonb_typeof(p_payload->'projectId')='string' AND p_payload->>'projectId' ~ '^[0-9a-f]{32}$'
 AND p_payload->>'projectId'<>'00000000000000000000000000000000')) THEN RETURN QUERY SELECT 'invalid'::text,NULL::bigint; RETURN; END IF;
 project:=(p_payload->>'projectId')::uuid;
 req:=jsonb_build_object('id',p_id,'expectedRevision',p_expected,'payload',p_payload);
 -- Same lock as project edits/deletion: project validation cannot race with detach.
 PERFORM pg_advisory_xact_lock(hashtextextended('workspace:'||p_user::text,0));
 SELECT * INTO receipt FROM metis.task_plan_operations WHERE user_id=p_user AND operation_id=p_operation;
 IF FOUND THEN RETURN QUERY SELECT CASE WHEN receipt.request=req THEN 'replay' ELSE 'operation_conflict' END,
 CASE WHEN receipt.request=req THEN receipt.applied_revision ELSE NULL END; RETURN; END IF;
 IF project IS NOT NULL AND NOT EXISTS(SELECT 1 FROM metis.workspace_entries
 WHERE user_id=p_user AND id=project AND kind='project' AND deleted_at IS NULL) THEN RETURN QUERY SELECT 'project_not_found'::text,NULL::bigint; RETURN; END IF;
 SELECT * INTO task FROM metis.tasks WHERE user_id=p_user AND id=p_id FOR UPDATE;
 IF NOT FOUND OR task.deleted_at IS NOT NULL THEN RETURN QUERY SELECT 'not_found'::text,NULL::bigint; RETURN; END IF;
 IF task.revision<>p_expected OR p_expected=9223372036854775807 THEN RETURN QUERY SELECT 'conflict'::text,NULL::bigint; RETURN; END IF;
 UPDATE metis.tasks SET project_id=project,due_date=(p_payload->>'dueDate')::date,priority=(p_payload->>'priority')::numeric::smallint
 WHERE user_id=p_user AND id=p_id RETURNING revision INTO rev;
 INSERT INTO metis.task_plan_operations VALUES(p_user,p_operation,req,rev);
 RETURN QUERY SELECT 'applied'::text,rev;
END; $$;
REVOKE ALL ON FUNCTION metis.apply_task_plan(uuid,uuid,uuid,text,text,bigint,jsonb) FROM PUBLIC,anon,authenticated,service_role,metis_reader;
GRANT EXECUTE ON FUNCTION metis.apply_task_plan(uuid,uuid,uuid,text,text,bigint,jsonb) TO metis_writer;

-- Detach BEFORE the project's capture trigger takes the account change-head lock.
-- Task mutations take task row then head, avoiding a reversed head->task lock order.
CREATE FUNCTION metis.detach_project_tasks() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF OLD.kind='project' AND OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
  PERFORM 1 FROM metis.tasks WHERE user_id=OLD.user_id AND project_id=OLD.id AND deleted_at IS NULL ORDER BY id FOR UPDATE;
  UPDATE metis.tasks SET project_id=NULL WHERE user_id=OLD.user_id AND project_id=OLD.id AND deleted_at IS NULL;
 END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION metis.detach_project_tasks() FROM PUBLIC,anon,authenticated,service_role,metis_reader,metis_writer;
CREATE TRIGGER workspace_detach_tasks BEFORE UPDATE ON metis.workspace_entries FOR EACH ROW EXECUTE FUNCTION metis.detach_project_tasks();
CREATE OR REPLACE FUNCTION metis.capture_task_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE next_position bigint;
BEGIN
    INSERT INTO metis.change_heads(user_id,position) VALUES(NEW.user_id,1)
    ON CONFLICT(user_id) DO UPDATE SET position=metis.change_heads.position+1
    RETURNING position INTO next_position;
    INSERT INTO metis.changes(user_id,position,entity,entity_id,revision,deleted,snapshot)
    VALUES(NEW.user_id,next_position,'task',NEW.id,NEW.revision,NEW.deleted_at IS NOT NULL,
        jsonb_build_object('id',NEW.id,'title',NEW.title,'completed',NEW.completed,
            'revision',NEW.revision,'createdAt',NEW.created_at,'updatedAt',NEW.updated_at,'deletedAt',NEW.deleted_at,'projectId',NEW.project_id,'dueDate',to_char(NEW.due_date,'YYYY-MM-DD'),'priority',NEW.priority));
    RETURN NEW;
END;
$$;
INSERT INTO metis.schema_migrations(version,name) VALUES(9,'task_planning');
COMMIT;
