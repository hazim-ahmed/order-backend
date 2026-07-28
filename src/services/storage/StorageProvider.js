/**
 * StorageProvider Interface
 * Base abstract class defining the contract for storage drivers (Local, S3, etc.)
 */
class StorageProvider {
  /**
   * Store a file
   * @param {Object} params
   * @param {Buffer|ReadableStream} params.buffer
   * @param {string} params.key
   * @param {string} params.contentType
   * @param {Object} [params.metadata]
   * @returns {Promise<{ key: string, size: number, driver: string }>}
   */
  async store({ buffer, key, contentType, metadata = {} }) {
    throw new Error('store() method must be implemented');
  }

  /**
   * Get accessible/download URL for a key
   * @param {Object} params
   * @param {string} params.key
   * @param {number} [params.expiresIn] - Seconds until link expires (for signed URLs)
   * @returns {Promise<string>}
   */
  async getDownloadUrl({ key, expiresIn }) {
    throw new Error('getDownloadUrl() method must be implemented');
  }

  /**
   * Delete a file from storage
   * @param {Object} params
   * @param {string} params.key
   * @returns {Promise<boolean>}
   */
  async delete({ key }) {
    throw new Error('delete() method must be implemented');
  }

  /**
   * Check if a file exists
   * @param {Object} params
   * @param {string} params.key
   * @returns {Promise<boolean>}
   */
  async exists({ key }) {
    throw new Error('exists() method must be implemented');
  }
}

module.exports = StorageProvider;
