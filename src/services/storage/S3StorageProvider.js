const StorageProvider = require('./StorageProvider');

class S3StorageProvider extends StorageProvider {
  constructor(config = {}) {
    super();
    this.bucket = config.bucket || process.env.S3_BUCKET;
    this.region = config.region || process.env.S3_REGION || 'us-east-1';
    this.endpoint = config.endpoint || process.env.S3_ENDPOINT;
    this.accessKeyId = config.accessKeyId || process.env.S3_ACCESS_KEY_ID;
    this.secretAccessKey = config.secretAccessKey || process.env.S3_SECRET_ACCESS_KEY;
    this.forcePathStyle = config.forcePathStyle || process.env.S3_FORCE_PATH_STYLE === 'true';
    this.defaultExpiresIn = Number(config.expiresIn || process.env.SIGNED_URL_TTL_SECONDS || 300);

    // Lazy initialization of S3 client
    this._client = null;
  }

  getClient() {
    if (!this._client) {
      const { S3Client } = require('@aws-sdk/client-s3');
      const clientConfig = {
        region: this.region,
        credentials: {
          accessKeyId: this.accessKeyId,
          secretAccessKey: this.secretAccessKey
        },
        forcePathStyle: this.forcePathStyle
      };

      if (this.endpoint) {
        clientConfig.endpoint = this.endpoint;
      }

      this._client = new S3Client(clientConfig);
    }
    return this._client;
  }

  async store({ buffer, key, contentType, metadata = {} }) {
    const { PutObjectCommand } = require('@aws-sdk/client-s3');
    const client = this.getClient();

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      Metadata: metadata
    });

    await client.send(command);

    return {
      key,
      size: buffer.length,
      driver: 's3'
    };
  }

  async getDownloadUrl({ key, expiresIn }) {
    const { GetObjectCommand } = require('@aws-sdk/client-s3');
    const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
    const client = this.getClient();

    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key
    });

    const ttl = expiresIn || this.defaultExpiresIn;
    return await getSignedUrl(client, command, { expiresIn: ttl });
  }

  async delete({ key }) {
    if (!key) return false;
    const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
    const client = this.getClient();

    try {
      const command = new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key
      });
      await client.send(command);
      return true;
    } catch (error) {
      console.error(`❌ S3 delete failed for key ${key}:`, error);
      return false;
    }
  }

  async exists({ key }) {
    if (!key) return false;
    const { HeadObjectCommand } = require('@aws-sdk/client-s3');
    const client = this.getClient();

    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: key
      });
      await client.send(command);
      return true;
    } catch (error) {
      if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
        return false;
      }
      throw error;
    }
  }
}

module.exports = S3StorageProvider;
