/**
 * مساعدات فحص نطاقات أرقام السندات والتحقق من عدم تداخلها
 */

/**
 * يفحص ما إذا كان هناك تداخل بين نطاقين [startA, endA] و [startB, endB]
 * @param {number} startA 
 * @param {number} endA 
 * @param {number} startB 
 * @param {number} endB 
 * @returns {boolean} true إذا كان هناك تداخل
 */
function doRangesOverlap(startA, endA, startB, endB) {
  const sA = Number(startA);
  const eA = Number(endA);
  const sB = Number(startB);
  const eB = Number(endB);

  if (isNaN(sA) || isNaN(eA) || isNaN(sB) || isNaN(eB)) {
    return true; // في حالة وجود قيم غير رقمية نعتبره خطأ تداخل
  }

  return Math.max(sA, sB) <= Math.min(eA, eB);
}

/**
 * حساب تفاصيل أمر الصرف والتحقق من صحة المدخلات
 * @param {number} startNumber 
 * @param {number} bookSize 
 * @param {number} booksCount 
 */
function calculateBatchDetails(startNumber, bookSize, booksCount) {
  const start = parseInt(startNumber, 10);
  const size = parseInt(bookSize, 10);
  const count = parseInt(booksCount, 10);

  if (isNaN(start) || start < 1) {
    throw new Error('بداية رقم السند يجب أن تكون رقماً موجباً صحيحاً أكبر من 0');
  }
  if (isNaN(size) || size < 1) {
    throw new Error('مدى الدفتر الواحد يجب أن يكون رقماً موجباً أكبر من 0');
  }
  if (isNaN(count) || count < 1) {
    throw new Error('عدد الدفاتر يجب أن يكون رقماً موجباً أكبر من 0');
  }

  const totalDocuments = size * count;
  const endNumber = start + totalDocuments - 1;

  // تقسيم الدفاتر إلى نطاقات متتابعة
  const subBooks = [];
  let currentStart = start;

  for (let i = 1; i <= count; i++) {
    const currentEnd = currentStart + size - 1;
    subBooks.push({
      index: i,
      start_number: currentStart,
      end_number: currentEnd,
      total_documents: size
    });
    currentStart = currentEnd + 1;
  }

  return {
    start_number: start,
    book_size: size,
    books_count: count,
    total_documents: totalDocuments,
    end_number: endNumber,
    subBooks
  };
}

module.exports = {
  doRangesOverlap,
  calculateBatchDetails
};
