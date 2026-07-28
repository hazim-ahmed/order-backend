/**
 * src/controllers/clientController.js
 * [إصلاح M-1]: فلترة وتحقق من المدخلات
 * [إصلاح M-2]: إخفاء رسائل الخطأ الداخلية في Production
 */

const { Client } = require('../models');

const isDev = process.env.NODE_ENV !== 'production';

/**
 * جلب جميع العملاء
 */
const getAll = async (req, res) => {
  try {
    const data = await Client.findAll({
      order: [['name', 'ASC']]
    });
    res.status(200).json({ clients: data });
  } catch (error) {
    console.error('clientController.getAll Error:', error);
    res.status(500).json({ error: isDev ? error.message : 'حدث خطأ داخلي في الخادم.' });
  }
};

/**
 * جلب عميل محدد
 */
const getById = async (req, res) => {
  try {
    const { id } = req.params;
    const item = await Client.findByPk(id);
    if (!item) return res.status(404).json({ error: 'العميل غير موجود.' });
    res.status(200).json({ client: item });
  } catch (error) {
    console.error('clientController.getById Error:', error);
    res.status(500).json({ error: isDev ? error.message : 'حدث خطأ داخلي في الخادم.' });
  }
};

/**
 * إنشاء عميل جديد [إصلاح M-1: whitelist الحقول + تحقق من المدخلات]
 */
const create = async (req, res) => {
  try {
    const { name, phone, address } = req.body;

    if (!name?.trim()) {
      return res.status(400).json({ error: 'اسم العميل مطلوب.' });
    }

    const newItem = await Client.create({
      name: name.trim(),
      phone: phone?.trim() || null,
      address: address?.trim() || null
    });

    res.status(201).json({ message: 'تم إضافة العميل بنجاح.', client: newItem });
  } catch (error) {
    console.error('clientController.create Error:', error);
    res.status(500).json({ error: isDev ? error.message : 'حدث خطأ داخلي في الخادم.' });
  }
};

/**
 * تحديث بيانات عميل [إصلاح M-1: whitelist الحقول]
 */
const update = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, phone, address } = req.body;

    const item = await Client.findByPk(id);
    if (!item) return res.status(404).json({ error: 'العميل غير موجود.' });

    const updateData = {};
    if (name?.trim()) updateData.name = name.trim();
    if (phone !== undefined) updateData.phone = phone?.trim() || null;
    if (address !== undefined) updateData.address = address?.trim() || null;

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ error: 'لم يتم تمرير أي بيانات للتحديث.' });
    }

    await item.update(updateData);
    res.status(200).json({ message: 'تم تحديث بيانات العميل بنجاح.', client: item });
  } catch (error) {
    console.error('clientController.update Error:', error);
    res.status(500).json({ error: isDev ? error.message : 'حدث خطأ داخلي في الخادم.' });
  }
};

/**
 * حذف عميل
 */
const remove = async (req, res) => {
  try {
    const { id } = req.params;
    const item = await Client.findByPk(id);
    if (!item) return res.status(404).json({ error: 'العميل غير موجود.' });

    await item.destroy();
    res.status(200).json({ message: 'تم حذف العميل بنجاح.' });
  } catch (error) {
    console.error('clientController.remove Error:', error);
    if (error.name === 'SequelizeForeignKeyConstraintError') {
      return res.status(400).json({ error: 'لا يمكن حذف هذا العميل لأن لديه طلبات مرتبطة به.' });
    }
    res.status(500).json({ error: isDev ? error.message : 'حدث خطأ داخلي في الخادم.' });
  }
};

module.exports = { getAll, getById, create, update, remove };
