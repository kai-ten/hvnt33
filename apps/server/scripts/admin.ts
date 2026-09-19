// Workspace and API-token administration for token-mode (hosted) servers.
//   npm run admin -- create-workspace --name "Newsroom" [--plan free]
//   npm run admin -- create-token --workspace ID --user EMAIL [--label L]
//   npm run admin -- revoke-token --id TOKEN_ID
//   npm run admin -- set-plan --workspace ID --plan NAME
//   npm run admin -- workspaces
import { loadConfig } from '../src/config.ts';
import { prepareDatabase } from '../src/app.ts';
import { createWorkspace, issueToken } from '../src/seams/auth.ts';
import { arcadeGraph } from '../src/seams/graph.ts';
import { connectDatabase } from '../src/seams/database.ts';

const config = loadConfig();
const database = await connectDatabase(config);
const graph = arcadeGraph(config.arcade);
const [command, ...args] = process.argv.slice(2);
const flags: Record<string, string> = {};
for (let i = 0; i < args.length; i += 2) flags[args[i].replace(/^--/, '')] = args[i + 1];
const required = (k: string) => { if (!flags[k]) throw Error(`--${k} required`); return flags[k]; };

try {
  await prepareDatabase(graph, () => {});
  let result: unknown;
  if (command === 'create-workspace') {
    const plan = flags.plan || 'unlimited';
    if (!config.plans[plan]) throw Error(`Unknown plan ${plan}. Plans: ${Object.keys(config.plans).join(', ')} (define more in HVNT33_PLANS)`);
    result = await createWorkspace(graph, required('name'), plan);
  } else if (command === 'create-token') {
    const [ws] = await graph.sql('SELECT id FROM Workspace WHERE id=:id', { id: required('workspace') });
    if (!ws) throw Error('Workspace not found');
    result = { ...(await issueToken(graph, required('workspace'), required('user'), flags.label || '')), note: 'Shown once. Store it securely; only its hash is kept.' };
  } else if (command === 'revoke-token') {
    await graph.sql('UPDATE ApiToken SET revokedAt=:t WHERE id=:id', { id: required('id'), t: new Date().toISOString() });
    result = { revoked: flags.id };
  } else if (command === 'set-plan') {
    if (!config.plans[required('plan')]) throw Error(`Unknown plan ${flags.plan}`);
    await graph.sql('UPDATE Workspace SET plan=:p WHERE id=:id', { id: required('workspace'), p: flags.plan });
    result = { workspace: flags.workspace, plan: flags.plan };
  } else if (command === 'workspaces') {
    result = await graph.sql('SELECT id, name, plan, createdAt FROM Workspace ORDER BY createdAt');
  } else {
    throw Error('Commands: create-workspace --name N [--plan P]; create-token --workspace ID --user EMAIL [--label L]; revoke-token --id ID; set-plan --workspace ID --plan P; workspaces');
  }
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
} finally {
  await database?.stop();
}
