const fs = require('fs');
const path = require('path');
const StorageProvider = require('./StorageProvider');

class LocalStorageProvider extends StorageProvider {
  constructor(config = {}) {
    super();
    this.uploadDir = config.uploadDir || process.env.LOCAL_UPLOAD_DIR || path.join(__dirname, '../../../uploads');
    this.ensureDirectoryExists(this.uploadDir);
  }

  ensureDirectoryExists(dir) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  async store({ buffer, key, contentType, metadata = {} }) {
    const fullPath = path.join(this.uploadDir, key);
    const parentDir = path.dirname(fullPath);
    this.ensureDirectoryExists(parentDir);

    await fs.promises.writeFile(fullPath, buffer);
    const stats = await fs.promises.stat(fullPath);

    return {
      key,
      size: stats.size,
      driver: 'local',
      filePath: fullPath
    };
  }

  async getDownloadUrl({ key, expiresIn }) {
    // For local storage, return standard upload path endpoint
    const cleanKey = key.replace(/^\/+/, '');
    return `/uploads/${cleanKey}`;
  }

  async delete({ key }) {
    if (!key) return false;
    const fullPath = path.join(this.uploadDir, key);
    try {
      if (fs.existsSync(fullPath)) {
        await fs.promises.unlink(fullPath);
        return true;
      }
      return false;
    } catch (error) {
      console.error(`❌ Failed to delete local file ${key}:`, error);
      return false;
    }
  }

  async exists({ key }) {
    if (!key) return false;
    const fullPath = path.join(this.uploadDir, key);
    try {
      await fs.promises.access(fullPath, fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }
}

module.exports = LocalStorageProvider;
