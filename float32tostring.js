'use strict';

// jshint bitwise:false
const float32Arr = new Float32Array(1);
const bytesArr = new Uint32Array(float32Arr.buffer);

// This is a very limited implementation only designed for use with the Grisu algorithm.
function InternalFP() {
  // The bytes of the mantissa.
  this.f = 0;
  // The exponent so that x = f * 2^e.
  this.e = 0;
}

InternalFP.sub = function (result, x, y) {
  // This operation must not involve having to change the exponent of the result (which would make
  // it rather complicated and would lose precision in some cases).
  if (x.e !== y.e || x.f < y.f) throw new RangeError('invalid numbers');
  result.f = x.f - y.f;
  result.e = x.e;
  return result;
};

// In order to distinguish this imprecise from the precise multiplication we will use the
// “rounded” symbol for this operation: ˜r := x⊗y.
InternalFP.mul = function (result, x, y) {
  const xl = x.f & 0xFFFF;
  const xh = x.f >>> 16;

  const yl = y.f & 0xFFFF;
  const yh = y.f >>> 16;

  const xhyl = xh * yl >>> 0;
  const yhxl = yh * xl >>> 0;

  // The 3rd quarter of 16 bit parts plus carry over to the previous quarter.
  let tmp = (xl * yl >>> 16) + (xhyl & 0xFFFF) + (yhxl & 0xFFFF) >>> 0;

  // Perform rounding of result using the "round ties away from zero" method.
  tmp = tmp >>> 15 === 0x1FFFF ? 0x10000 : (tmp + (1 << 15)) >>> 16;

  // NOTE: because the result may not always be normalised (even though both of the inputs are),
  // up to 0.5 ULP of precision may be lost.  Example:
  /*
  const a = new InternalFP();
  const b = new InternalFP();
  const c = new InternalFP();
  a.f = 0x80000001;
  a.e = -31;
  b.f = 0x80000000;
  a.e = -31;
  InternalFP.mul(c, a, b);
  // InternalFP { f: 1073741825, e: -30 }
  // Correct value: { f: 1073741824.5, e: -30 } or { f: 2147483649, e: -31 }
  */
  result.f = (xh * yh >>> 0) + (xhyl >>> 16) + (yhxl >>> 16) + tmp >>> 0;
  result.e = (x.e + y.e + 32) | 0;
  return result;
};

function float32ToString(num) {
  num = +num;

  if (num === Infinity) return 'Infinity';
  if (num === -Infinity) return '-Infinity';
  if (num !== num) return 'NaN';
  if (num === 0) {
    if (1 / num === Infinity) return '0';
    return '-0';
  }

  // jshint bitwise:false
  float32Arr[0] = num;
  const bytes = bytesArr[0];

  const sign = bytes >>> 31; // 0 is positive, 1 is negative
  const exponent = (bytes >>> 23) & 0xFF;
  const mantissa = bytes & 0x7FFFFF; // 2^23-1

  const isSubnormal = exponent === 0;
  const e = isSubnormal ? -178 : exponent - 179;
  const f = isSubnormal ? mantissa : 0x800000 ^ mantissa;




  // Allahu akbarrrrrrrr!!!
  return sign ? '-' + str : str;
}

module.exports = float32ToString;
