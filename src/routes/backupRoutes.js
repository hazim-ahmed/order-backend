const express = require('express');
const path = require('path');
const fs = require('fs');
const { authenticateToken, requireRole } = require('../middlewares/auth');
const { runFullBackupOnce, listFullBackups, getLatestFullBackup } = require('../jobs/applicationBackup');

const router = express.Router();

router.use(authenticateToken);
router.use(requireRole(['admin']));

router.get('/', async (req, res) => {
  try {
    const backups = await listFullBackups();
    res.status(200).json({ backups });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Unable to list backups.' });
  }
});

router.post('/run', async (req, res) => {
  try {
    const result = await runFullBackupOnce();
    res.status(201).json({
      message: 'Full backup created successfully.',
      backup: {
        fileName: result.fileName,
        sizeBytes: result.sizeBytes,
        uploaded: result.uploaded,
        manifest: result.manifest
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Unable to create full backup.' });
  }
});

router.get('/download/latest', async (req, res) => {
  try {
    const latest = await getLatestFullBackup();
    if (!latest) return res.status(404).json({ error: 'No full backups found.' });
    return res.download(latest.filePath, latest.fileName);
  } catch (error) {
    res.status(500).json({ error: error.message || 'Unable to download latest backup.' });
  }
});

router.get('/download/:fileName', async (req, res) => {
  try {
    const safeFileName = path.basename(req.params.fileName);
    const backups = await listFullBackups();
    const backup = backups.find(item => item.fileName === safeFileName);
    if (!backup || !fs.existsSync(backup.filePath)) {
      return res.status(404).json({ error: 'Backup file not found.' });
    }
    return res.download(backup.filePath, backup.fileName);
  } catch (error) {
    res.status(500).json({ error: error.message || 'Unable to download backup.' });
  }
});

module.exports = router;