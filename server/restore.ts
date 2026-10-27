import { restoreBackup } from './backup.ts';
const [file, destination] = process.argv.slice(2);
if (!file || !destination) {
  console.error('Usage: pnpm backup:restore /path/to/backup.zip /path/to/new-data-directory');
  process.exitCode = 1;
} else {
  try {
    await restoreBackup(file, destination);
    console.log(
      `Restored into ${destination}. Set DATA_DIR to this directory before starting the server.`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
