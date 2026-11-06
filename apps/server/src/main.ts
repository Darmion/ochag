import {readFile} from 'node:fs/promises';
import {buildApp} from './app.ts';
import {poolFromEnvironment,postgresDatabase} from './db.ts';
import {closeTunnelListener,createTunnelListener} from './system/network.ts';
import {loadMods} from './system/mods.ts';
import {MIGRATIONS} from '../../../scripts/migrations.ts';
const SCHEMA_VERSION=MIGRATIONS[MIGRATIONS.length-1]![0];
const pool=poolFromEnvironment();
try {
  const {rows}=await pool.query('SELECT max(version) AS version FROM schema_migrations');
  if (Number(rows[0]?.version) !== SCHEMA_VERSION) {
    throw new Error(
      `Database schema must be version ${SCHEMA_VERSION}. Run npm run db:migrate.`,
    );
  }
  const cert=process.env.TLS_CERT_PATH,key=process.env.TLS_KEY_PATH;
  if(Boolean(cert)!==Boolean(key)) throw new Error('Set both TLS_CERT_PATH and TLS_KEY_PATH');
  const host=process.env.HOST ?? '127.0.0.1';
  if(!['127.0.0.1','localhost','::1'].includes(host) && !cert && process.env.ALLOW_INSECURE_LAN!=='true') {
    throw new Error('LAN requires TLS_CERT_PATH/TLS_KEY_PATH or explicit development ALLOW_INSECURE_LAN=true');
  }
  const https=cert && key ? {cert:await readFile(cert),key:await readFile(key)} : undefined;
  const mods=await loadMods(process.env.MODS_DIR,message=>console.log(message),{bundledDir:process.env.BUNDLED_MODS_DIR,enabled:(process.env.MODS_ENABLED ?? '').split(',').filter(Boolean)});
  const app=await buildApp(postgresDatabase(pool),{logger:true,https,mods});
  let closing=false;
  let tunnel: Awaited<ReturnType<typeof createTunnelListener>> | null=null;
  async function shutdown() {if(closing)return; closing=true; if(tunnel) await closeTunnelListener(tunnel); await app.close(); await pool.end();}
  process.once('SIGINT',()=>{void shutdown();}); process.once('SIGTERM',()=>{void shutdown();});
  await app.listen({host,port:Number(process.env.PORT ?? 3000)});
  if (process.env.TUNNEL_PORT) tunnel=await createTunnelListener(app,Number(process.env.TUNNEL_PORT));
} catch(error) {
  console.error(error instanceof Error ? error.message : 'Startup failed');
  await pool.end(); process.exitCode=1;
}
