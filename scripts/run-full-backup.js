require('dotenv').config();

const { runFullBackupOnce } = require('../src/jobs/applicationBackup');

runFullBackupOnce()
  .then(result => {
    console.log(JSON.stringify({
      fileName: result.fileName,
      filePath: result.filePath,
      sizeBytes: result.sizeBytes,
      uploaded: result.uploaded
    }, null, 2));
    process.exit(0);
  })
  .catch(error => {
    console.error(error);
    process.exit(1);
  });