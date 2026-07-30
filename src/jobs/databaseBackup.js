/**
 * src/jobs/databaseBackup.js
 * مهمة مجدولة لنسخ قاعدة البيانات مع فحص اتصال وتنظيف احتفاظ ودعم تشفير/رفع اختياري.
 */

const cron = require('node-cron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { sequelize } = require('../models');

// يقرأ عدد أيام الاحتفاظ من البيئة ويثبت قيمة آمنة افتراضيا.
const getRetentionDays = () => {
  const value = Number(process.env.BACKUP_RETENTION_DAYS || 30);
  return Number.isFinite(value) && value > 0 ? value : 30;
};

// ينشئ مجلد النسخ المحلي عند الحاجة قبل تشغيل mysqldump.
const ensureBackupsDir = () => {
  const backupsDir = path.join(__dirname, '../../backups');
  if (!fs.existsSync(backupsDir)) {
    fs.mkdirSync(backupsDir, { recursive: true });
  }
  return backupsDir;
};

// يحذف النسخ المحلية القديمة حتى لا يمتلئ القرص مع الوقت.
const cleanupOldBackups = (backupsDir, retentionDays = getRetentionDays()) => {
  const cutoffTime = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const files = fs.readdirSync(backupsDir, { withFileTypes: true });
  let deletedCount = 0;

  for (const file of files) {
    if (!file.isFile()) continue;
    if (!/^backup_/.test(file.name)) continue;

    const filePath = path.join(backupsDir, file.name);
    const stats = fs.statSync(filePath);
    if (stats.mtimeMs < cutoffTime) {
      fs.unlinkSync(filePath);
      deletedCount += 1;
    }
  }

  if (deletedCount > 0) {
    console.log(`تم حذف ${deletedCount} نسخة احتياطية أقدم من ${retentionDays} يوم.`);
  }
};

// يبني وسائط mysqldump بدون shell لتجنب حقن أوامر النظام.
const buildDumpArgs = () => {
  const args = [];
  if (process.env.DB_HOST) args.push('-h', process.env.DB_HOST);
  if (process.env.DB_PORT) args.push('-P', String(process.env.DB_PORT));
  if (process.env.DB_USER) args.push('-u', process.env.DB_USER);
  if (process.env.DB_PASS) args.push(`-p${process.env.DB_PASS}`);
  args.push(process.env.DB_NAME);
  return args;
};

// يشغل mysqldump وينتظر انتهاء كتابة الملف على القرص.
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
      reject(new Error(`فشل تشغيل mysqldump: ${error.message}`));
    });
    dumpProcess.on('close', code => {
      outputStream.end(() => {
        if (code !== 0) {
          reject(new Error(`فشل النسخ الاحتياطي (exit code: ${code}): ${stderrData}`));
          return;
        }
        resolve();
      });
    });
  });
};

// يتحقق من وجود ملف النسخة وحجمه قبل اعتباره ناجحا.
const assertBackupFile = (filePath) => {
  const stats = fs.statSync(filePath);
  if (stats.size === 0) {
    throw new Error('ملف النسخة الاحتياطية فارغ.');
  }
  return stats;
};

// يشفر ملف النسخة محليا عند توفير BACKUP_ENCRYPTION_KEY.
const encryptBackupIfConfigured = (filePath) => {
  const keyMaterial = process.env.BACKUP_ENCRYPTION_KEY;
  if (!keyMaterial) return filePath;

  const key = crypto.createHash('sha256').update(keyMaterial).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plain = fs.readFileSync(filePath);
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const encryptedPath = `${filePath}.enc`;
  const metaPath = `${encryptedPath}.meta.json`;

  fs.writeFileSync(encryptedPath, encrypted);
  fs.writeFileSync(metaPath, JSON.stringify({ algorithm: 'aes-256-gcm', iv: iv.toString('hex'), authTag: authTag.toString('hex') }, null, 2));
  fs.unlinkSync(filePath);
  console.log(`تم تشفير النسخة الاحتياطية: ${path.basename(encryptedPath)}`);
  return encryptedPath;
};

// يرفع النسخة إلى S3 عند توفر BACKUP_S3_BUCKET ويستخدم تشفير S3 من جهة الخادم.
const uploadBackupIfConfigured = async (filePath) => {
  const bucket = process.env.BACKUP_S3_BUCKET;
  if (!bucket) return false;

  const region = process.env.BACKUP_S3_REGION || process.env.AWS_REGION || 'us-east-1';
  const client = new S3Client({ region });
  const key = `database-backups/${path.basename(filePath)}`;

  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: fs.createReadStream(filePath),
    ServerSideEncryption: 'AES256'
  }));

  console.log(`تم رفع النسخة الاحتياطية إلى S3: s3://${bucket}/${key}`);
  return true;
};

// ينفذ نسخة احتياطية واحدة ويعيد تفاصيلها للاختبار أو التشغيل اليدوي.
const runDatabaseBackupOnce = async () => {
  const dbName = process.env.DB_NAME;
  if (!dbName) throw new Error('DB_NAME غير مضبوط، لا يمكن تشغيل النسخ الاحتياطي.');

  await sequelize.authenticate();
  console.log('تم فحص اتصال قاعدة البيانات قبل النسخ الاحتياطي.');

  const backupsDir = ensureBackupsDir();
  cleanupOldBackups(backupsDir);

  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const timeStr = now.toISOString().slice(11, 19).replace(/:/g, '-');
  const fileName = `backup_${dbName}_${dateStr}_${timeStr}.sql`;
  const filePath = path.join(backupsDir, fileName);

  await runMysqlDump(filePath);
  const stats = assertBackupFile(filePath);
  console.log(`تم إنشاء نسخة احتياطية بنجاح: ${fileName} (${(stats.size / (1024 * 1024)).toFixed(2)} MB)`);

  const finalPath = encryptBackupIfConfigured(filePath);
  const uploaded = await uploadBackupIfConfigured(finalPath);
  if (uploaded && process.env.BACKUP_DELETE_LOCAL_AFTER_UPLOAD === 'true') {
    fs.unlinkSync(finalPath);
    console.log('تم حذف النسخة المحلية بعد رفعها بنجاح.');
  }

  return { filePath: finalPath, uploaded };
};

// يبدأ جدولة النسخ الاحتياطي اليومية الساعة الثانية صباحا.
const startDatabaseBackupJob = () => {
  cron.schedule('0 2 * * *', async () => {
    try {
      console.log('بدء عملية النسخ الاحتياطي لقاعدة البيانات...');
      await runDatabaseBackupOnce();
    } catch (error) {
      console.error('فشل النسخ الاحتياطي:', error.message);
    }
  });
};

module.exports = {
  runDatabaseBackupOnce,
  startDatabaseBackupJob
};