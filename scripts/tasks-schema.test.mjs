import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const migration = await readFile(new URL('../services/api/Database/Migrations/0001_central_tasks.sql', import.meta.url), 'utf8');
const a = '11111111-1111-4111-8111-111111111111';
const b = '22222222-2222-4222-8222-222222222222';
const taskId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const deletedId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const denied = error => error.code === '42501';

test('central schema and RLS on embedded PostgreSQL with synthetic Supabase auth helpers', async t => {
  const db = new PGlite();
  try {
    // Only the Supabase-managed auth schema/functions/roles are fixtures. The task migration
    // and PostgreSQL permission engine are real. No network account or local user data.
    await db.exec(`
      CREATE ROLE anon NOLOGIN;
      CREATE ROLE authenticated NOLOGIN;
      CREATE ROLE service_role NOLOGIN BYPASSRLS;
      CREATE SCHEMA auth;
      CREATE TABLE auth.users(id uuid PRIMARY KEY);
      CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS
        $$ SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
        $$ SELECT (auth.jwt()->>'sub')::uuid $$;
      GRANT USAGE ON SCHEMA auth TO authenticated;
    `);
    await db.query('INSERT INTO auth.users VALUES ($1),($2)', [a, b]);
    await db.exec(migration);
    const admin = async () => { await db.exec('RESET ROLE'); };
    const account = async claims => {
      await admin();
      await db.query("SELECT set_config('request.jwt.claims',$1,false)", [JSON.stringify(claims)]);
      await db.exec('SET ROLE authenticated');
      assert.equal((await db.query('SELECT current_user')).rows[0].current_user, 'authenticated');
    };
    await db.query('INSERT INTO metis.tasks(user_id,id,title) VALUES ($1,$2,$3),($4,$2,$5),($1,$6,$7)',
      [a, taskId, 'Account A task', b, 'Account B task', deletedId, 'Deleted A task']);
    await db.query('UPDATE metis.tasks SET deleted_at=clock_timestamp() WHERE user_id=$1 AND id=$2', [a, deletedId]);

    await t.test('owner read partition and tombstone exclusion', async () => {
      await account({ sub: a, is_anonymous: false });
      const rows = (await db.query('SELECT title FROM metis.tasks ORDER BY id')).rows;
      assert.deepEqual(rows, [{ title: 'Account A task' }]);
      assert.equal((await db.query('SELECT id FROM metis.tasks WHERE user_id=$1', [b])).rows.length, 0);
      await account({ sub: b, is_anonymous: false });
      assert.deepEqual((await db.query('SELECT title FROM metis.tasks')).rows, [{ title: 'Account B task' }]);
    });
    await t.test('missing identity, anonymous account and missing anonymous claim read no rows', async () => {
      for (const claims of [{}, { sub: a, is_anonymous: true }, { sub: a }]) {
        await account(claims);
        assert.equal((await db.query('SELECT * FROM metis.tasks')).rows.length, 0);
      }
    });
    await t.test('anon and service_role receive no grants; authenticated cannot inspect migration journal', async () => {
      await admin(); await db.exec('SET ROLE anon');
      await assert.rejects(db.query('SELECT * FROM metis.tasks'), denied);
      await admin(); await db.exec('SET ROLE service_role');
      await assert.rejects(db.query('SELECT * FROM metis.tasks'), denied);
      await account({ sub: a, is_anonymous: false });
      await assert.rejects(db.query('SELECT * FROM metis.schema_migrations'), denied);
    });
    await t.test('authenticated client has no insert, update or delete access', async () => {
      await account({ sub: a, is_anonymous: false });
      await assert.rejects(db.query('INSERT INTO metis.tasks(user_id,id,title) VALUES ($1,$2,$3)', [a, taskId, 'blocked']), denied);
      await assert.rejects(db.query('UPDATE metis.tasks SET title=$1', ['blocked']), denied);
      await assert.rejects(db.query('DELETE FROM metis.tasks'), denied);
    });
    await t.test('server owns revision/timestamps and rejects owner/id reassignment', async () => {
      await admin();
      const before = (await db.query('SELECT * FROM metis.tasks WHERE user_id=$1 AND id=$2', [a, taskId])).rows[0];
      assert.equal(Number(before.revision), 1);
      const after = (await db.query("UPDATE metis.tasks SET title=$3,revision=999,created_at='2001-01-01' WHERE user_id=$1 AND id=$2 RETURNING *", [a, taskId, 'Updated A'])).rows[0];
      assert.equal(Number(after.revision), 2);
      assert.deepEqual(after.created_at, before.created_at);
      assert.ok(after.updated_at >= before.updated_at);
      await assert.rejects(db.query('UPDATE metis.tasks SET user_id=$3 WHERE user_id=$1 AND id=$2', [a, taskId, b]), denied);
      await assert.rejects(db.query('UPDATE metis.tasks SET id=$3 WHERE user_id=$1 AND id=$2', [a, taskId, deletedId]), denied);
      const deleted = (await db.query('UPDATE metis.tasks SET deleted_at=NULL WHERE user_id=$1 AND id=$2 RETURNING deleted_at', [a, deletedId])).rows[0];
      assert.notEqual(deleted.deleted_at, null);
    });
    await t.test('constraints reject invalid titles and unknown owners without corrupting data', async () => {
      await admin();
      for (const title of ['', ' ', 'a'.repeat(201), 'bad\nvalue']) {
        await assert.rejects(db.query('UPDATE metis.tasks SET title=$3 WHERE user_id=$1 AND id=$2', [a, taskId, title]), error => error.code === '23514');
      }
      await assert.rejects(db.query('INSERT INTO metis.tasks(user_id,id,title) VALUES ($1,$2,$3)', [taskId, deletedId, 'No user']), error => error.code === '23503');
      assert.equal((await db.query('SELECT count(*)::int AS count FROM metis.tasks')).rows[0].count, 3);
    });
    await t.test('re-running the migration fails without resetting existing records', async () => {
      await admin();
      await assert.rejects(db.exec(migration), error => error.code === '42P06');
      await db.exec('ROLLBACK');
      assert.equal((await db.query('SELECT count(*)::int AS count FROM metis.tasks')).rows[0].count, 3);
      const flags = (await db.query("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='metis.tasks'::regclass")).rows[0];
      assert.deepEqual(flags, { relrowsecurity: true, relforcerowsecurity: true });
    });
  } finally { await db.close(); }
});
