const cron = require('node-cron');
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const zlib = require('zlib');
const { finished } = require('stream/promises');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { sequelize } = require('../models');

const BACKUP_PREFIX = 'full_backup_';
const isFullBackupArchiveName = (name) => name.startsWith(BACKUP_PREFIX) && (name.endsWith('.tar.gz') || name.endsWith('.tar.gz.enc'));

const getRetentionDays = () => {
  const value = Number(process.env.BACKUP_RETENTION_DAYS || 30);
  return Number.isFinite(value) && value > 0 ? value : 30;
};

const getBackupsDir = () => path.join(__dirname, '../../backups');

const ensureBackupsDir = async () => {
  const backupsDir = getBackupsDir();
  await fsp.mkdir(backupsDir, { recursive: true });
  return backupsDir;
};

const resolveUploadsDir = () => {
  const configured = process.env.LOCAL_UPLOAD_DIR || 'uploads';
  return path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured);
};

const buildDumpArgs = () => {
  const args = ['--single-transaction', '--quick', '--routines', '--triggers'];
  if (process.env.DB_HOST) args.push('-h', process.env.DB_HOST);
  if (process.env.DB_PORT) args.push('-P', String(process.env.DB_PORT));
  if (process.env.DB_USER) args.push('-u', process.env.DB_USER);
  if (process.env.DB_PASS) args.push(`-p${process.env.DB_PASS}`);
  args.push(process.env.DB_NAME);
  return args;
};

const runMysqlDump = (filePath) => {
  return new Promise((resolve, reject) => {
    const outputStream = fs.createWriteStream(filePath);
    const dumpProcess = spawn('mysqldump', buildDumpArgs());
    let stderrData = '';

    dumpProcess.stdout.pipe(outputStream);
    dumpProcess.stderr.on('data', data => {
      stderrData += data.toString();
    });
    dumpProcess.on('error', error => {
      reject(new Error(`Failed to run mysqldump: ${error.message}`));
    });
    dumpProcess.on('close', code => {
      outputStream.end(() => {
        if (code !== 0) {
          reject(new Error(`Database backup failed with exit code ${code}: ${stderrData}`));
          return;
        }
        resolve();
      });
    });
  });
};

const quoteIdentifier = (identifier) => `\`${String(identifier).replace(/`/g, '``')}\``;

const normalizeTableName = (table) => {
  if (typeof table === 'string') return table;
  return table.tableName || table.name || String(table);
};

const sanitizePathSegment = (value, fallback = 'item') => {
  const sanitized = String(value || fallback)
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 120);
  return sanitized || fallback;
};

const buildRowFileName = ({ row, schema, index }) => {
  const primaryKeys = Object.entries(schema)
    .filter(([, column]) => column && column.primaryKey)
    .map(([name]) => name);

  if (primaryKeys.length > 0) {
    const keyValue = primaryKeys
      .map(key => row[key])
      .filter(value => value !== undefined && value !== null && value !== '')
      .join('_');
    if (keyValue) return `${sanitizePathSegment(keyValue, `row_${index + 1}`)}.json`;
  }

  return `row_${String(index + 1).padStart(6, '0')}.json`;
};

const exportDatabaseAsJson = async (targetDir) => {
  const queryInterface = sequelize.getQueryInterface();
  const tables = await queryInterface.showAllTables();
  const manifest = {
    exported_at: new Date().toISOString(),
    format: 'sequelize-json-fallback',
    schema_note: 'Run migrations/schema setup before importing this data fallback.',
    tables: []
  };

  for (const table of tables) {
    const tableName = normalizeTableName(table);
    const safeTableName = sanitizePathSegment(tableName, 'table');
    const tableDir = path.join(targetDir, safeTableName);
    const rowsDir = path.join(tableDir, 'rows');
    await fsp.mkdir(rowsDir, { recursive: true });

    let schema = {};
    try {
      schema = await queryInterface.describeTable(tableName);
    } catch (schemaError) {
      schema = { _warning: `Unable to describe table schema: ${schemaError.message}` };
    }

    const [rows] = await sequelize.query(`SELECT * FROM ${quoteIdentifier(tableName)}`);
    await fsp.writeFile(path.join(tableDir, 'schema.json'), JSON.stringify(schema, null, 2));

    for (const [index, row] of rows.entries()) {
      const rowFileName = buildRowFileName({ row, schema, index });
      await fsp.writeFile(path.join(rowsDir, rowFileName), JSON.stringify(row, null, 2));
    }

    manifest.tables.push({
      name: tableName,
      path: safeTableName,
      rows: rows.length,
      schema_file: `${safeTableName}/schema.json`,
      rows_dir: `${safeTableName}/rows`
    });
  }

  await fsp.writeFile(path.join(targetDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
};

const createDatabaseBackupFile = async ({ databaseDir, dbName, stamp }) => {
  const sqlFileName = `${dbName}_${stamp}.sql`;
  const sqlFilePath = path.join(databaseDir, sqlFileName);

  try {
    await runMysqlDump(sqlFilePath);
    return {
      fileName: sqlFileName,
      filePath: sqlFilePath,
      format: 'mysql-dump',
      warning: null
    };
  } catch (dumpError) {
    await fsp.rm(sqlFilePath, { force: true });
    const jsonDirName = `${dbName}_${stamp}_json_fallback`;
    const jsonDirPath = path.join(databaseDir, jsonDirName);
    await fsp.mkdir(jsonDirPath, { recursive: true });
    await exportDatabaseAsJson(jsonDirPath);
    return {
      fileName: jsonDirName,
      filePath: jsonDirPath,
      format: 'sequelize-json-fallback',
      warning: `mysqldump failed, database data exported as JSON fallback: ${dumpError.message}`
    };
  }
};

const formatOctal = (value, length) => {
  const octal = value.toString(8);
  return `${octal.padStart(length - 1, '0')}\0`;
};

const writeString = (buffer, value, offset, length) => {
  buffer.write(String(value).slice(0, length), offset, length, 'utf8');
};

const splitTarPath = (entryPath) => {
  if (Buffer.byteLength(entryPath) <= 100) return { name: entryPath, prefix: '' };

  const parts = entryPath.split('/');
  for (let index = 1; index < parts.length; index += 1) {
    const prefix = parts.slice(0, index).join('/');
    const name = parts.slice(index).join('/');
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(name) <= 100) {
      return { name, prefix };
    }
  }

  throw new Error(`Backup path is too long for tar format: ${entryPath}`);
};

const createTarHeader = ({ entryPath, size = 0, mtime = Math.floor(Date.now() / 1000), type = '0' }) => {
  const normalizedPath = entryPath.replace(/\\/g, '/').replace(/^\/+/, '');
  const { name, prefix } = splitTarPath(normalizedPath);
  const header = Buffer.alloc(512, 0);

  writeString(header, name, 0, 100);
  writeString(header, formatOctal(type === '5' ? 0o755 : 0o644, 8), 100, 8);
  writeString(header, formatOctal(0, 8), 108, 8);
  writeString(header, formatOctal(0, 8), 116, 8);
  writeString(header, formatOctal(size, 12), 124, 12);
  writeString(header, formatOctal(mtime, 12), 136, 12);
  header.fill(' ', 148, 156);
  writeString(header, type, 156, 1);
  writeString(header, 'ustar', 257, 6);
  writeString(header, '00', 263, 2);
  writeString(header, 'node', 265, 32);
  writeString(header, 'node', 297, 32);
  if (prefix) writeString(header, prefix, 345, 155);

  let checksum = 0;
  for (const byte of header) checksum += byte;
  writeString(header, `${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8);
  return header;
};

const writeToStream = (stream, chunk) => new Promise((resolve, reject) => {
  stream.once('error', reject);
  const done = () => {
    stream.removeListener('error', reject);
    resolve();
  };
  if (stream.write(chunk)) done();
  else stream.once('drain', done);
});

const walkDirectory = async (rootDir, currentDir = rootDir) => {
  const entries = await fsp.readdir(currentDir, { withFileTypes: true });
  const results = [];

  for (const entry of entries) {
    const absolutePath = path.join(currentDir, entry.name);
    const relativePath = path.relative(rootDir, absolutePath).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      results.push({ absolutePath, relativePath, isDirectory: true });
      results.push(...await walkDirectory(rootDir, absolutePath));
    } else if (entry.isFile()) {
      const stats = await fsp.stat(absolutePath);
      results.push({ absolutePath, relativePath, isDirectory: false, size: stats.size, mtime: Math.floor(stats.mtimeMs / 1000) });
    }
  }

  return results;
};

const createTarGzFromDirectory = async ({ sourceDir, archivePath, archiveRootName }) => {
  const gzip = zlib.createGzip({ level: 9 });
  const output = fs.createWriteStream(archivePath);
  gzip.pipe(output);
  const completion = finished(output);

  const rootStats = await fsp.stat(sourceDir);
  await writeToStream(gzip, createTarHeader({ entryPath: `${archiveRootName}/`, type: '5', mtime: Math.floor(rootStats.mtimeMs / 1000) }));

  const entries = await walkDirectory(sourceDir);
  for (const entry of entries) {
    const tarPath = `${archiveRootName}/${entry.relativePath}${entry.isDirectory ? '/' : ''}`;
    await writeToStream(gzip, createTarHeader({
      entryPath: tarPath,
      size: entry.isDirectory ? 0 : entry.size,
      mtime: entry.mtime || Math.floor(Date.now() / 1000),
      type: entry.isDirectory ? '5' : '0'
    }));

    if (!entry.isDirectory) {
      await new Promise((resolve, reject) => {
        const readStream = fs.createReadStream(entry.absolutePath);
        readStream.on('error', reject);
        readStream.on('end', resolve);
        readStream.on('data', chunk => {
          readStream.pause();
          writeToStream(gzip, chunk).then(() => readStream.resume()).catch(reject);
        });
      });
      const paddingSize = (512 - (entry.size % 512)) % 512;
      if (paddingSize) await writeToStream(gzip, Buffer.alloc(paddingSize));
    }
  }

  await writeToStream(gzip, Buffer.alloc(1024));
  gzip.end();
  await completion;
};

const countFiles = async (dir) => {
  try {
    const entries = await walkDirectory(dir);
    return entries
      .filter(entry => !entry.isDirectory)
      .reduce((acc, entry) => ({ files: acc.files + 1, bytes: acc.bytes + Number(entry.size || 0) }), { files: 0, bytes: 0 });
  } catch (error) {
    if (error.code === 'ENOENT') return { files: 0, bytes: 0 };
    throw error;
  }
};

const encryptFileIfConfigured = async (filePath) => {
  const keyMaterial = process.env.BACKUP_ENCRYPTION_KEY;
  if (!keyMaterial) return filePath;

  const key = crypto.createHash('sha256').update(keyMaterial).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encryptedPath = `${filePath}.enc`;
  const metaPath = `${encryptedPath}.meta.json`;

  const input = fs.createReadStream(filePath);
  const output = fs.createWriteStream(encryptedPath);
  await new Promise((resolve, reject) => {
    input.on('error', reject);
    output.on('error', reject);
    output.on('finish', resolve);
    input.pipe(cipher).pipe(output);
  });

  const authTag = cipher.getAuthTag();
  await fsp.writeFile(metaPath, JSON.stringify({ algorithm: 'aes-256-gcm', iv: iv.toString('hex'), authTag: authTag.toString('hex') }, null, 2));
  await fsp.unlink(filePath);
  return encryptedPath;
};

const uploadArchiveIfConfigured = async (filePath) => {
  const bucket = process.env.BACKUP_S3_BUCKET;
  if (!bucket) return false;

  const region = process.env.BACKUP_S3_REGION || process.env.S3_REGION || process.env.AWS_REGION || 'us-east-1';
  const endpoint = process.env.BACKUP_S3_ENDPOINT || process.env.S3_ENDPOINT;
  const accessKeyId = process.env.BACKUP_S3_ACCESS_KEY_ID || process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.BACKUP_S3_SECRET_ACCESS_KEY || process.env.S3_SECRET_ACCESS_KEY;
  const forcePathStyle = (process.env.BACKUP_S3_FORCE_PATH_STYLE || process.env.S3_FORCE_PATH_STYLE) === 'true';

  const clientConfig = { region, forcePathStyle };
  if (endpoint) clientConfig.endpoint = endpoint;
  if (accessKeyId && secretAccessKey) {
    clientConfig.credentials = { accessKeyId, secretAccessKey };
  }

  const client = new S3Client(clientConfig);
  const key = `application-backups/${path.basename(filePath)}`;

  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: fs.createReadStream(filePath),
    ServerSideEncryption: 'AES256'
  }));

  const metaPath = `${filePath}.meta.json`;
  if (fs.existsSync(metaPath)) {
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: `${key}.meta.json`,
      Body: fs.createReadStream(metaPath),
      ContentType: 'application/json',
      ServerSideEncryption: 'AES256'
    }));
  }

  return { bucket, key };
};

const cleanupOldFullBackups = async (backupsDir, retentionDays = getRetentionDays()) => {
  const cutoffTime = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const entries = await fsp.readdir(backupsDir, { withFileTypes: true });
  let deletedCount = 0;

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!isFullBackupArchiveName(entry.name)) continue;
    const filePath = path.join(backupsDir, entry.name);
    const stats = await fsp.stat(filePath);
    if (stats.mtimeMs < cutoffTime) {
      await fsp.unlink(filePath);
      await fsp.rm(`${filePath}.meta.json`, { force: true });
      deletedCount += 1;
    }
  }

  return deletedCount;
};

const listFullBackups = async () => {
  const backupsDir = await ensureBackupsDir();
  const entries = await fsp.readdir(backupsDir, { withFileTypes: true });
  const backups = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!isFullBackupArchiveName(entry.name)) continue;
    const filePath = path.join(backupsDir, entry.name);
    const stats = await fsp.stat(filePath);
    backups.push({
      fileName: entry.name,
      filePath,
      sizeBytes: stats.size,
      createdAt: stats.mtime
    });
  }

  return backups.sort((a, b) => b.createdAt - a.createdAt);
};

const getLatestFullBackup = async () => {
  const backups = await listFullBackups();
  return backups[0] || null;
};

let activeBackupPromise = null;

const runFullBackupTask = async () => {
  if (!process.env.DB_NAME) throw new Error('DB_NAME is required to run a full backup.');

  await sequelize.authenticate();
  const backupsDir = await ensureBackupsDir();
  await cleanupOldFullBackups(backupsDir);

  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const baseName = `${BACKUP_PREFIX}${process.env.DB_NAME}_${stamp}`;
  const stagingDir = path.join(backupsDir, `${baseName}_staging`);
  const databaseDir = path.join(stagingDir, 'database');
  const attachmentsDir = path.join(stagingDir, 'attachments');
  const uploadsDir = resolveUploadsDir();

  await fsp.mkdir(databaseDir, { recursive: true });
  await fsp.mkdir(attachmentsDir, { recursive: true });

  try {
    const databaseBackup = await createDatabaseBackupFile({ databaseDir, dbName: process.env.DB_NAME, stamp });
    const dbStats = databaseBackup.format === 'sequelize-json-fallback'
      ? await countFiles(databaseBackup.filePath)
      : await fsp.stat(databaseBackup.filePath);

    let attachmentStats = { files: 0, bytes: 0 };
    let attachmentsCopied = false;
    try {
      const sourceStats = await fsp.stat(uploadsDir);
      if (sourceStats.isDirectory()) {
        await fsp.cp(uploadsDir, attachmentsDir, { recursive: true, force: true, errorOnExist: false });
        attachmentStats = await countFiles(attachmentsDir);
        attachmentsCopied = true;
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }

    const manifest = {
      created_at: now.toISOString(),
      db_name: process.env.DB_NAME,
      database_file: `database/${databaseBackup.fileName}`,
      database_format: databaseBackup.format,
      database_size_bytes: databaseBackup.format === 'sequelize-json-fallback' ? dbStats.bytes : dbStats.size,
      attachments: {
        source: uploadsDir,
        included: attachmentsCopied,
        files: attachmentStats.files,
        size_bytes: attachmentStats.bytes
      },
      storage_driver: process.env.STORAGE_DRIVER || 'local',
      notes: []
    };

    if (databaseBackup.warning) {
      manifest.notes.push(databaseBackup.warning);
    }

    if ((process.env.STORAGE_DRIVER || 'local').toLowerCase() === 's3') {
      manifest.notes.push('Primary attachments stored in S3/R2 are not copied into this archive; configure BACKUP_S3_BUCKET or bucket replication for offsite object backups.');
    }

    await fsp.writeFile(path.join(stagingDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

    const archivePath = path.join(backupsDir, `${baseName}.tar.gz`);
    await createTarGzFromDirectory({ sourceDir: stagingDir, archivePath, archiveRootName: baseName });
    const finalPath = await encryptFileIfConfigured(archivePath);
    const finalStats = await fsp.stat(finalPath);
    if (finalStats.size === 0) throw new Error('Full backup archive is empty.');

    const uploaded = await uploadArchiveIfConfigured(finalPath);
    if (uploaded && process.env.BACKUP_DELETE_LOCAL_AFTER_UPLOAD === 'true') {
      await fsp.unlink(finalPath);
      await fsp.rm(`${finalPath}.meta.json`, { force: true });
    }

    return {
      filePath: finalPath,
      fileName: path.basename(finalPath),
      sizeBytes: finalStats.size,
      uploaded,
      manifest
    };
  } finally {
    await fsp.rm(stagingDir, { recursive: true, force: true });
  }
};

const runFullBackupOnce = async () => {
  if (activeBackupPromise) {
    throw new Error('A full backup is already running.');
  }

  activeBackupPromise = runFullBackupTask();
  try {
    return await activeBackupPromise;
  } finally {
    activeBackupPromise = null;
  }
};

const startFullBackupJob = () => {
  if (process.env.FULL_BACKUP_ENABLED === 'false') {
    console.log('Full backup scheduler is disabled by FULL_BACKUP_ENABLED=false.');
    return null;
  }

  const schedule = process.env.FULL_BACKUP_CRON || '30 2 * * *';
  return cron.schedule(schedule, async () => {
    try {
      console.log('Starting full application backup...');
      const result = await runFullBackupOnce();
      console.log(`Full application backup completed: ${result.fileName}`);
    } catch (error) {
      console.error('Full application backup failed:', error.message);
    }
  });
};

module.exports = {
  runFullBackupOnce,
  startFullBackupJob,
  listFullBackups,
  getLatestFullBackup
};