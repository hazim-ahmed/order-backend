// أدوات حساب رقمية بسيطة لتقليل أخطاء floating point في الكميات والمبالغ.
const roundDecimal = (value, precision = 3) => {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return 0;
  const factor = 10 ** precision;
  return Math.round((number + Number.EPSILON) * factor) / factor;
};

// يجمع رقمين مع تقريب موحد بعد العملية.
const addDecimal = (left, right, precision = 3) => {
  return roundDecimal(Number(left || 0) + Number(right || 0), precision);
};

// يضرب رقمين مع تقريب موحد بعد العملية.
const multiplyDecimal = (left, right, precision = 3) => {
  return roundDecimal(Number(left || 0) * Number(right || 0), precision);
};

// يقسم رقمين مع منع القسمة على صفر وتقريب موحد بعد العملية.
const divideDecimal = (left, right, precision = 3) => {
  const divisor = Number(right || 0);
  if (!Number.isFinite(divisor) || divisor === 0) return 0;
  return roundDecimal(Number(left || 0) / divisor, precision);
};

module.exports = {
  addDecimal,
  divideDecimal,
  multiplyDecimal,
  roundDecimal
};