const { doRangesOverlap, calculateBatchDetails } = require('../src/utils/rangeValidationHelper');
const { sequelize, User, Order, DeliveryDocumentBatch, DeliveryDocumentBook, DeliveryDocumentUsage } = require('../src/models');

describe('Phase 1: Pure Utility Tests', () => {
  it('should correctly identify overlapping ranges', () => {
    expect(doRangesOverlap(1000, 1049, 1045, 1099)).toBe(true);
    expect(doRangesOverlap(1000, 1049, 1000, 1049)).toBe(true);
    expect(doRangesOverlap(1000, 1049, 950, 1000)).toBe(true);
    expect(doRangesOverlap(1000, 1049, 1020, 1030)).toBe(true);
  });

  it('should correctly identify non-overlapping ranges', () => {
    expect(doRangesOverlap(1000, 1049, 1050, 1099)).toBe(false);
    expect(doRangesOverlap(1000, 1049, 900, 999)).toBe(false);
  });

  it('should calculate batch details and split books correctly', () => {
    const details = calculateBatchDetails(1000, 50, 3);
    expect(details.start_number).toBe(1000);
    expect(details.book_size).toBe(50);
    expect(details.books_count).toBe(3);
    expect(details.total_documents).toBe(150);
    expect(details.end_number).toBe(1149);

    expect(details.subBooks).toHaveLength(3);
    expect(details.subBooks[0]).toEqual({ index: 1, start_number: 1000, end_number: 1049, total_documents: 50 });
    expect(details.subBooks[1]).toEqual({ index: 2, start_number: 1050, end_number: 1099, total_documents: 50 });
    expect(details.subBooks[2]).toEqual({ index: 3, start_number: 1100, end_number: 1149, total_documents: 50 });
  });

  it('should throw validation error when given invalid input numbers', () => {
    expect(() => calculateBatchDetails(0, 50, 3)).toThrow();
    expect(() => calculateBatchDetails(1000, 0, 3)).toThrow();
    expect(() => calculateBatchDetails(1000, 50, -1)).toThrow();
    expect(() => calculateBatchDetails('abc', 50, 3)).toThrow();
  });
});

describe('Phase 1: DB Models & Associations Integration', () => {
  let adminUser;
  let inventoryManagerUser;
  let driverUser;
  let testOrder;
  let testBatch;

  beforeAll(async () => {
    try {
      await sequelize.authenticate();
      await DeliveryDocumentBatch.sync();
      await DeliveryDocumentBook.sync();
      await DeliveryDocumentUsage.sync();
    } catch (e) {
      console.warn('DB not reachable in test environment, skipping DB sync hook.');
    }
  }, 10000);

  afterAll(async () => {
    try {
      await sequelize.close();
    } catch (e) {}
  });

  it('should create a DeliveryDocumentBatch with linked books and associations', async () => {
    try {
      await sequelize.authenticate();
    } catch (e) {
      console.log('Skipping DB test because MySQL server is offline in test env.');
      return;
    }

    [adminUser] = await User.findOrCreate({
      where: { username: 'test_admin_phase1' },
      defaults: { name: 'Admin Test Phase1', username: 'test_admin_phase1', role: 'admin', password_hash: 'hash' }
    });

    [inventoryManagerUser] = await User.findOrCreate({
      where: { username: 'test_inv_mgr_phase1' },
      defaults: { name: 'Inventory Mgr Test Phase1', username: 'test_inv_mgr_phase1', role: 'inventory_manager', password_hash: 'hash' }
    });

    [driverUser] = await User.findOrCreate({
      where: { username: 'test_driver_phase1' },
      defaults: { name: 'Driver Test Phase1', username: 'test_driver_phase1', role: 'driver', password_hash: 'hash' }
    });

    const uniqueOrderNo = `KMT-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    testOrder = await Order.create({
      order_number: uniqueOrderNo,
      total_tons: 10,
      total_amount: 5000,
      status: 'assigned_to_driver',
      driver_id: driverUser.id
    });

    const batchNo = `BATCH-${Date.now()}`;
    testBatch = await DeliveryDocumentBatch.create({
      batch_number: batchNo,
      inventory_manager_id: inventoryManagerUser.id,
      start_number: 2000,
      book_size: 50,
      books_count: 2,
      total_documents: 100,
      end_number: 2099,
      created_by: adminUser.id,
      notes: 'اختبار تجريبي لأوامر الصرف'
    });

    expect(testBatch.id).toBeDefined();
    expect(testBatch.end_number).toBe(2099);

    const book1 = await DeliveryDocumentBook.create({
      batch_id: testBatch.id,
      book_number: `BOOK-${Date.now()}-001`,
      inventory_manager_id: inventoryManagerUser.id,
      driver_id: driverUser.id,
      start_number: 2000,
      end_number: 2049,
      total_documents: 50,
      used_documents_count: 1,
      remaining_documents_count: 49,
      status: 'assigned',
      assigned_by: inventoryManagerUser.id,
      assigned_at: new Date()
    });

    expect(book1.id).toBeDefined();
    expect(book1.remaining_documents_count).toBe(49);

    const usage = await DeliveryDocumentUsage.create({
      book_id: book1.id,
      order_id: testOrder.id,
      driver_id: driverUser.id,
      document_number: 2000,
      used_at: new Date()
    });

    expect(usage.id).toBeDefined();
    expect(usage.document_number).toBe(2000);

    const fetchedBatch = await DeliveryDocumentBatch.findByPk(testBatch.id, {
      include: [
        { model: User, as: 'inventoryManager' },
        { model: User, as: 'createdBy' },
        { model: DeliveryDocumentBook, as: 'books' }
      ]
    });

    expect(fetchedBatch.inventoryManager.username).toBe(inventoryManagerUser.username);
    expect(fetchedBatch.createdBy.username).toBe(adminUser.username);
    expect(fetchedBatch.books).toHaveLength(1);
    expect(fetchedBatch.books[0].id).toBe(book1.id);
  });
});
