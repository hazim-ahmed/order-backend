const request = require('supertest');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const express = require('express');
const sharp = require('sharp');
const { sequelize, User, Order, DeliveryDocument } = require('../src/models');
const { storage } = require('../src/services/storage');
const { cleanupTemporaryDocuments } = require('../src/services/cleanupJob');
const uploadRoutes = require('../src/routes/uploadRoutes');

// Mock Express App for testing upload routes
const app = express();
app.use(express.json());
app.use('/api/upload', uploadRoutes);

describe('Delivery Storage & Upload Remediation Tests', () => {
  let authToken;
  let testUser;
  let validJpegBuffer;

  // Minimal valid PDF buffer with correct magic bytes (%PDF-1.4)
  const validPdfBuffer = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF', 'utf-8');

  // Fake executable buffer posing as JPG
  const fakeExeBuffer = Buffer.from('MZ90000300000004000000ffff0000b800000000000000400000000000000000000000', 'hex');

  beforeAll(async () => {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('⛔ ERROR: Cannot run tests in production environment!');
    }
    await sequelize.sync({ force: false });

    // Generate valid 10x10 JPEG buffer using Sharp
    validJpegBuffer = await sharp({
      create: {
        width: 10,
        height: 10,
        channels: 3,
        background: { r: 0, g: 128, b: 255 }
      }
    }).jpeg().toBuffer();

    // Find or create test user
    [testUser] = await User.findOrCreate({
      where: { username: 'test_driver_upload' },
      defaults: {
        name: 'Test Driver',
        username: 'test_driver_upload',
        role: 'driver',
        password_hash: 'hash'
      }
    });

    // Generate valid JWT token
    const secret = process.env.JWT_SECRET || 'test_secret';
    authToken = jwt.sign(
      { id: testUser.id, username: testUser.username, role: testUser.role },
      secret,
      { expiresIn: '1h' }
    );
  });

  afterAll(async () => {
    await sequelize.close();
  });

  describe('1. Security & Content Validation', () => {
    it('should reject unauthenticated upload requests with 401', async () => {
      const res = await request(app)
        .post('/api/upload/delivery')
        .attach('file', validJpegBuffer, 'test.jpg');

      expect(res.status).toBe(401);
    });

    it('should reject spoofed file with fake magic bytes even if named .jpg', async () => {
      const res = await request(app)
        .post('/api/upload/delivery')
        .set('Authorization', `Bearer ${authToken}`)
        .attach('file', fakeExeBuffer, 'malicious.jpg');

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('نوع محتوى الملف غير مسموح به');
    });

    it('should accept valid JPEG file, optimize it and create DeliveryDocument', async () => {
      const res = await request(app)
        .post('/api/upload/delivery')
        .set('Authorization', `Bearer ${authToken}`)
        .attach('file', validJpegBuffer, 'delivery_test.jpg');

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('document_id');
      expect(res.body).toHaveProperty('url');
      expect(res.body).toHaveProperty('thumbnail_url');

      const doc = await DeliveryDocument.findByPk(res.body.document_id);
      expect(doc).not.toBeNull();
      expect(doc.status).toBe('temporary');
      expect(doc.uploaded_by).toBe(testUser.id);
      expect(doc.thumbnail_key).not.toBeNull();
    });

    it('should accept valid PDF file without running Sharp optimization', async () => {
      const res = await request(app)
        .post('/api/upload/delivery')
        .set('Authorization', `Bearer ${authToken}`)
        .attach('file', validPdfBuffer, 'invoice_proof.pdf');

      expect(res.status).toBe(201);

      const doc = await DeliveryDocument.findByPk(res.body.document_id);
      expect(doc).not.toBeNull();
      expect(doc.mime_type).toBe('application/pdf');
      expect(doc.thumbnail_key).toBeNull();
    });

    it('should block non-admin user from deleting an attached document', async () => {
      const attachedDoc = await DeliveryDocument.create({
        uploaded_by: testUser.id,
        storage_driver: 'local',
        object_key: 'delivery/test_attached.webp',
        original_name: 'test_attached.jpg',
        mime_type: 'image/webp',
        size_bytes: 1024,
        status: 'attached'
      });

      const res = await request(app)
        .delete(`/api/upload/documents/${attachedDoc.id}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('لا يمكن حذف أو تعديل مستند التسليم بعد اعتماده');
    });
  });

  describe('2. Cleanup Job for Expired Temporary Files', () => {
    it('should cleanup expired temporary documents older than 24 hours', async () => {
      // Create an expired temporary doc
      const expiredDoc = await DeliveryDocument.create({
        uploaded_by: testUser.id,
        storage_driver: 'local',
        object_key: 'delivery/test_expired.webp',
        original_name: 'test_expired.jpg',
        mime_type: 'image/webp',
        size_bytes: 1024,
        status: 'temporary',
        created_at: new Date(Date.now() - 25 * 60 * 60 * 1000) // 25 hours ago
      });

      const result = await cleanupTemporaryDocuments();
      expect(result.cleanedCount).toBeGreaterThanOrEqual(1);

      const refreshed = await DeliveryDocument.findByPk(expiredDoc.id);
      expect(refreshed.status).toBe('deleted');
      expect(refreshed.deleted_at).not.toBeNull();
    });
  });
});
