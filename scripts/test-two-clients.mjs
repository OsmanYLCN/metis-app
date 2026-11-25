// Two real native storage processes; actual PostgreSQL SQL via isolated PGlite.
// No user profiles, credentials, Supabase project, or release package is used.
import {PGlite} from '@electric-sql/pglite';
import {readFile,mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {once} from 'node:events';
import assert from 'node:assert/strict';

const cwd=process.cwd();await mkdir('test-results',{recursive:true});
const root=await mkdtemp(resolve('test-results/dual-client-run-'));
const aRoot=await mkdtemp(join(root,'dual-client-a-')),bRoot=await mkdtemp(join(root,'dual-client-b-'));
const env={...process.env,CARGO_HOME:resolve('work/rust/cargo'),RUSTUP_HOME:resolve('work/rust/rustup')};
const cargo=join(env.CARGO_HOME,'bin','cargo.exe');
async function build(){
 const child=spawn(cargo,['test','--offline','--manifest-path','apps/desktop/src-tauri/Cargo.toml','--no-run','--message-format=json'],{cwd,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
 let output='',errors='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>errors+=d);
 const timeout=setTimeout(()=>child.kill(),180000);let code;try{[code]=await once(child,'exit');}finally{clearTimeout(timeout);}
 if(code!==0)throw new Error(errors.slice(-4000));
 const artifacts=output.split('\n').filter(l=>l.startsWith('{')).map(l=>JSON.parse(l));
 return artifacts.find(v=>v.reason==='compiler-artifact'&&v.profile?.test&&v.executable)?.executable??assert.fail('Native test executable missing');
}
const exe=await build();
function client(directory,http=false){
 const child=spawn(http?'dotnet':exe,http?['tests/api/bin/Release/net10.0/PersonalOS.Api.Tests.dll']:['--exact','storage::dual_client::isolated_client_bridge','--nocapture'],{cwd,env:{...env,METIS_DUAL_CLIENT_ROOT:directory,METIS_TEST_HTTP_BRIDGE:http?'1':''},windowsHide:true,stdio:['pipe','pipe','pipe']});
 let waiting=null,errors='';child.stderr.on('data',d=>errors+=d);
 createInterface({input:child.stdout}).on('line',line=>{
  const index=line.indexOf('METIS_RESULT:');if(index<0)return;
  const response=JSON.parse(line.slice(index+13));if(waiting){clearTimeout(waiting.timer);const {resolve,reject}=waiting;waiting=null;response.ok?resolve(response.value):reject(new Error(JSON.stringify(response.error)));}
 });
 child.on('exit',code=>{if(waiting){clearTimeout(waiting.timer);waiting.reject(new Error('Native client exited '+code+' '+errors));waiting=null;}});
 return {
  call(cmd,args={}){assert.equal(waiting,null);return new Promise((resolve,reject)=>{waiting={resolve,reject,timer:setTimeout(()=>{child.kill();reject(new Error('Native request timed out'));},15000)};child.stdin.write(JSON.stringify({cmd,...args})+'\n');});},
  async close(){if(child.exitCode!==null)return;const done=once(child,'exit');child.stdin.write(JSON.stringify({cmd:'exit'})+'\n');await done;}
 };
}
const account='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',id='a'.repeat(32);
const useHttp=process.env.METIS_DUAL_HTTP==='1';
let a=client(aRoot),b=client(bRoot);const bridge=useHttp?client(root,true):null;const db=useHttp?null:await PGlite.create(join(root,'postgres'));const checks=[];
try{
 if(!useHttp){
 await db.exec(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
 CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
 CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT (auth.jwt()->>'sub')::uuid $$;
 INSERT INTO auth.users VALUES('${account}'),('${other}');`);
 for(const f of ['0001_central_tasks.sql','0002_task_reader.sql','0003_task_writer.sql','0004_task_writer_claims.sql','0005_task_writer_lifecycle.sql','0006_change_feed.sql','0007_workspace.sql','0008_domain_records.sql','0009_task_planning.sql'])
  await db.exec(await readFile(resolve('services/api/Database/Migrations',f),'utf8'));
 await db.exec("INSERT INTO metis.installation VALUES(1,'test-project')");
 }
 const epoch=useHttp?null:(await db.query('SELECT epoch FROM metis.change_feed_config')).rows[0].epoch.replaceAll('-','');
 async function sql(role,user,fn){
  await db.exec('SET SESSION AUTHORIZATION '+role+'; BEGIN');
  try{await db.query("SELECT set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:user,role:'authenticated',is_anonymous:false})]);const result=await fn();await db.exec('COMMIT');return result;}
  catch(e){await db.exec('ROLLBACK');throw e;}finally{await db.exec('RESET SESSION AUTHORIZATION');}
 }
 async function write(op){if(bridge)return await bridge.call('write',{operation:op});return await sql('metis_writer',account,async()=>(
  await db.query('SELECT * FROM metis.apply_workspace_write($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7::jsonb)',[account,op.operationId,op.id,op.entity,op.action,op.expectedRevision,JSON.stringify(op.payload)])
 ).rows[0]);}
 async function acknowledge(c,op,r){await c.call('ack',{id:op.id,operation:op.operationId,revision:Number(r.applied_revision??r.revision)});}
 async function send(c,kind='prepare'){
  const op=await c.call(kind,{id});const r=await write(op);assert.ok(['applied','replay'].includes(r.outcome),JSON.stringify(r));await acknowledge(c,op,r);return op;
 }
 async function feed(c){
  const st=await c.call('status');
  if(bridge){const page=await bridge.call('feed',{cursor:st.cursor});await c.call('stage',{expected:st.cursor,page});return page;}
  const position=st.cursor?st.cursor.split('.').at(-1):'0';
  const rows=await sql('metis_reader',account,async()=> (await db.query('SELECT position,entity,entity_id,revision,deleted,snapshot FROM metis.changes WHERE position>$1 ORDER BY position',[position])).rows);
  const next=rows.length?String(rows.at(-1).position):position;
  const page={contractVersion:1,items:rows.map(r=>({position:String(r.position),entity:r.entity,entityId:r.entity_id,revision:Number(r.revision),deleted:r.deleted,snapshot:r.snapshot})),nextCursor:epoch+'.'+account.replaceAll('-','')+'.'+next,hasMore:false};
  await c.call('stage',{expected:st.cursor,page});return page;
 }
 async function pull(c){await feed(c);return await c.call('merge');}
 async function note(c){return (await c.call('list')).items[0];}
 await a.call('create',{id,title:'Base',body:'Body'});await send(a);await pull(a);await pull(b);
 assert.equal((await note(b)).title,'Base');checks.push('initial replication');
 await b.call('edit',{id,title:'Base',body:'Offline body'});
 await a.call('edit',{id,title:'Remote title',body:'Body'});await send(a);await pull(a);
 assert.equal((await pull(b)).conflicts,0);assert.equal((await note(b)).title,'Remote title');assert.equal((await note(b)).body,'Offline body');
 await send(b);await pull(a);assert.equal((await note(a)).body,'Offline body');checks.push('independent offline edits converge');
 await a.call('edit',{id,title:'A title',body:'Offline body'});await b.call('edit',{id,title:'B title',body:'Offline body'});await send(a);await pull(a);
 assert.equal((await pull(b)).conflicts,1);await assert.rejects(b.call('prepare',{id}));
 const stale=(await b.call('conflicts'))[0];
 await b.call('edit',{id,title:'B final',body:'Offline body'});await assert.rejects(b.call('resolve',{id,digest:stale.digest,choice:'local'}));
 const conflict=(await b.call('conflicts'))[0];await b.call('resolve',{id,digest:conflict.digest,choice:'local'});await send(b);await pull(a);assert.equal((await note(a)).title,'B final');checks.push('same-field conflict, stale preview rejection and explicit resolution');
 await a.call('edit',{id,title:'B final',body:'Lost reply'});const frozen=await a.call('prepare',{id});assert.equal((await write(frozen)).outcome,'applied');
 await a.close();a=client(aRoot);const retry=await a.call('prepare',{id});assert.deepEqual(retry,frozen);
 const replay=await write(retry);assert.equal(replay.outcome,'replay');await acknowledge(a,retry,replay);await pull(a);await pull(b);checks.push('process restart and exactly-once receipt replay');
 await a.call('edit',{id,title:'B final',body:'Uncertain local'});const uncertain=await a.call('prepare',{id});
 await b.call('edit',{id,title:'Next title',body:'Lost reply'});await send(b);await pull(b);
 assert.equal((await pull(a)).deferred,1);assert.equal((await note(a)).body,'Uncertain local');
 assert.equal((await write(uncertain)).outcome,'conflict');await a.call('reject',{id,operation:uncertain.operationId});await pull(a);
 assert.equal((await note(a)).title,'Next title');assert.equal((await note(a)).body,'Uncertain local');await send(a);await pull(a);await pull(b);checks.push('uncertain request retained, definitive rejection rebased');
 await b.call('edit',{id,title:'Next title',body:'Keep this offline edit'});await a.call('delete',{id});await send(a,'delete_prepare');await pull(a);
 assert.equal((await pull(b)).conflicts,1);assert.equal((await note(b)).body,'Keep this offline edit');
 const deleted=(await b.call('conflicts'))[0];assert.equal(deleted.canKeepLocal,false);await assert.rejects(b.call('resolve',{id,digest:deleted.digest,choice:'local'}));
 await b.call('resolve',{id,digest:deleted.digest,choice:'cloud'});assert.equal((await b.call('list')).items.length,0);checks.push('delete/edit conflict never silently deletes local edits');
 const cursor=(await b.call('status')).cursor;await b.close();b=client(bRoot);assert.equal((await b.call('status')).cursor,cursor);assert.equal((await b.call('list')).items.length,0);
 const others=bridge?(await bridge.call('feed',{cursor:'',other:true})).items:await sql('metis_reader',other,async()=>(await db.query('SELECT * FROM metis.changes')).rows);assert.ok(bridge?others.every(v=>v.entityId.replaceAll('-','')!==id):others.length===0);checks.push('persistent cursor and account RLS');
 const report={checks,transport:useHttp?'two native processes / SQLite + actual ASP.NET HTTP pipeline + native PostgreSQL; synthetic JWT keys, same computer, no Supabase':'two native processes / SQLite + real migration SQL in PGlite; no physical second device or live Supabase',createdAt:new Date().toISOString()};
 await writeFile(join(root,'report.json'),JSON.stringify(report,null,2));
 console.log('PASS two isolated clients: '+checks.length+' scenarios');console.log('Report: '+join(root,'report.json'));
}finally{await a.close();await b.close();if(bridge)await bridge.close();if(db)await db.close();}
