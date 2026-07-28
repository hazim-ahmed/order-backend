const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);

if (args.length === 0) {
  console.error('يرجى تحديد اسم الموديل. مثال: node generateCrud.js Product');
  process.exit(1);
}

const ModelName = args[0];
// Capitalize first letter
const CapitalizedModel = ModelName.charAt(0).toUpperCase() + ModelName.slice(1);
// Lowercase for variables and filenames
const LowerCaseModel = ModelName.charAt(0).toLowerCase() + ModelName.slice(1);

const basePath = path.join(__dirname, '..', 'src');
const modelsPath = path.join(basePath, 'models', `${CapitalizedModel}.js`);
const controllersPath = path.join(basePath, 'controllers', `${LowerCaseModel}Controller.js`);
const routesPath = path.join(basePath, 'routes', `${LowerCaseModel}Routes.js`);

// 1. Generate Model
const modelContent = `const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const ${CapitalizedModel} = sequelize.define('${CapitalizedModel}', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false
  },
  // أضف المزيد من الحقول هنا...
}, {
  tableName: '${LowerCaseModel}s',
  timestamps: true,
});

module.exports = ${CapitalizedModel};
`;

// 2. Generate Controller
const controllerContent = `const { ${CapitalizedModel} } = require('../models');

// جلب الكل
const getAll = async (req, res) => {
  try {
    const data = await ${CapitalizedModel}.findAll();
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// جلب عنصر واحد
const getById = async (req, res) => {
  try {
    const { id } = req.params;
    const item = await ${CapitalizedModel}.findByPk(id);
    if (!item) return res.status(404).json({ message: 'العنصر غير موجود' });
    res.status(200).json(item);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// إنشاء عنصر جديد
const create = async (req, res) => {
  try {
    const newItem = await ${CapitalizedModel}.create(req.body);
    res.status(201).json(newItem);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// تحديث عنصر
const update = async (req, res) => {
  try {
    const { id } = req.params;
    const [updated] = await ${CapitalizedModel}.update(req.body, { where: { id } });
    if (!updated) return res.status(404).json({ message: 'العنصر غير موجود' });
    
    const updatedItem = await ${CapitalizedModel}.findByPk(id);
    res.status(200).json(updatedItem);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// حذف عنصر
const remove = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await ${CapitalizedModel}.destroy({ where: { id } });
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
`;

// 3. Generate Route
const routeContent = `const express = require('express');
const router = express.Router();
const ${LowerCaseModel}Controller = require('../controllers/${LowerCaseModel}Controller');

// المسارات الأساسية
router.get('/', ${LowerCaseModel}Controller.getAll);
router.get('/:id', ${LowerCaseModel}Controller.getById);
router.post('/', ${LowerCaseModel}Controller.create);
router.put('/:id', ${LowerCaseModel}Controller.update);
router.delete('/:id', ${LowerCaseModel}Controller.remove);

module.exports = router;
`;

// Helper Function to Create Files
const createFile = (filePath, content, type) => {
  if (fs.existsSync(filePath)) {
    console.log(`⚠️ ملف الـ ${type} موجود مسبقاً: ${filePath}`);
  } else {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`✅ تم إنشاء ملف الـ ${type} بنجاح: ${filePath}`);
  }
};

// Execute creation
console.log(`🚀 بدء إنشاء ملفات CRUD للموديل: ${CapitalizedModel}...`);
createFile(modelsPath, modelContent, 'Model');
createFile(controllersPath, controllerContent, 'Controller');
createFile(routesPath, routeContent, 'Router');

console.log('\\n🎉 اكتمل الإنشاء! لا تنسَ:');
console.log(`1. إضافة ${CapitalizedModel} إلى src/models/index.js (إن وجد).`);
console.log(`2. استيراد ${LowerCaseModel}Routes في src/server.js وتفعيله (app.use('/api/${LowerCaseModel}s', ${LowerCaseModel}Routes)).`);
