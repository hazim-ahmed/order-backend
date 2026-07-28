const { Category } = require('../models');

// جلب الكل
const getAll = async (req, res) => {
  try {
    const data = await Category.findAll();
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// جلب عنصر واحد
const getById = async (req, res) => {
  try {
    const { id } = req.params;
    const item = await Category.findByPk(id);
    if (!item) return res.status(404).json({ message: 'العنصر غير موجود' });
    res.status(200).json(item);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// إنشاء عنصر جديد
const create = async (req, res) => {
  try {
    const newItem = await Category.create(req.body);
    res.status(201).json(newItem);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// تحديث عنصر
const update = async (req, res) => {
  try {
    const { id } = req.params;
    const [updated] = await Category.update(req.body, { where: { id } });
    if (!updated) return res.status(404).json({ message: 'العنصر غير موجود' });
    
    const updatedItem = await Category.findByPk(id);
    res.status(200).json(updatedItem);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// حذف عنصر
const remove = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await Category.destroy({ where: { id } });
    if (!deleted) return res.status(404).json({ message: 'العنصر غير موجود' });
    
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  getAll,
  getById,
  create,
  update,
  remove
};
