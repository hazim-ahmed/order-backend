/**
 * src/controllers/productController.js
 * [إصلاح M-1]: فلترة وتحقق من المدخلات
 * [إصلاح M-2]: إخفاء رسائل الخطأ الداخلية في Production
 */

const { Product, Category, ERPSettings, sequelize } = require('../models');
const axios = require('axios');
const net = require('net');

const isDev = process.env.NODE_ENV !== 'production';

/**
 * دالة مساعدة لاستخراج مصفوفة المنتجات عبر الفحص الشامل والعميق لجميع المستويات في استجابة الـ ERP
 */
const extractProductsArray = (responseData) => {
  if (!responseData) return null;
  
  let data = responseData;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch (e) {
      return null;
    }
  }

  if (Array.isArray(data)) return data;
  if (typeof data !== 'object') return null;

  // استخدام خوارزمية BFS للفحص العميق لكافة الخصائص والمستويات في كائن الاستجابة
  const queue = [data];
  const visited = new Set();
  let firstEmptyArray = null;

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== 'object' || visited.has(current)) continue;
    visited.add(current);

    if (Array.isArray(current)) {
      if (current.length > 0) return current;
      if (!firstEmptyArray) firstEmptyArray = current;
      continue;
    }

    for (const key of Object.keys(current)) {
      const val = current[key];
      if (Array.isArray(val)) {
        if (val.length > 0) {
          return val; // العثور على مصفوفة تحتوي منتجات!
        } else if (!firstEmptyArray) {
          firstEmptyArray = val;
        }
      } else if (val && typeof val === 'object' && !visited.has(val)) {
        queue.push(val);
      }
    }
  }

  return firstEmptyArray;
};

/**
 * جلب جميع المنتجات
 */
const getAll = async (req, res) => {
  try {
    const data = await Product.findAll({
      order: [['name', 'ASC']],
      include: [{ model: Category, as: 'category', attributes: ['id', 'name'] }]
    });
    res.status(200).json({ products: data });
  } catch (error) {
    console.error('productController.getAll Error:', error);
    res.status(500).json({ error: isDev ? error.message : 'حدث خطأ داخلي في الخادم.' });
  }
};

/**
 * جلب منتج محدد
 */
const getById = async (req, res) => {
  try {
    const { id } = req.params;
    const item = await Product.findByPk(id, {
      include: [{ model: Category, as: 'category', attributes: ['id', 'name'] }]
    });
    if (!item) return res.status(404).json({ error: 'المنتج غير موجود.' });
    res.status(200).json({ product: item });
  } catch (error) {
    console.error('productController.getById Error:', error);
    res.status(500).json({ error: isDev ? error.message : 'حدث خطأ داخلي في الخادم.' });
  }
};

/**
 * إنشاء منتج جديد [إصلاح M-1: whitelist الحقول + تحقق]
 */
const create = async (req, res) => {
  try {
    const { name, sku, category_id, current_price_per_ton, stock_quantity, unit } = req.body;

    if (!name?.trim()) return res.status(400).json({ error: 'اسم المنتج مطلوب.' });

    const price = Number(current_price_per_ton);
    if (!Number.isFinite(price) || price <= 0) {
      return res.status(400).json({ error: 'السعر الحالي يجب أن يكون رقماً موجباً.' });
    }

    const stock = Number(stock_quantity);
    if (!Number.isFinite(stock) || stock < 0) {
      return res.status(400).json({ error: 'كمية المخزون يجب أن تكون رقماً موجباً أو صفر.' });
    }

    const newItem = await Product.create({
      name: name.trim(),
      sku: sku?.trim() || null,
      category_id: category_id || null,
      current_price_per_ton: price,
      stock_quantity: stock,
      unit: unit?.trim() || 'kg'
    });

    res.status(201).json({ message: 'تم إضافة المنتج بنجاح.', product: newItem });
  } catch (error) {
    console.error('productController.create Error:', error);
    res.status(500).json({ error: isDev ? error.message : 'حدث خطأ داخلي في الخادم.' });
  }
};

/**
 * تحديث منتج [إصلاح M-1: whitelist الحقول]
 */
const update = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, sku, category_id, current_price_per_ton, stock_quantity, unit } = req.body;

    const item = await Product.findByPk(id);
    if (!item) return res.status(404).json({ error: 'المنتج غير موجود.' });

    const updateData = {};
    if (name?.trim()) updateData.name = name.trim();
    if (sku !== undefined) updateData.sku = sku?.trim() || null;
    if (category_id !== undefined) updateData.category_id = category_id || null;
    if (unit?.trim()) updateData.unit = unit.trim();

    if (current_price_per_ton !== undefined) {
      const price = Number(current_price_per_ton);
      if (!Number.isFinite(price) || price <= 0) {
        return res.status(400).json({ error: 'السعر يجب أن يكون رقماً موجباً.' });
      }
      updateData.current_price_per_ton = price;
    }

    if (stock_quantity !== undefined) {
      const stock = Number(stock_quantity);
      if (!Number.isFinite(stock) || stock < 0) {
        return res.status(400).json({ error: 'الكمية يجب أن تكون رقماً موجباً أو صفر.' });
      }
      updateData.stock_quantity = stock;
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ error: 'لم يتم تمرير أي بيانات للتحديث.' });
    }

    await item.update(updateData);
    res.status(200).json({ message: 'تم تحديث المنتج بنجاح.', product: item });
  } catch (error) {
    console.error('productController.update Error:', error);
    res.status(500).json({ error: isDev ? error.message : 'حدث خطأ داخلي في الخادم.' });
  }
};

/**
 * دالة تنظيف وتحويل السلاسل النصية أو القيم الرقمية لقيم رقمية صحيحة
 */
const parseNumber = (val) => {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  if (typeof val === 'string') {
    const cleaned = val.replace(/,/g, '').replace(/[^\d.-]/g, '');
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : num;
  }
  return 0;
};

/**
 * استخراج سعر الطن/المنتج بحس ديناميكي واسع
 */
const extractPrice = (p) => {
  if (!p || typeof p !== 'object') return 0;

  const candidates = [
    p.price,
    p.sale_price,
    p.selling_price,
    p.sell_price,
    p.cost_price,
    p.unit_price,
    p.price_per_ton,
    p.current_price_per_ton,
    p.current_price,
    p.price_ton,
    p.rate,
    p.amount,
    p.standard_rate,
    p.valuation_rate,
    p.sales_price,
    p.default_price,
    p.item_price,
    p.product_price,
    p.price_sar,
    p.price1,
    p.price_1,
    p.prices?.[0]?.price,
    p.prices?.[0]?.amount,
    p.price_details?.price,
    p.price_info?.price,
    p.price?.amount,
    p.price?.value
  ];

  for (const cand of candidates) {
    const parsed = parseNumber(cand);
    if (parsed > 0) return parsed;
  }

  for (const key of Object.keys(p)) {
    const lkey = key.toLowerCase();
    if (lkey.includes('price') || lkey.includes('rate') || lkey.includes('cost')) {
      const parsed = parseNumber(p[key]);
      if (parsed > 0) return parsed;
    }
  }

  return 0;
};

/**
 * استخراج الكمية/المخزون المتاح بحس ديناميكي واسع
 */
const extractStock = (p) => {
  if (!p || typeof p !== 'object') return 0;

  const candidates = [
    p.stock_quantity,
    p.stock,
    p.quantity,
    p.qty,
    p.balance,
    p.stock_qty,
    p.available_qty,
    p.available_stock,
    p.total_qty,
    p.actual_qty,
    p.opening_stock,
    p.current_stock,
    p.qty_on_hand,
    p.quantity_on_hand,
    p.in_stock,
    p.count,
    p.stock_info?.qty,
    p.stock_info?.quantity,
    p.stock_details?.quantity,
    p.inventory?.qty,
    p.inventory?.quantity
  ];

  for (const cand of candidates) {
    if (cand !== undefined && cand !== null && cand !== '') {
      const parsed = parseNumber(cand);
      if (parsed >= 0) return parsed;
    }
  }

  for (const key of Object.keys(p)) {
    const lkey = key.toLowerCase();
    if (lkey.includes('stock') || lkey.includes('qty') || lkey.includes('quantity') || lkey.includes('balance')) {
      const parsed = parseNumber(p[key]);
      if (parsed >= 0) return parsed;
    }
  }

  return 0;
};

/**
 * حذف منتج
 */
const remove = async (req, res) => {
  try {
    const { id } = req.params;
    const item = await Product.findByPk(id);
    if (!item) return res.status(404).json({ error: 'المنتج غير موجود.' });

    await item.destroy();
    res.status(200).json({ message: 'تم حذف المنتج بنجاح.' });
  } catch (error) {
    console.error('productController.remove Error:', error);
    if (error.name === 'SequelizeForeignKeyConstraintError') {
      return res.status(400).json({ error: 'لا يمكن حذف هذا المنتج لأنه مرتبط بطلبات في النظام.' });
    }
    res.status(500).json({ error: isDev ? error.message : 'حدث خطأ داخلي في الخادم.' });
  }
};

// يقرأ القوائم النصية المفصولة بفواصل ويعيدها بدون فراغات أو تكرار.
const parseCommaList = (...values) => {
  return Array.from(new Set(values
    .filter(Boolean)
    .flatMap(value => String(value).split(','))
    .map(value => value.trim().toLowerCase())
    .filter(Boolean)));
};

// يفحص نطاقات IPv4 الخاصة والمحلية لمنع SSRF نحو الشبكات الداخلية.
const isPrivateIPv4 = (hostname) => {
  const parts = hostname.split('.').map(part => Number(part));
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 10 ||
    parts[0] === 127 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168);
};

// يمنع أسماء المضيفين والعناوين الداخلية الشائعة قبل الاتصال الخارجي.
const isForbiddenErpHost = (hostname) => {
  const normalizedHost = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (['localhost', '0.0.0.0', '::1'].includes(normalizedHost)) return true;
  if (normalizedHost.endsWith('.internal') || normalizedHost.endsWith('.local')) return true;
  if (net.isIP(normalizedHost) === 4 && isPrivateIPv4(normalizedHost)) return true;
  if (net.isIP(normalizedHost) === 6 && (normalizedHost.startsWith('fc') || normalizedHost.startsWith('fd') || normalizedHost.startsWith('fe80'))) return true;
  return false;
};

// يتحقق من رابط ERP باستخدام HTTPS في الإنتاج وallowlist عند ضبطها.
const validateErpBaseUrl = (cleanBaseUrl, allowedHosts) => {
  const parsedUrl = new URL(cleanBaseUrl);
  const hostname = parsedUrl.hostname.toLowerCase();
  const isDevEnv = process.env.NODE_ENV === 'development';

  if (!isDevEnv && parsedUrl.protocol !== 'https:') {
    throw new Error('رابط ERP يجب أن يعمل عبر HTTPS فقط في بيئة الإنتاج.');
  }
  if (isForbiddenErpHost(hostname)) {
    throw new Error('عنوان ERP المرفق غير مسموح به لأن العناوين الداخلية محظورة.');
  }
  if (allowedHosts.length > 0 && !allowedHosts.includes(hostname)) {
    throw new Error('نطاق ERP غير موجود في قائمة النطاقات المسموحة.');
  }

  return parsedUrl;
};
/**
 * مزامنة المنتجات مع الـ ERP الخارجي
 */
const syncErp = async (req, res) => {
  try {
    const { category_id } = req.body;
    const activeErpSettings = await ERPSettings.findOne({ where: { is_active: true }, order: [['updatedAt', 'DESC']] });
    const bodyCredentialsAllowed = process.env.ALLOW_ERP_CREDENTIALS_IN_BODY === 'true' && process.env.NODE_ENV !== 'production';
    const requestCredentials = bodyCredentialsAllowed ? req.body : {};

    const login_company = activeErpSettings?.login_company || requestCredentials.login_company;
    const username = activeErpSettings?.username || requestCredentials.username;
    const password = activeErpSettings ? ERPSettings.decryptPassword(activeErpSettings) : requestCredentials.password;
    const app_type = activeErpSettings?.app_type || requestCredentials.app_type || 'desktop';
    const app_version = activeErpSettings?.app_version || requestCredentials.app_version || '1.0.0';

    if (!login_company || !username || !password) {
      return res.status(400).json({ error: 'إعدادات ERP غير مكتملة. الرجاء حفظ بيانات الاعتماد من مسار إعدادات ERP الآمن.' });
    }

    const rawUrl = activeErpSettings?.base_url || process.env.ERP_BASE_URL;
    if (!rawUrl || !String(rawUrl).trim()) {
      return res.status(400).json({ error: 'رابط ERP غير مضبوط في الإعدادات أو متغيرات البيئة.' });
    }
    const cleanBaseUrl = String(rawUrl).trim().endsWith('/') ? String(rawUrl).trim().slice(0, -1) : String(rawUrl).trim();
    const allowedHosts = parseCommaList(process.env.ERP_ALLOWED_HOSTS, activeErpSettings?.allowed_hosts);

    try {
      validateErpBaseUrl(cleanBaseUrl, allowedHosts);
    } catch (error) {
      return res.status(400).json({ error: error.message || 'رابط ERP غير صالح.' });
    }

    const targetCategoryId = category_id ? Number(category_id) : 3;
    let targetCategory = await Category.findByPk(targetCategoryId);
    if (!targetCategory) {
      targetCategory = await Category.create({
        id: targetCategoryId,
        name: `قسم الـ ERP الرئيسي (رقم ${targetCategoryId})`,
        description: 'قسم رئيسي تم إنشاؤه تلقائياً لربط منتجات الـ ERP'
      }).catch(err => {
        console.warn('تنبيه: تعذر إنشاء القسم تلقائياً:', err.message);
      });
    }

    // 1. تسجيل الدخول في ERP للحصول على Token
    console.log(`🔗 محاولة تسجيل الدخول إلى ERP: ${cleanBaseUrl}/user/login`);
    const loginResponse = await axios.post(`${cleanBaseUrl}/user/login`, {
      login_company,
      username,
      password,
      app_type: app_type || 'desktop',
      app_version: app_version || '1.0.0'
    }, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Accept': 'application/json'
      }
    });

    if (loginResponse.data && loginResponse.data.success === false) {
      return res.status(401).json({ 
        error: loginResponse.data.message || 'تسجيل الدخول فشل، يرجى مراجعة بيانات الدخول'
      });
    }

    const setCookieHeader = loginResponse.headers['set-cookie'] 
      ? loginResponse.headers['set-cookie'].map(c => c.split(';')[0]).join('; ') 
      : '';

    const token = loginResponse.data?.data?.access_token || 
                  loginResponse.data?.access_token || 
                  loginResponse.data?.token ||
                  loginResponse.data?.data?.token ||
                  loginResponse.data?.session_id ||
                  loginResponse.data?.data?.session_id || '';

    // 2. قائمة استراتيجيات المصادقة وجلب المنتجات من الـ ERP
    console.log(`📦 جلب المنتجات من ERP باستراتيجيات مصادقة متعددة...`);

    const authStrategies = [
      { headers: { 'Authorization': `Bearer ${token}` }, params: { offset: 0, limit: 1000 } },
      { headers: { 'Authorization': token }, params: { offset: 0, limit: 1000 } },
      { headers: { 'Authorization': `Authorization=${token}` }, params: { offset: 0, limit: 1000 } },
      { headers: {}, params: { token, offset: 0, limit: 1000 } },
      { headers: {}, params: { access_token: token, offset: 0, limit: 1000 } },
      ...(setCookieHeader ? [{ headers: { 'Cookie': setCookieHeader }, params: { offset: 0, limit: 1000 } }] : []),
      ...(setCookieHeader ? [{ headers: { 'Cookie': setCookieHeader, 'Authorization': `Bearer ${token}` }, params: { offset: 0, limit: 1000 } }] : []),
      { headers: { 'token': token }, params: { offset: 0, limit: 1000 } },
      { headers: { 'x-access-token': token }, params: { offset: 0, limit: 1000 } }
    ];

    let productsResponse = null;
    let erpProducts = null;

    for (const strat of authStrategies) {
      try {
        const res = await axios.get(`${cleanBaseUrl}/products/get_products_list`, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            'Accept': 'application/json',
            ...strat.headers
          },
          params: strat.params,
          validateStatus: () => true,
          timeout: 8000
        });

        if (res.data && res.data.logged_in !== false && res.data.success !== false) {
          const extracted = extractProductsArray(res.data);
          if (extracted && Array.isArray(extracted)) {
            productsResponse = res;
            erpProducts = extracted;
            console.log(`✅ تم جلب المنتجات بنجاح باستخدام استراتيجية مصادقة متوافقة.`);
            break;
          }
        }

        if (!productsResponse && res.data) {
          productsResponse = res;
        }
      } catch (e) {
        // تجربة الاستراتيجية التالية
      }
    }

    // التحقق من رسالة عدم التصريح
    if (productsResponse?.data && (productsResponse.data.logged_in === false || productsResponse.data.message?.toLowerCase().includes('unauthorized'))) {
      return res.status(401).json({ 
        error: 'غير مصرح بالوصول إلى قائمة المنتجات من الـ ERP. يرجى التأكد من اسم المستخدم، كلمة المرور، وصلاحيات الحساب في الـ ERP.',
        details: isDev ? productsResponse.data.message : null
      });
    }

    if (!erpProducts || !Array.isArray(erpProducts)) {
      console.error('❌ هيكل استجابة المنتجات غير معروف:', JSON.stringify(productsResponse?.data || {}).slice(0, 300));
      return res.status(400).json({ 
        error: 'تنسيق بيانات المنتجات القادمة من الـ ERP غير مدعوم أو فارغ. تاكد من تنسيق البيانات.',
        details: isDev ? (typeof productsResponse?.data === 'object' ? Object.keys(productsResponse?.data || {}) : String(productsResponse?.data)) : null
      });
    }

    let syncedCount = 0;

    // 3. تحديث أو إضافة المنتجات في قاعدة البيانات المحلية وربطها بالقسم المطلوب (ID: 3)
    for (const p of erpProducts) {
      if (!p || typeof p !== 'object') continue;

      const erpId = p.id || p.product_id || p.item_id || p.code || p.sku || p.ERP_ID || p.productId;
      const name = p.name || p.product_name || p.item_name || p.title || p.label || p.productName || 'منتج غير مسمى';
      const price = extractPrice(p);
      const stock = extractStock(p);
      const unit = p.unit || p.unit_name || p.uom || p.unit_type || 'kg';

      if (syncedCount < 3) {
        console.log(`📦 صنف ERP مستورد [${name}] => السعر: ${price} | الكمية: ${stock} | معرف ERP: ${erpId || 'لا يوجد'}`);
      }

      let product = null;
      if (erpId) {
        product = await Product.findOne({ where: { erp_id: String(erpId) } });
      }
      if (!product) {
        product = await Product.findOne({ where: { name: name.trim() } });
      }

      if (product) {
        product.name = name.trim();
        product.current_price_per_ton = price;
        product.stock_quantity = stock;
        if (erpId) product.erp_id = String(erpId);
        product.category_id = targetCategoryId;
        product.unit = String(unit).trim() || 'kg';
        await product.save();
      } else {
        await Product.create({
          name: name.trim(),
          erp_id: erpId ? String(erpId) : null,
          current_price_per_ton: Number(price) > 0 ? Number(price) : 0,
          stock_quantity: Number(stock) > 0 ? Number(stock) : 0,
          category_id: targetCategoryId,
          unit: String(unit).trim() || 'kg',
          is_active: true
        });
      }
      
      syncedCount++;
    }

    res.status(200).json({ 
      message: `تم مزامنة ${syncedCount} منتج بنجاح وربطها بالقسم (ID: ${targetCategoryId}).`, 
      count: syncedCount,
      categoryId: targetCategoryId
    });

  } catch (error) {
    console.error('productController.syncErp Error:', error.response?.data || error.message);
    res.status(500).json({ 
      error: 'فشل الاتصال بالـ ERP أو حدث خطأ أثناء المزامنة.',
      details: isDev ? (error.response?.data?.message || error.message) : null
    });
  }
};

/**
 * حذف كافة المنتجات من النظام
 */
const removeAll = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    // نحذف المنتجات كعملية واحدة حتى لا ينتهي النظام بحذف جزئي.
    const deletedCount = await Product.destroy({ where: {}, transaction });

    await transaction.commit();
    res.status(200).json({
      message: deletedCount === 0 ? 'لا توجد منتجات لحذفها.' : `تم حذف ${deletedCount} منتج بنجاح.`,
      count: deletedCount,
      failedCount: 0
    });
  } catch (error) {
    await transaction.rollback();
    console.error('productController.removeAll Error:', error);
    if (error.name === 'SequelizeForeignKeyConstraintError') {
      return res.status(400).json({ error: 'لا يمكن حذف جميع المنتجات لأن بعضها مرتبط بطلبات مسجلة في النظام.' });
    }
    res.status(500).json({ error: isDev ? error.message : 'حدث خطأ أثناء تنفيذ أمر حذف كافة المنتجات.' });
  }
};
module.exports = { getAll, getById, create, update, remove, removeAll, syncErp };

