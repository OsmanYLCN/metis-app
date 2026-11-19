import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import assert from 'node:assert/strict';
const db=await PGlite.create();
let server, child;
const a='11111111-1111-4111-8111-111111111111', b='22222222-2222-4222-8222-222222222222';
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
try {
  await db.exec(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT (auth.jwt()->>'sub')::uuid $$;
    INSERT INTO auth.users VALUES('${a}'),('${b}');`);
  for(const file of ['0001_central_tasks.sql','0002_task_reader.sql','0003_task_writer.sql','0004_task_writer_claims.sql','0005_task_writer_lifecycle.sql'])
    await db.exec(await readFile(new URL('../services/api/Database/Migrations/'+file,import.meta.url),'utf8'));
  await db.exec(`INSERT INTO metis.installation VALUES(1,'test-project');
    INSERT INTO metis.tasks(user_id,id,title) VALUES('${a}','${id}','Baseline'),('${b}','${id}','Other account');`);
  await db.exec(await readFile(new URL('../services/api/Database/Migrations/0006_change_feed.sql',import.meta.url),'utf8'));
  assert.equal(Number((await db.query('SELECT count(*) AS count FROM metis.changes')).rows[0].count),2);
  await db.exec('SET SESSION AUTHORIZATION metis_writer');
  async function write(operation,kind,revision,title,rollback=false) {
    await db.exec('BEGIN');
    try {
      await db.query("SELECT set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:a,role:'authenticated',is_anonymous:false})]);
      const result=await db.query('SELECT * FROM metis.apply_task_write($1::uuid,$2::uuid,$3::uuid,$4::smallint,$5::bigint,$6::text,$7::char(64))',
        [a,operation,id,kind,revision,title,'A'.repeat(64)]);
      await db.exec(rollback?'ROLLBACK':'COMMIT');return result.rows[0].outcome;
    } catch(error) { await db.exec('ROLLBACK');throw error; }
  }
  assert.equal(await write('aaaaaaaa-0000-4000-8000-000000000001',1,1,'Rolled back',true),'renamed');
  assert.equal(await write('aaaaaaaa-0000-4000-8000-000000000002',1,1,'Updated'),'renamed');
  assert.equal(await write('aaaaaaaa-0000-4000-8000-000000000002',1,1,'Updated'),'replay');
  assert.equal(await write('aaaaaaaa-0000-4000-8000-000000000003',3,2,''),'deleted');
  await assert.rejects(db.exec('DELETE FROM metis.changes'));
  await db.exec('RESET SESSION AUTHORIZATION; SET SESSION AUTHORIZATION metis_reader');
  await db.exec('BEGIN');
  assert.equal((await db.query('SELECT * FROM metis.changes')).rows.length,0);
  await db.query("SELECT set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:a,role:'authenticated',is_anonymous:false})]);
  const rows=(await db.query('SELECT position,revision,deleted FROM metis.changes ORDER BY position')).rows;
  assert.deepEqual(rows.map(row=>Number(row.position)),[1,2,3]);
  assert.deepEqual(rows.map(row=>Number(row.revision)),[1,2,3]);
  assert.equal(rows[2].deleted,true);
  await db.exec('COMMIT');
  server=new PGLiteSocketServer({db,host:'127.0.0.1',port:0,maxConnections:4,inspect:false});await server.start();
  const port=new URL(`postgres://${server.getServerConn()}`).port;
  child=spawn('dotnet',['run','--project','tests/api/PersonalOS.Api.Tests.csproj','--configuration','Release','--no-build'],{
    windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,METIS_TEST_CHANGE_PORT:port}});
  let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);
  const timer=setTimeout(()=>child.kill(),45000);
  let code;try{[code]=await once(child,'exit');}finally{clearTimeout(timer);}
  if(code!==0)throw new Error(output.slice(-6000));
  console.log(output.split(/\r?\n/).filter(line=>/PASS PostgreSQL change|checks passed/.test(line)).join('\n'));
  console.log('PASS change SQL: baseline, RLS, immutable revisions, rollback, replay and tombstone');
} finally {
  if(child && child.exitCode===null){const done=once(child,'exit');child.kill();await done;}
  await server?.stop();await db.close();
}
