// Dedicated disposable PostgreSQL server; never accepts a production connection string.
import {spawn} from 'node:child_process';
import {mkdir,mkdtemp,writeFile,access} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createServer} from 'node:net';

const bin=resolve(process.env.METIS_PG_BIN||'work/postgresql/pgsql/bin');
await access(join(bin,'initdb.exe'));
await mkdir('test-results',{recursive:true});
const directory=await mkdtemp(resolve('test-results/real-postgres-'));
const data=join(directory,'data');
const socket=createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));
const port=socket.address().port;await new Promise(r=>socket.close(r));
function run(file,args,extra={}){
 return new Promise((resolve,reject)=>{
  const child=spawn(file,args,{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,...extra}});
  let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);
  const timer=setTimeout(()=>child.kill(),120000);
  child.on('error',e=>{clearTimeout(timer);reject(e);});
  child.on('exit',code=>{clearTimeout(timer);code===0?resolve(output):reject(new Error(output.slice(-6000)));});
 });
}
const psql=async(file)=>run(join(bin,'psql.exe'),['-X','-h','127.0.0.1','-p',String(port),'-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-f',file]);
let started=false;
try {
 await run(join(bin,'initdb.exe'),['-D',data,'-A','trust','-U','postgres','--no-locale','--encoding=UTF8']);
 await run(join(bin,'pg_ctl.exe'),['-D',data,'-l',join(directory,'server.log'),'-o',`-h 127.0.0.1 -p ${port} -c fsync=on`,'-w','start']);started=true;
 const fixture=join(directory,'fixture.sql');
 await writeFile(fixture,`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
 CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
 CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT (auth.jwt()->>'sub')::uuid $$;
 INSERT INTO auth.users VALUES('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222');`);
 await psql(fixture);
 for(const file of ['0001_central_tasks.sql','0002_task_reader.sql','0003_task_writer.sql','0004_task_writer_claims.sql','0005_task_writer_lifecycle.sql','0006_change_feed.sql','0007_workspace.sql','0008_domain_records.sql','0009_task_planning.sql'])await psql(resolve('services/api/Database/Migrations',file));
 const setup=join(directory,'setup.sql');await writeFile(setup,"INSERT INTO metis.installation VALUES(1,'test-project');");await psql(setup);
 const output=await run('dotnet',['run','--project','tests/api/PersonalOS.Api.Tests.csproj','--configuration','Release','--no-build'],{METIS_TEST_CONCURRENCY_PORT:String(port)});
 const reset=join(directory,'reset-synthetic.sql');
 await writeFile(reset,"TRUNCATE auth.users CASCADE; INSERT INTO auth.users VALUES('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222');");await psql(reset);
 const native=await run('node',['scripts/test-two-clients.mjs'],{METIS_TEST_CONCURRENCY_PORT:String(port),METIS_DUAL_HTTP:'1'});
 const checks=(output+'\n'+native).split(/\r?\n/).filter(line=>line.startsWith('PASS'));
 await writeFile(join(directory,'report.json'),JSON.stringify({time:new Date().toISOString(),engine:'PostgreSQL native multi-session; Npgsql and ASP.NET TestServer; ephemeral JWT keys, no Supabase',checks},null,2));
 console.log(checks.join('\n'));console.log('Report: '+join(directory,'report.json'));
} finally {
 if(started)await run(join(bin,'pg_ctl.exe'),['-D',data,'-m','fast','-w','stop']);
}
