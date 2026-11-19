-- Run once after 0005. Existing tasks are preserved and seeded into the feed.
BEGIN;
LOCK TABLE metis.tasks IN SHARE ROW EXCLUSIVE MODE;
CREATE TABLE metis.change_feed_config (
    id integer PRIMARY KEY CHECK (id=1), epoch uuid NOT NULL DEFAULT gen_random_uuid()
);
INSERT INTO metis.change_feed_config(id) VALUES(1);
CREATE TABLE metis.change_heads (
    user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    position bigint NOT NULL CHECK (position >= 0)
);
CREATE TABLE metis.changes (
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    position bigint NOT NULL CHECK (position > 0),
    entity text NOT NULL CHECK (entity IN ('task')),
    entity_id uuid NOT NULL, revision bigint NOT NULL CHECK (revision > 0),
    deleted boolean NOT NULL, snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot)='object'),
    PRIMARY KEY(user_id,position), UNIQUE(user_id,entity,entity_id,revision)
);
ALTER TABLE metis.change_heads ENABLE ROW LEVEL SECURITY;
ALTER TABLE metis.change_heads FORCE ROW LEVEL SECURITY;
ALTER TABLE metis.changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE metis.changes FORCE ROW LEVEL SECURITY;
CREATE POLICY change_heads_read ON metis.change_heads FOR SELECT TO metis_reader
    USING (user_id=(SELECT auth.uid()) AND (SELECT auth.jwt()->>'role')='authenticated'
        AND (SELECT auth.jwt()->>'is_anonymous')='false');
CREATE POLICY changes_read ON metis.changes FOR SELECT TO metis_reader
    USING (user_id=(SELECT auth.uid()) AND (SELECT auth.jwt()->>'role')='authenticated'
        AND (SELECT auth.jwt()->>'is_anonymous')='false');
REVOKE ALL ON metis.change_feed_config,metis.change_heads,metis.changes
    FROM PUBLIC,anon,authenticated,service_role,metis_writer;
GRANT SELECT ON metis.change_feed_config,metis.change_heads,metis.changes TO metis_reader;

-- Each account's counter row stays locked until COMMIT. Unlike a sequence,
-- a later committed position can never overtake an uncommitted earlier one.
-- The trigger writes atomically with the existing writer and operation receipt.
CREATE FUNCTION metis.capture_task_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE next_position bigint;
BEGIN
    INSERT INTO metis.change_heads(user_id,position) VALUES(NEW.user_id,1)
    ON CONFLICT(user_id) DO UPDATE SET position=metis.change_heads.position+1
    RETURNING position INTO next_position;
    INSERT INTO metis.changes(user_id,position,entity,entity_id,revision,deleted,snapshot)
    VALUES(NEW.user_id,next_position,'task',NEW.id,NEW.revision,NEW.deleted_at IS NOT NULL,
        jsonb_build_object('id',NEW.id,'title',NEW.title,'completed',NEW.completed,
            'revision',NEW.revision,'createdAt',NEW.created_at,'updatedAt',NEW.updated_at,'deletedAt',NEW.deleted_at));
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION metis.capture_task_change() FROM PUBLIC,anon,authenticated,service_role,metis_reader,metis_writer;
CREATE TRIGGER tasks_capture_change AFTER INSERT OR UPDATE ON metis.tasks
    FOR EACH ROW EXECUTE FUNCTION metis.capture_task_change();

-- Baseline includes historical tombstones. No updates to task revisions or receipts.
INSERT INTO metis.changes(user_id,position,entity,entity_id,revision,deleted,snapshot)
SELECT user_id,row_number() OVER(PARTITION BY user_id ORDER BY id),'task',id,revision,deleted_at IS NOT NULL,
    jsonb_build_object('id',id,'title',title,'completed',completed,'revision',revision,
        'createdAt',created_at,'updatedAt',updated_at,'deletedAt',deleted_at)
FROM metis.tasks;
INSERT INTO metis.change_heads(user_id,position)
SELECT user_id,max(position) FROM metis.changes GROUP BY user_id;
INSERT INTO metis.schema_migrations(version,name) VALUES(6,'change_feed');
COMMIT;
