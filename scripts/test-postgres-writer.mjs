import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { readFile, mkdtemp, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root=fileURLToPath(new URL('../',import.meta.url));
await mkdir(path.join(root,'test-results'),{recursive:true});
const directory=await mkdtemp(path.join(root,'test-results/pg-writer-'));
let db=await PGlite.create(directory);
let server,child;
try{
  await db.exec(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT (auth.jwt()->>'sub')::uuid $$;
    INSERT INTO auth.users VALUES ('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222');`);
  for(const file of ['0001_central_tasks.sql','0002_task_reader.sql','0003_task_writer.sql'])
    await db.exec(await readFile(path.join(root,'services/api/Database/Migrations',file),'utf8'));
  await db.exec(`INSERT INTO metis.installation VALUES(1,'test-project'); SET SESSION AUTHORIZATION metis_writer;`);
  const guard=await db.query(`SELECT current_user,session_user,
    has_table_privilege(current_user,'metis.tasks','SELECT') AS can_read,
    has_column_privilege(current_user,'metis.tasks','title','UPDATE') AS can_rename,
    has_table_privilege(current_user,'metis.tasks','DELETE,TRUNCATE') AS unsafe_write,
    (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid='metis.tasks'::regclass) AS task_rls,
    (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid='metis.task_operations'::regclass) AS operation_rls`);
  if(!guard.rows[0].can_read||!guard.rows[0].can_rename||guard.rows[0].unsafe_write||!guard.rows[0].task_rls||!guard.rows[0].operation_rls)
    throw new Error('Writer fixture permissions are unsafe');
  server=new PGLiteSocketServer({db,host:'127.0.0.1',port:0,maxConnections:4,inspect:false});await server.start();
  const port=new URL(`postgres://${server.getServerConn()}`).port;
  child=spawn('dotnet',['run','--project','tests/api/PersonalOS.Api.Tests.csproj','--configuration','Release','--no-build'],{
    cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,METIS_TEST_PG_WRITER_PORT:port}});
  let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);
  const timer=setTimeout(()=>child.kill(),45000);const [code]=await once(child,'exit');clearTimeout(timer);
  if(code!==0)throw new Error(`PostgreSQL writer checks failed:\n${output.slice(-6000)}`);
  console.log(output.split(/\r?\n/).filter(line=>/PASS PostgreSQL writer|checks passed/.test(line)).join('\n'));
  await server.stop();server=undefined;
  await db.close();db=await PGlite.create(directory);
  const rows=(await db.query("SELECT title,revision FROM metis.tasks WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'")).rows;
  const operations=(await db.query("SELECT count(*)::int AS count FROM metis.task_operations")).rows[0].count;
  if(rows.length!==1||rows[0].title!=='Renamed cloud task'||rows[0].revision!==2n&&rows[0].revision!==2||operations!==2)
    throw new Error('Committed task/journal state is invalid');
  console.log('PASS: committed task revision and exactly two successful operation receipts verified.');
}finally{
  if(child&&child.exitCode===null){const done=once(child,'exit');child.kill();await done;}
  await server?.stop();await db.close();
}
