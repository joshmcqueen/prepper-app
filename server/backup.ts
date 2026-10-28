import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ZipArchive } from 'archiver';
import unzipper from 'unzipper';
import Database from 'better-sqlite3';
import { SCHEMA_VERSION, type Store } from './db.ts';

export async function createBackup(
  store: Store,
): Promise<{ file: string; cleanup: () => Promise<void> }> {
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), 'haven-backup-'));
  try {
    await store.db.backup(path.join(temp, 'inventory.sqlite'));
    const file = path.join(temp, 'haven-backup.zip');
    const output = fs.createWriteStream(file);
    const archive = new ZipArchive({ zlib: { level: 6 } });
    const complete = new Promise<void>((resolve, reject) => {
      output.on('close', resolve);
      output.on('error', reject);
      archive.on('error', reject);
      archive.on('warning', reject);
    });
    archive.pipe(output);
    archive.file(path.join(temp, 'inventory.sqlite'), { name: 'inventory.sqlite' });
    const photos = (await fsp.readdir(path.join(store.dataDir, 'uploads'))).filter((n) =>
      /^[a-f0-9-]+\.webp$/.test(n),
    );
    for (const photo of photos)
      archive.file(path.join(store.dataDir, 'uploads', photo), { name: `uploads/${photo}` });
    archive.append(
      JSON.stringify(
        {
          app: 'haven-prepper',
          schemaVersion: SCHEMA_VERSION,
          createdAt: new Date().toISOString(),
          photos,
        },
        null,
        2,
      ),
      { name: 'manifest.json' },
    );
    await archive.finalize();
    await complete;
    return { file, cleanup: () => fsp.rm(temp, { recursive: true, force: true }) };
  } catch (err) {
    await fsp.rm(temp, { recursive: true, force: true });
    throw err;
  }
}
export async function restoreBackup(file: string, destination: string) {
  if (fs.existsSync(destination) && (await fsp.readdir(destination)).length)
    throw new Error(
      'Restore destination must be a new or empty directory. Stop the server and restore to a fresh data directory.',
    );
  const zip = await unzipper.Open.file(file);
  if (zip.files.reduce((n, f) => n + f.uncompressedSize, 0) > 2 * 1024 ** 3)
    throw new Error('Backup exceeds the 2 GB restore limit');
  const manifestFile = zip.files.find((f) => f.path === 'manifest.json');
  const manifest = manifestFile ? JSON.parse((await manifestFile.buffer()).toString('utf8')) : null;
  if (
    manifest?.app !== 'haven-prepper' ||
    manifest.schemaVersion !== SCHEMA_VERSION ||
    !Array.isArray(manifest.photos)
  )
    throw new Error('Unsupported backup manifest');
  const allowed = new Set([
    'manifest.json',
    'inventory.sqlite',
    ...manifest.photos.map((p: string) => `uploads/${p}`),
  ]);
  if (
    zip.files.some(
      (f) =>
        !allowed.has(f.path) ||
        (f.path.startsWith('uploads/') && !/^uploads\/[a-f0-9-]+\.webp$/.test(f.path)),
    ) ||
    new Set(zip.files.map((f) => f.path)).size !== zip.files.length
  )
    throw new Error('Invalid backup paths');
  if (![...allowed].every((p) => zip.files.some((f) => f.path === p)))
    throw new Error('Backup is incomplete');
  const stage = await fsp.mkdtemp(
    path.join(path.dirname(path.resolve(destination)), '.haven-restore-'),
  );
  try {
    await fsp.mkdir(path.join(stage, 'uploads'));
    for (const entry of zip.files)
      if (entry.path !== 'manifest.json')
        await fsp.writeFile(path.join(stage, entry.path), await entry.buffer());
    const db = new Database(path.join(stage, 'inventory.sqlite'));
    try {
      if (
        db.pragma('integrity_check', { simple: true }) !== 'ok' ||
        db.pragma('user_version', { simple: true }) !== SCHEMA_VERSION
      )
        throw new Error('Backup database failed validation');
    } finally {
      db.close();
    }
    if (fs.existsSync(destination)) await fsp.rmdir(destination);
    await fsp.rename(stage, destination);
  } catch (err) {
    await fsp.rm(stage, { recursive: true, force: true });
    throw err;
  }
}
