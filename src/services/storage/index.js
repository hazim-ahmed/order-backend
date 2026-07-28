const LocalStorageProvider = require('./LocalStorageProvider');
const S3StorageProvider = require('./S3StorageProvider');

/**
 * Get active storage provider based on environment variables
 * @returns {LocalStorageProvider|S3StorageProvider}
 */
function getStorageProvider() {
  const driver = (process.env.STORAGE_DRIVER || 'local').toLowerCase();

  if (driver === 's3') {
    // Validate required S3 env vars
    const requiredVars = ['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'];
    const missing = requiredVars.filter(v => !process.env[v]);

    if (missing.length > 0) {
      const errMsg = `❌ CRITICAL SECURITY ERROR: STORAGE_DRIVER=s3 is set, but missing required env vars: ${missing.join(', ')}.`;
      if (process.env.NODE_ENV === 'production') {
        console.error(errMsg);
        console.error('⛔ Stopping server in production to prevent data loss on ephemeral storage.');
        process.exit(1);
      }
      console.warn(`⚠️ ${errMsg} Falling back to LocalStorageProvider for development only.`);
      return new LocalStorageProvider();
    }

    return new S3StorageProvider();
  }

  return new LocalStorageProvider();
}

const storageInstance = getStorageProvider();

module.exports = {
  getStorageProvider,
  storage: storageInstance,
  LocalStorageProvider,
  S3StorageProvider
};
