/**
 * src/jobs/databaseBackup.js
 * مهمة مجدولة لعمل نسخة احتياطية يومية من قاعدة البيانات باستخدام mysqldump
 * 
 * [تم الإصلاح]:
 *  - استخدام spawn مع args منفصلة بدل exec لمنع shell injection
 *  - التحقق من وجود الملف وحجمه بعد النسخ
 *  - تسجيل نتيجة النسخ في log
 */

const cron = require('node-cron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const startDatabaseBackupJob = () => {
  // تعمل يومياً الساعة 2:00 صباحاً
  cron.schedule('0 2 * * *', () => {
    console.log('🗄️ بدء عملية النسخ الاحتياطي لقاعدة البيانات...');

    const dbName = process.env.DB_NAME;
    const dbUser = process.env.DB_USER;
    const dbPass = process.env.DB_PASS || '';
    
    const backupsDir = path.join(__dirname, '../../backups');
    if (!fs.existsSync(backupsDir)) {
      fs.mkdirSync(backupsDir, { recursive: true });
    }

    const dateStr = new Date().toISOString().slice(0, 10);
    const timeStr = new Date().toISOString().slice(11, 19).replace(/:/g, '-');
    const fileName = `backup_${dbName}_${dateStr}_${timeStr}.sql`;
    const filePath = path.join(backupsDir, fileName);

    // [إصلاح] استخدام spawn مع args منفصلة بدل exec لمنع shell injection
    const args = ['-u', dbUser];
    if (dbPass) {
      args.push(`-p${dbPass}`);
    }
    args.push(dbName);

    const outputStream = fs.createWriteStream(filePath);
    const dumpProcess = spawn('mysqldump', args);

    dumpProcess.stdout.pipe(outputStream);

    let stderrData = '';
    dumpProcess.stderr.on('data', (data) => {
      stderrData += data.toString();
    });

    dumpProcess.on('close', (code) => {
      if (code !== 0) {
        console.error(`❌ فشل النسخ الاحتياطي (exit code: ${code}): ${stderrData}`);
        // حذف الملف الفاشل إن وجد
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
        return;
      }

      // [إصلاح] التحقق من وجود الملف وحجمه
      try {
        const stats = fs.statSync(filePath);
        if (stats.size === 0) {
          console.error('❌ فشل النسخ الاحتياطي: الملف فارغ (0 بايت).');
          fs.unlinkSync(filePath);
          return;
        }

        const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
        console.log(`✅ تم إنشاء نسخة احتياطية بنجاح: ${fileName} (${sizeMB} MB)`);
      } catch (statError) {
        console.error('❌ فشل التحقق من ملف النسخ الاحتياطي:', statError.message);
      }
    });

    dumpProcess.on('error', (error) => {
      console.error(`❌ فشل تشغيل mysqldump: ${error.message}`);
      console.error('تأكد من أن mysqldump مضاف إلى متغيرات البيئة (PATH).');
    });
  });
};

module.exports = {
  startDatabaseBackupJob
};
