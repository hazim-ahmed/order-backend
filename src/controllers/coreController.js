const { Client, Product, User } = require('../models');

// جلب قائمة العملاء
const getClients = async (req, res) => {
  try {
    const clients = await Client.findAll({
      attributes: ['id', 'name', 'phone', 'address']
    });
    res.status(200).json(clients);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// جلب قائمة المنتجات والمواد الخام
const getProducts = async (req, res) => {
  try {
    const products = await Product.findAll({
      attributes: ['id', 'name', 'unit', 'current_price_per_ton', 'stock_quantity']
    });
    res.status(200).json(products);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// جلب قائمة السائقين النشطين
const getDrivers = async (req, res) => {
  try {
    const drivers = await User.findAll({
      where: { role: 'driver', is_active: true },
      attributes: ['id', 'name']
    });
    res.status(200).json(drivers);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  getClients,
  getProducts,
  getDrivers
};
