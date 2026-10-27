import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { promisify } from 'node:util';

const binary = resolve(process.argv[2]);
const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const directory = await mkdtemp(join(tmpdir(), 'jimu-cli-check-'));
const requests = [];
const server = createServer((request, response) => {
  requests.push(`${request.method} ${request.url}`);
  const data = request.url === '/lca/v3/getAllUnits'
    ? [{ name: 'mass', unitList: [{ id: 'unit-fixture', name: 'kg', conversionFactor: '1', isStandard: 1 }] }]
    : request.url === '/lca/v3/getAllocationVersions'
      ? [{ id: 'version-fixture', version: 'Ecoinvent3.12+HiQ1.4.0' }]
      : null;
  response.writeHead(data ? 200 : 500, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify({ success: Boolean(data), code: '200', data }));
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const env = {
  HOME: directory, PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
  JIMU_LCA_MEMBER_KEY: 'app:fixture0000',
  JIMU_LCA_BASE_URL: `http://127.0.0.1:${server.address().port}`,
};
const run = (args, extra = {}) => promisify(execFile)(binary, args, { env: { ...env, ...extra }, timeout: 20_000 });
try {
  assert.equal((await run(['version'])).stdout.trim(), version);
  assert.equal((await run(['--version'])).stdout.trim(), version);
  assert.match((await run(['--help'])).stdout, /install-bridge/);
  assert.deepEqual(JSON.parse((await run(['get-units', '--query', 'kg'])).stdout), [
    { id: 'unit-fixture', name: 'kg', unitGroup: 'mass', conversionFactor: '1', isStandard: true },
  ]);

  const path = join(directory, 'bridge.db');
  const db = new DatabaseSync(path);
  db.exec('CREATE TABLE bridge (orig_uuid TEXT, system_model TEXT, background_data_id TEXT, bind_uuid TEXT, name_cn TEXT, name_en TEXT, location TEXT, unit TEXT, version_key TEXT, system_model_key TEXT)');
  db.close();
  const bindingArgs = ['bind-backgrounds-local', '--case-id', 'case-fixture', '--stage-id', 'stage-fixture', '--version-id', 'version-fixture', '--system-model', 'Cut-off', '--bindings', JSON.stringify([{ element_id: 'flow-fixture', dataset_key: '00000000-0000-0000-0000-000000000000' }])];
  const result = JSON.parse((await run(bindingArgs, { JIMU_LCA_BRIDGE_DB: path })).stdout);
  assert.deepEqual(result, { bound: [], unresolved: [{ element_id: 'flow-fixture', dataset_key: '00000000-0000-0000-0000-000000000000' }], save_result: null });
  await assert.rejects(run(bindingArgs), (error) => error.code === 1 && /local bridge not provisioned/.test(error.stderr));
  assert.deepEqual(requests, ['GET /lca/v3/getAllUnits', 'GET /lca/v3/getAllocationVersions']);
  console.log(JSON.stringify({ version, help: true, units: 'loopback-fixture', bridge: 'real-sqlite-query', missingBridge: 'explicit-error', businessWrites: 0 }));
} finally {
  await new Promise((done) => server.close(done));
  await rm(directory, { recursive: true, force: true });
}
