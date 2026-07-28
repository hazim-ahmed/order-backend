const fs = require('fs');
const path = require('path');

// إعدادات الـ API (يجب تغيير الرابط إلى الرابط الفعلي للـ ERP)
const ERP_BASE_URL = process.env.ERP_BASE_URL || 'http://your-erp-domain.com/api';

// بيانات الدخول للنظام المحاسبي كما هو موضح في json-api.md
const LOGIN_PAYLOAD = {
  "login_company": "demo_api",
  "username": "demo_api",
  "password": "12345678",
  "app_type": "desktop",
  "app_version": "1.0.0"
};

let authToken = null;

/**
 * 1. دالة تسجيل الدخول للحصول على التوكن
 */
async function loginToERP() {
  console.log("=======================================");
  console.log("🔑 جاري محاولة تسجيل الدخول للنظام المحاسبي...");
  try {
    // افترضنا أن مسار تسجيل الدخول هو /login
    const response = await fetch(`${ERP_BASE_URL}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(LOGIN_PAYLOAD)
    });

    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    
    const data = await response.json();
    console.log("✅ تم تسجيل الدخول بنجاح!");
    
    // حفظ التوكن (الاسم يختلف حسب هيكلة الـ ERP، قد يكون token أو access_token)
    authToken = data.token || data.access_token || '';
    console.log("Token:", authToken);
    return authToken;

  } catch (error) {
    console.error("❌ فشل تسجيل الدخول (الرجاء التأكد من مسار الـ API):", error.message);
    // سنضع توكن وهمي لتكملة الشرح في حالة عدم وجود خادم حقيقي حالياً
    authToken = "demo_dummy_token";
    return authToken;
  }
}

/**
 * 2. دالة لاستقبال البيانات (Pull Data FROM ERP)
 * نحتاج نجلب: قائمة المنتجات + قائمة الحسابات (العملاء)
 */
async function discoverReceivedData() {
  console.log("\n=======================================");
  console.log("📥 [1/2] البيانات التي يجب استقبالها من النظام المحاسبي");
  
  // -- أ: جلب المنتجات (Products) --
  console.log("\n🔹 أ. جلب قائمة المنتجات (/products/get_products_list)");
  try {
    const res = await fetch(`${ERP_BASE_URL}/products/get_products_list`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    const productsData = await res.json();
    console.log("مثال لشكل الاستجابة المتوقعة للمنتج:");
    console.log(productsData[0] || productsData.data[0]);
  } catch(e) {
    console.log("⚠️ (محاكاة) الهيكل المتوقع للمنتج الذي يجب حفظه في قاعدة بيانات OMS:");
    console.log({
      erp_id: "1001",
      name: "مادة خام أ - طن",
      unit: "ton",
      current_price: 500.00,
      stock_balance: 1500.00
    });
  }

  // -- ب: جلب دليل الحسابات / العملاء (Accounts) --
  console.log("\n🔹 ب. جلب الحسابات لتحديث العملاء (/accounting/accounts)");
  try {
    const res = await fetch(`${ERP_BASE_URL}/accounting/accounts`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    const accountsData = await res.json();
    console.log("مثال لحساب (عميل):");
    console.log(accountsData[0] || accountsData.data[0]);
  } catch(e) {
    console.log("⚠️ (محاكاة) الهيكل المتوقع للعميل القادم من الـ ERP:");
    console.log({
      erp_account_id: "21001",
      account_name: "مصنع الخرسانة الحديث",
      account_type: "customer",
      phone: "05xxxxxxx"
    });
  }
}

/**
 * 3. دالة لإرسال البيانات (Push Data TO ERP)
 * نحتاج نرسل: قيد محاسبي أو فاتورة عندما يكتمل الطلب ويتم توصيله (Delivered)
 */
async function discoverSentData() {
  console.log("\n=======================================");
  console.log("📤 [2/2] البيانات التي يجب إرسالها إلى النظام المحاسبي");
  console.log("متى نرسل؟ -> عندما يتم تسليم الطلب للعميل (status = delivered)");

  // الهيكل المتوقع لإنشاء قيد محاسبي (/accounting/add_entry)
  const journalEntryPayload = {
    date: new Date().toISOString().split('T')[0], // تاريخ اليوم
    reference_number: "KMT-20260715-001", // رقم الطلب في نظامنا
    description: "قيد إثبات مبيعات وتسليم طلبية رقم KMT-20260715-001",
    lines: [
      {
        account_id: "21001", // رقم حساب العميل في الـ ERP (المدين)
        debit: 15000.00,
        credit: 0.00,
        description: "قيمة مبيعات 30 طن مادة خام أ"
      },
      {
        account_id: "41001", // رقم حساب إيرادات المبيعات في الـ ERP (الدائن)
        debit: 0.00,
        credit: 15000.00,
        description: "قيمة مبيعات 30 طن مادة خام أ"
      }
    ]
  };

  console.log("\n🔹 إرسال قيد محاسبي لإثبات المديونية (/accounting/add_entry)");
  console.log("شكل البيانات (JSON) التي سيرسلها نظام OMS:");
  console.log(JSON.stringify(journalEntryPayload, null, 2));

  try {
    const res = await fetch(`${ERP_BASE_URL}/accounting/add_entry`, {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json' 
      },
      body: JSON.stringify(journalEntryPayload)
    });
    // const result = await res.json();
    console.log("✅ تم استلام الاستجابة من الـ ERP لحفظ القيد.");
  } catch(e) {
    console.log("⚠️ (محاكاة) فشل الاتصال لعدم وجود رابط حقيقي للـ ERP حتى الآن.");
  }
}

/**
 * تشغيل السكربت
 */
async function runDiscovery() {
  await loginToERP();
  await discoverReceivedData();
  await discoverSentData();
  console.log("\n=======================================");
  console.log("✅ انتهى فحص البيانات!");
}

runDiscovery();
