import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { readFile, mkdtemp, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import assert from 'node:assert/strict';
await mkdir('test-results',{recursive:true});
const directory=await mkdtemp('test-results/pg-planning-');
let db=await PGlite.create(directory);
let server, child;
const a='11111111-1111-4111-8111-111111111111', b='22222222-2222-4222-8222-222222222222';
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
try {
  await db.exec(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT (auth.jwt()->>'sub')::uuid $$;
    INSERT INTO auth.users VALUES('${a}'),('${b}');`);
  for(const file of ['0001_central_tasks.sql','0002_task_reader.sql','0003_task_writer.sql','0004_task_writer_claims.sql','0005_task_writer_lifecycle.sql','0006_change_feed.sql','0007_workspace.sql','0008_domain_records.sql','0009_task_planning.sql'])
    await db.exec(await readFile(new URL('../services/api/Database/Migrations/'+file,import.meta.url),'utf8'));
  await db.exec("INSERT INTO metis.installation VALUES(1,'test-project'); SET SESSION AUTHORIZATION metis_writer");
  async function run(read) {
    server=new PGLiteSocketServer({db,host:'127.0.0.1',port:0,maxConnections:4,inspect:false});await server.start();
    const port=new URL(`postgres://${server.getServerConn()}`).port;
    child=spawn('dotnet',['run','--project','tests/api/PersonalOS.Api.Tests.csproj','--configuration','Release','--no-build'],{
      windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,METIS_TEST_PLAN_PORT:port,METIS_TEST_PLAN_READ:read?'1':'0'}});
    let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);
    const timer=setTimeout(()=>child.kill(),45000);let code;
    try{[code]=await once(child,'exit');}finally{clearTimeout(timer);}
    if(code!==0)throw new Error(output.slice(-6000));
    console.log(output.split(/\r?\n/).filter(line=>/PASS task planning|checks passed/.test(line)).join('\n'));
    await server.stop();server=undefined;
  }
  await run(false);
  await db.close();db=await PGlite.create(directory);
  assert.equal(Number((await db.query('SELECT count(*) AS n FROM metis.task_plan_operations')).rows[0].n),1);
  assert.equal(Number((await db.query('SELECT count(*) AS n FROM metis.changes')).rows[0].n),6);
  const row=(await db.query('SELECT project_id,priority,revision,deleted_at FROM metis.tasks')).rows[0];
  assert.equal(row.project_id,null);assert.equal(row.priority,3);assert.equal(Number(row.revision),3);assert.equal(row.deleted_at,null);
  await db.exec('SET SESSION AUTHORIZATION metis_reader');await run(true);
} finally {
  if(child && child.exitCode===null){const done=once(child,'exit');child.kill();await done;}
  await server?.stop();await db.close();
}
