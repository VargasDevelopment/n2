import { backupDatabase } from '@n2/db';
import { isAbsolute } from 'node:path';

const { N2_DB_PATH: databasePath, N2_BACKUP_DIR: directory } = process.env;
if (!databasePath || !directory || !isAbsolute(databasePath) || !isAbsolute(directory)) {
  throw new Error('Backup requires absolute N2_DB_PATH and N2_BACKUP_DIR paths');
}
console.log(JSON.stringify(await backupDatabase(databasePath, directory)));
