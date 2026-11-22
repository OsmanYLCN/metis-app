import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { readFile, mkdtemp, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import assert from 'node:assert/strict';
await mkdir('test-results',{recursive:true});
const directory=await mkdtemp('test-results/pg-domains-');
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
  for(const file of ['0001_central_tasks.sql','0002_task_reader.sql','0003_task_writer.sql','0004_task_writer_claims.sql','0005_task_writer_lifecycle.sql','0006_change_feed.sql','0007_workspace.sql','0008_domain_records.sql'])
    await db.exec(await readFile(new URL('../services/api/Database/Migrations/'+file,import.meta.url),'utf8'));
  // Validate SQL independently: callers cannot bypass domain rules by skipping HTTP.
  const goal={title:'Goal',description:'',state:'active',targetDate:null,progress:0};
  const event={title:'Event',details:'',eventDate:'2028-02-29',startTime:null,endTime:null};
  const finance={title:'Entry',direction:'expense',category:'Test',amountCents:1,entryDate:'2028-02-29',currency:'TRY'};
  const budget={month:'2028-02',category:'Test',limitCents:1,currency:'TRY'};
  for(const [kind,payload,expected] of [
    ['goal',goal,true],['event',event,true],['finance',finance,true],['budget',budget,true],
    ['goal',{...goal,progress:100.5},false],['goal',{...goal,progress:null},false],['goal',{...goal,extra:1},false],
    ['goal',{...goal,targetDate:'0000-01-01'},false],['goal',{...goal,targetDate:'2027-02-29'},false],
    ['event',{...event,startTime:'09:00',endTime:'08:00'},false],['event',{...event,endTime:'10:00'},false],
    ['event',{...event,eventDate:'2028-04-31'},false],['finance',{...finance,amountCents:1.25},false],
    ['finance',{...finance,amountCents:-1},false],['finance',{...finance,currency:'USD'},false],
    ['budget',{...budget,limitCents:0},false],['budget',{...budget,month:'2028-13'},false]
  ]) assert.equal((await db.query('SELECT metis.valid_domain_payload($1,$2::jsonb) AS valid',[kind,JSON.stringify(payload)])).rows[0].valid,expected,kind+' SQL validation');
  await db.exec("INSERT INTO metis.installation VALUES(1,'test-project'); SET SESSION AUTHORIZATION metis_writer");
  // Exercise database validation independently of HTTP; null claims must fail closed.
  const invalid=await db.query("SELECT * FROM metis.apply_workspace_write($1::uuid,$2::uuid,$3::uuid,'note','create',0,'{}'::jsonb)",[a,id,id]);
  assert.equal(invalid.rows[0].outcome,'invalid');
  await assert.rejects(db.exec("INSERT INTO metis.workspace_entries(user_id,id,kind,title,body,state,pinned) VALUES('"+a+"','"+id+"','note','Bypass','','active',false)"));
  const invoke='SELECT * FROM metis.apply_domain_write($1::uuid,$2::uuid,$3::uuid,$4,$5,$6::bigint,$7::jsonb)';
  assert.equal((await db.query(invoke,[a,id,id,'goal','create',0,JSON.stringify(goal)])).rows[0].outcome,'invalid');
  await db.exec('BEGIN');
  await db.query("SELECT set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:a,role:'authenticated',is_anonymous:false})]);
  assert.equal((await db.query(invoke,[b,id,id,'goal','create',0,JSON.stringify(goal)])).rows[0].outcome,'invalid');
  assert.equal((await db.query(invoke,[a,id,id,'goal','create',0,JSON.stringify(goal)])).rows[0].outcome,'applied');
  await db.exec('ROLLBACK'); // Later exact counts prove counter/record/receipt rollback together.
  server=new PGLiteSocketServer({db,host:'127.0.0.1',port:0,maxConnections:4,inspect:false});await server.start();
  const port=new URL(`postgres://${server.getServerConn()}`).port;
  child=spawn('dotnet',['run','--project','tests/api/PersonalOS.Api.Tests.csproj','--configuration','Release','--no-build'],{
    windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,METIS_TEST_WORKSPACE_PORT:port,METIS_TEST_DOMAIN_PORT:port}});
  let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);
  const timer=setTimeout(()=>child.kill(),45000);let code;
  try{[code]=await once(child,'exit');}finally{clearTimeout(timer);}
  if(code!==0)throw new Error(output.slice(-6000));
  console.log(output.split(/\r?\n/).filter(line=>/PASS workspace|PASS domain|checks passed/.test(line)).join('\n'));
  await server.stop();server=undefined;
  await db.close();db=await PGlite.create(directory);
  assert.equal(Number((await db.query('SELECT count(*) AS n FROM metis.workspace_operations')).rows[0].n),6);
  assert.equal(Number((await db.query('SELECT count(*) AS n FROM metis.changes')).rows[0].n),22);
  assert.equal(Number((await db.query('SELECT count(*) AS n FROM metis.domain_operations')).rows[0].n),16);
  await db.exec('SET SESSION AUTHORIZATION metis_reader; BEGIN');
  await db.query("SELECT set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:a,role:'authenticated',is_anonymous:false})]);
  const changes=(await db.query("SELECT position,entity,deleted,snapshot FROM metis.changes WHERE entity IN ('note','project') ORDER BY position")).rows;
  assert.deepEqual(changes.map(r=>Number(r.position)),[1,2,3,4,5]);
  assert.deepEqual(changes.map(r=>r.entity),['note','note','note','project','project']);
  assert.equal(changes[2].deleted,true);assert.equal(changes[0].snapshot.title,'Note');
  assert.equal(changes[4].snapshot.state,'done');
  assert.equal((await db.query('SELECT * FROM metis.workspace_entries')).rows.length,2);
  const domainRows=(await db.query('SELECT kind,revision,deleted_at,payload FROM metis.domain_records ORDER BY kind')).rows;
  assert.equal(domainRows.length,4);assert.ok(domainRows.every(r=>Number(r.revision)===3 && r.deleted_at!==null));
  const positions=(await db.query('SELECT position FROM metis.changes ORDER BY position')).rows.map(r=>Number(r.position));
  assert.deepEqual(positions,Array.from({length:17},(_,i)=>i+1));
  await db.exec('ROLLBACK');
  console.log('PASS domain SQL: independent payload rules, rollback, claims, account RLS, shared ordered feed, immutable snapshots and exact receipts');
} finally {
  if(child && child.exitCode===null){const done=once(child,'exit');child.kill();await done;}
  await server?.stop();await db.close();
}
