// Write the API description to packages/api-client/openapi.json (the source
// for the generated client types). Run after changing any route.
import fsp from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from '../src/config.ts';
import { createServer } from '../src/app.ts';

const server = createServer(loadConfig({ ...process.env, ARCADEDB_PASSWORD: 'unused' }));
const res = { json: (v: unknown) => v } as never;
const route = server.api.routes.find(r => r.path === '/api/openapi.json')!;
const spec = await route.handler({ res } as never);
server.jobs.stop();
const out = path.resolve(import.meta.dirname, '../../../packages/api-client/openapi.json');
await fsp.mkdir(path.dirname(out), { recursive: true });
await fsp.writeFile(out, JSON.stringify(spec, null, 2) + '\n');
console.log(`Wrote ${out} (${Object.keys((spec as { paths: object }).paths).length} paths)`);
