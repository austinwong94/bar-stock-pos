import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runIntegrationTests } from '../supabase/tests/integration.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function runDatabaseRegression(connectionString) {
  const url = new URL(connectionString);
  if (!['localhost', '127.0.0.1', '::1', '[::1]', 'postgres'].includes(url.hostname)) {
    throw new Error('Regression tests only accept a local PostgreSQL server, never live Supabase.');
  }
  const name = 'lp_test_' + randomUUID().replaceAll('-', '');
  const admin = new pg.Client({connectionString});
  const testUrl = new URL(url);
  testUrl.pathname = '/' + name;
  const connect = async () => {const client = new pg.Client({connectionString:testUrl.toString()}); await client.connect(); return client;};
  let db, created = false;
  await admin.connect();
  try {
    await admin.query('create database ' + name);
    created = true;
    db = await connect();
    await db.query(await readFile(path.join(root, 'supabase/tests/harness.sql'), 'utf8'));
    const migrations = (await readdir(path.join(root, 'supabase/migrations'))).filter(name=>name.endsWith('.sql')).sort();
    for (const migration of migrations) {
      try { await db.query(await readFile(path.join(root, 'supabase/migrations', migration), 'utf8')); }
      catch (error) {throw new Error('Migration failed: ' + migration, {cause:error});}
    }
    console.log('Applied ' + migrations.length + ' migrations to a fresh, isolated test database.');
    await db.query(await readFile(path.join(root, 'supabase/tests/seed_test.sql'), 'utf8'));
    await runIntegrationTests(db, connect);
  } finally {
    if (db) await db.end();
    if (created) await admin.query('drop database ' + name);
    await admin.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await runDatabaseRegression(process.env.TEST_PG_URL || 'postgres://postgres:postgres@127.0.0.1:5432/postgres'); }
  catch (error) {console.error(error, error.cause ?? ''); process.exitCode=1;}
}
