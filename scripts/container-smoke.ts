import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { Settings, Stock } from '../shared/model.ts';

// Run against a previously built image. Only these uniquely named test resources are removed.
const image = process.argv[2] || 'prepper-app:local';
const name = `haven-smoke-${randomUUID()}`;
const volume = `${name}-data`;
const appBaseUrl = 'https://haven.example.test';
const docker = (...args: string[]) =>
  execFileSync('docker', args, { encoding: 'utf8', timeout: 60000 }).trim();
let baseUrl = '';

async function ready() {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch {
      // Wait for the API to bind, without relying on a fixed startup delay.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Container did not become ready');
}

async function start() {
  docker(
    'run',
    '--detach',
    '--init',
    '--name',
    name,
    '--publish',
    '127.0.0.1::3001',
    '--mount',
    `type=volume,source=${volume},target=/data`,
    '--env',
    `APP_BASE_URL=${appBaseUrl}`,
    image,
  );
  const port = docker('port', name, '3001/tcp').split(':').at(-1);
  baseUrl = `http://127.0.0.1:${port}`;
  await ready();
}

async function json(route: string, body?: unknown) {
  const response = await fetch(`${baseUrl}${route}`, {
    ...(body === undefined
      ? {}
      : {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: appBaseUrl },
          body: JSON.stringify(body),
        }),
    signal: AbortSignal.timeout(10000),
  });
  assert.ok(response.ok, `${route}: ${response.status} ${await response.clone().text()}`);
  return response.json();
}

try {
  docker('volume', 'create', volume);
  await start();
  assert.equal(docker('exec', name, 'id', '-u'), '1000', 'Run as the unprivileged node user');
  assert.equal(docker('exec', name, 'node', '--version').split('.')[0], 'v24');
  docker(
    'exec',
    name,
    'node',
    '-e',
    "const fs = require('node:fs'); for (const p of ['.env', '.git', 'src', 'tests', 'node_modules/typescript', 'node_modules/vite']) { if (fs.existsSync(p)) throw new Error('Unexpected runtime file: ' + p); }",
  );
  const state = await json('/api/state');
  assert.deepEqual(state.stocks, []);
  assert.equal(state.demo, false);
  assert.equal(state.settings.appBaseUrl, appBaseUrl);
  assert.deepEqual(state.settings.recipients, []);
  assert.deepEqual(state.integrations, { ai: false, email: false });

  for (const route of ['/', '/container/BK-01']) {
    const response = await fetch(`${baseUrl}${route}`);
    assert.ok(response.ok);
    const html = await response.text();
    assert.match(html, /<div id="root"><\/div>/);
    const asset = html.match(/src="(\/assets\/[^\"]+\.js)"/);
    assert.ok(asset, 'HTML should reference a built JavaScript asset');
    const js = await fetch(`${baseUrl}${asset[1]}`);
    assert.ok(js.ok);
    assert.match(js.headers.get('content-type') || '', /javascript/);
  }
  assert.equal((await fetch(`${baseUrl}/api/missing`)).status, 404);

  // Exercise native sharp, SQLite writes, backups, and server-only prompt packaging.
  const photo = new FormData();
  photo.append(
    'file',
    new Blob(
      [
        Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADklEQVQImWP4DwYMEAoAU7oL9W/sIDEAAAAASUVORK5CYII=',
          'base64',
        ),
      ],
      { type: 'image/png' },
    ),
    'sample.png',
  );
  const uploaded = await fetch(`${baseUrl}/api/photos`, { method: 'POST', body: photo });
  assert.ok(uploaded.ok, await uploaded.clone().text());
  const { id: photoId } = await uploaded.json();
  const stock: Stock = await json('/api/stocks', {
    category: 'food',
    name: 'Container smoke test rice',
    quantity: 12,
    unit: 'lb',
    photoIds: [photoId],
  });
  const settings: Settings = { ...state.settings, householdName: 'Container smoke test' };
  const saved = await fetch(`${baseUrl}/api/settings`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', origin: appBaseUrl },
    body: JSON.stringify(settings),
  });
  assert.ok(saved.ok);
  const backup = await fetch(`${baseUrl}/api/backup`);
  assert.ok(backup.ok);
  assert.equal(
    Buffer.from(await backup.arrayBuffer())
      .subarray(0, 2)
      .toString(),
    'PK',
  );
  docker('exec', name, 'node', '-e', "require('node:fs').accessSync('prompts/extract.md')");
  // Run the image's real healthcheck and verify Docker reports it healthy.
  for (let attempt = 0; attempt < 60; attempt++) {
    if (docker('inspect', '--format', '{{.State.Health.Status}}', name) === 'healthy') break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.equal(docker('inspect', '--format', '{{.State.Health.Status}}', name), 'healthy');
  docker('stop', '--time', '30', name);
  assert.equal(docker('inspect', '--format', '{{.State.ExitCode}}', name), '0');
  docker('rm', name);
  await start();
  const persisted = await json('/api/state');
  assert.equal(persisted.stocks.length, 1);
  assert.equal(persisted.stocks[0].id, stock.id);
  assert.equal(persisted.stocks[0].quantity, 12);
  assert.equal(persisted.settings.householdName, settings.householdName);
  const storedPhoto = await fetch(`${baseUrl}/uploads/${photoId}`);
  assert.ok(storedPhoto.ok);
  assert.equal(storedPhoto.headers.get('content-type'), 'image/webp');
  console.log(
    'Container smoke test passed: frontend, API, native modules, backup, healthcheck, graceful shutdown, and persistent inventory/settings/photos.',
  );
} catch (error) {
  try {
    console.error(docker('logs', '--tail', '50', name));
  } catch {
    // A failed docker run may not have created a container.
  }
  throw error;
} finally {
  try {
    docker('rm', '--force', name);
  } finally {
    docker('volume', 'rm', volume);
  }
}
