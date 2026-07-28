const sharp = require('sharp');
const crypto = require('crypto');

/**
 * Image Processor Service
 * Handles image optimization, resizing, EXIF cleanup, thumbnail generation, and SHA-256 hashing.
 */
class ImageProcessor {
  /**
   * Process uploaded document/image file
   * @param {Object} params
   * @param {Buffer} params.buffer - Original file buffer
   * @param {string} params.mimeType - Detected MIME type
   * @returns {Promise<{ optimizedBuffer: Buffer, thumbnailBuffer: Buffer|null, mimeType: string, extension: string, checksum: string }>}
   */
  static async process({ buffer, mimeType }) {
    const checksum = crypto.createHash('sha256').update(buffer).digest('hex');

    // If PDF document, skip image processing and return original buffer
    if (mimeType === 'application/pdf') {
      return {
        optimizedBuffer: buffer,
        thumbnailBuffer: null,
        mimeType: 'application/pdf',
        extension: '.pdf',
        checksum
      };
    }

    // Process JPEG or PNG image
    try {
      const image = sharp(buffer);
      const metadata = await image.metadata();

      // Optimize main image: rotate according to EXIF orientation, auto-strip metadata (default in Sharp)
      let pipeline = image.rotate();

      if ((metadata.width && metadata.width > 2048) || (metadata.height && metadata.height > 2048)) {
        pipeline = pipeline.resize(2048, 2048, {
          fit: 'inside',
          withoutEnlargement: true
        });
      }

      // Convert to WebP format for optimal compression & browser compatibility
      const optimizedBuffer = await pipeline.webp({ quality: 80 }).toBuffer();

      // Generate Thumbnail (~400px width)
      const thumbnailBuffer = await sharp(buffer)
        .rotate()
        .resize(400, null, {
          fit: 'inside',
          withoutEnlargement: true
        })
        .webp({ quality: 75 })
        .toBuffer();

      return {
        optimizedBuffer,
        thumbnailBuffer,
        mimeType: 'image/webp',
        extension: '.webp',
        checksum
      };
    } catch (error) {
      console.error('❌ Failed to process image with Sharp:', error);
      throw new Error(`تعذر معالجة وتحسين الصورة: ${error.message}`);
    }
  }
}

module.exports = ImageProcessor;
