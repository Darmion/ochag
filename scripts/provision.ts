import {readFile} from 'node:fs/promises';
import {poolFromEnvironment} from '../apps/server/src/db.ts';
const password=process.env.APP_DB_PASSWORD;
if(!password || password.length<20) throw new Error('Set APP_DB_PASSWORD (at least 20 characters) in .env');
const pool=poolFromEnvironment(false),client=await pool.connect();
try {
  await client.query('BEGIN');
  await client.query("SELECT set_config('ttrpg.app_password',$1,true)",[password]);
  await client.query(await readFile(new URL('../db/provision_runtime.sql',import.meta.url),'utf8'));
  await client.query('COMMIT'); console.log('Runtime database role is ready.');
} catch(error) {await client.query('ROLLBACK'); throw error;}
finally {client.release();await pool.end();}
