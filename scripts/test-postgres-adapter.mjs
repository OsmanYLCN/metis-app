import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { readFile, mkdtemp, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
await mkdir(path.join(root, 'test-results'), { recursive: true });
const directory = await mkdtemp(path.join(root, 'test-results/pg-adapter-'));
let db = await PGlite.create(directory);
let server;
let child;
async function runChecks(port, blocked = false) {
  child = spawn('dotnet', ['run', '--project', 'tests/api/PersonalOS.Api.Tests.csproj', '--configuration', 'Release', '--no-build'], {
    cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, METIS_TEST_PG_PORT: port, METIS_TEST_PG_BLOCKED: blocked ? '1' : '0' },
  });
  let output = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  const timeout = setTimeout(() => child.kill(), 45_000);
  let code;
  try { [code] = await once(child, 'exit'); }
  finally { clearTimeout(timeout); }
  if (code !== 0) throw new Error(`PostgreSQL adapter checks failed:\n${output.slice(-6000)}`);
  console.log(output.split(/\r?\n/).filter(line => /PASS PostgreSQL|checks passed/.test(line)).join('\n'));
}
try {
  await db.exec(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT (auth.jwt()->>'sub')::uuid $$;
    INSERT INTO auth.users VALUES ('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222');`);
  for (const file of ['0001_central_tasks.sql', '0002_task_reader.sql'])
    await db.exec(await readFile(path.join(root, 'services/api/Database/Migrations', file), 'utf8'));
  await db.exec(`INSERT INTO metis.installation VALUES (1,'test-project');
    INSERT INTO metis.tasks(user_id,id,title) VALUES
      ('11111111-1111-4111-8111-111111111111','00000000-0000-0000-0000-000000000001','A first'),
      ('11111111-1111-4111-8111-111111111111','00000000-0000-0000-0000-000000000002','A second'),
      ('22222222-2222-4222-8222-222222222222','00000000-0000-0000-0000-000000000003','B private'),
      ('11111111-1111-4111-8111-111111111111','00000000-0000-0000-0000-000000000004','Deleted');
    UPDATE metis.tasks SET deleted_at=clock_timestamp() WHERE title='Deleted';
    SET SESSION AUTHORIZATION metis_reader;`);
  server = new PGLiteSocketServer({ db, host: '127.0.0.1', port: 0, maxConnections: 4, inspect: false });
  await server.start();
  let connection = new URL(`postgres://${server.getServerConn()}`);
  await runChecks(connection.port);
  const claims = (await db.query("SELECT current_setting('request.jwt.claims',true) AS claims")).rows[0].claims;
  if (claims && claims !== '{}') throw new Error('Transaction-local claims survived cleanup');
  console.log('PASS: PostgreSQL session has no account claims after adapter disposal.');
  // Corrupt one invariant at a time, only in this isolated synthetic database.
  let restorePrevious = '';
  for (const [label, change, restore] of [
    ['unexpected write grant', 'GRANT UPDATE ON metis.tasks TO metis_reader', 'REVOKE UPDATE ON metis.tasks FROM metis_reader'],
    ['unexpected column write grant', 'GRANT UPDATE(title) ON metis.tasks TO metis_reader', 'REVOKE UPDATE(title) ON metis.tasks FROM metis_reader'],
    ['BYPASSRLS role', 'ALTER ROLE metis_reader BYPASSRLS', 'ALTER ROLE metis_reader NOBYPASSRLS'],
    ['disabled RLS', 'ALTER TABLE metis.tasks DISABLE ROW LEVEL SECURITY', 'ALTER TABLE metis.tasks ENABLE ROW LEVEL SECURITY'],
    ['missing installation binding', 'DELETE FROM metis.installation', "INSERT INTO metis.installation VALUES (1,'test-project')"],
  ]) {
    // Reopen as fixture administrator: socket startup changes PGlite's single backend session.
    await server.stop(); server = undefined;
    await db.close(); db = await PGlite.create(directory);
    await db.exec(`${restorePrevious}; ${change}; SET SESSION AUTHORIZATION metis_reader;`);
    server = new PGLiteSocketServer({ db, host: '127.0.0.1', port: 0, maxConnections: 4, inspect: false });
    await server.start(); connection = new URL(`postgres://${server.getServerConn()}`);
    await runChecks(connection.port, true);
    restorePrevious = restore;
    console.log(`PASS: ${label} rejects reads and readiness.`);
  }
  await server.stop(); server = undefined;
  await runChecks(connection.port, true);
  console.log('PASS: stopped database returns unavailable without private details.');
} finally {
  if (child && child.exitCode === null && child.signalCode === null) { const done = once(child, 'exit'); child.kill(); await done; }
  await server?.stop();
  await db.close();
}
