const cron = require('node-cron');
const { Op } = require('sequelize');
const { DeliveryDocument } = require('../models');
const { storage } = require('./storage');

/**
 * Cleanup Job for Temporary Unattached Documents
 * Finds delivery_documents in 'temporary' status older than 24 hours and cleans them up.
 */
async function cleanupTemporaryDocuments() {
  try {
    const cutoffTime = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago

    const orphanDocs = await DeliveryDocument.findAll({
      where: {
        status: 'temporary',
        created_at: {
          [Op.lt]: cutoffTime
        }
      }
    });

    if (orphanDocs.length === 0) {
      return { cleanedCount: 0 };
    }

    console.log(`🧹 Running cleanup job: Found ${orphanDocs.length} expired temporary document(s).`);

    let cleanedCount = 0;
    for (const doc of orphanDocs) {
      try {
        if (doc.object_key) {
          await storage.delete({ key: doc.object_key });
        }
        if (doc.thumbnail_key) {
          await storage.delete({ key: doc.thumbnail_key });
        }

        doc.status = 'deleted';
        doc.deleted_at = new Date();
        await doc.save();
        cleanedCount++;
      } catch (err) {
        console.error(`❌ Failed to cleanup document ID ${doc.id}:`, err);
      }
    }

    console.log(`✅ Cleanup job finished: Successfully cleaned ${cleanedCount}/${orphanDocs.length} orphan document(s).`);
    return { cleanedCount };
  } catch (error) {
    console.error('❌ Error executing temporary document cleanup job:', error);
    return { cleanedCount: 0, error: error.message };
  }
}

/**
 * Start the scheduled cleanup cron job
 */
function startCleanupScheduler() {
  // Schedule to run every hour at minute 0
  cron.schedule('0 * * * *', async () => {
    await cleanupTemporaryDocuments();
  });
  console.log('⏰ Temporary document cleanup scheduler initialized (runs hourly).');
}

module.exports = {
  cleanupTemporaryDocuments,
  startCleanupScheduler
};
