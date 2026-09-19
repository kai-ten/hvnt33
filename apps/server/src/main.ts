import { loadConfig } from './config.ts';
import { createServer, prepareDatabase } from './app.ts';
import { startWatchScheduler } from './domain/snapshots.ts';
import { connectDatabase } from './seams/database.ts';

// Entry point: `npm start` from the repository root.
const config = loadConfig();
// The built-in database, unless ARCADEDB_URL names another ArcadeDB.
const database = await connectDatabase(config);
if (database) console.log(`Database: built-in ArcadeDB ${database.version}${database.owner ? '' : ' (shared with another hvnt33 process)'}`);
const server = createServer(config);
await prepareDatabase(server.deps.graph);
await server.jobs.start();
startWatchScheduler(server.deps);
server.app.listen(config.port, config.host, () => {
  console.log(`hvnt33 ready at http://${config.host === '127.0.0.1' ? 'localhost' : config.host}:${config.port} (${config.auth} mode)`);
});
// Snapshot replay on its own origin: archived pages' scripts never share one with the API.
server.replay.listen(config.replay.port, config.host, () => {
  console.log(`Snapshot replay at ${config.replay.publicUrl}`);
});
// Tor and the built-in database stop with the server (Tor would also notice by itself).
let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  server.jobs.stop();
  void Promise.allSettled([server.deps.tor.stop(), database?.stop()]).finally(() => process.exit(0));
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, shutdown);
// Run by the desktop app: it asks for a clean stop on every platform (a Windows
// process kill would skip the handlers above).
(process as { parentPort?: { on(event: 'message', fn: (e: { data: unknown }) => void): void } }).parentPort
  ?.on('message', e => { if (e.data === 'shutdown') shutdown(); });
