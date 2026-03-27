import { describe, expect, test } from 'bun:test';
import {
  validateUpcA,
  validateEan13,
  validateGtin14,
  normalizeBarcode,
  detectBarcodeType,
  upcToEan,
} from '../../../../shared/utils';

// ============================================================
// validateUpcA
// ============================================================
describe('validateUpcA', () => {
  test('returns true for valid UPC-A 042100005264', () => {
    // Check digit 4: odd(0,2,0,0,5,6)*3=39 + even(4,1,0,0,2)=7 => 46, (10-6)%10=4
    expect(validateUpcA('042100005264')).toBe(true);
  });

  test('returns true for valid UPC-A 012345678905', () => {
    // Check digit 5: odd(0,2,4,6,8,0)*3=60 + even(1,3,5,7,9)=25 => 85, (10-5)%10=5
    expect(validateUpcA('012345678905')).toBe(true);
  });

  test('returns true for valid UPC-A with check digit 0', () => {
    // 000000000000: all zeros, check digit = (10-0)%10 = 0
    expect(validateUpcA('000000000000')).toBe(true);
  });

  test('returns false for invalid check digit', () => {
    // 042100005260 has wrong check digit (should be 4, not 0)
    expect(validateUpcA('042100005260')).toBe(false);
  });

  test('returns false for another invalid check digit', () => {
    // 012345678901 has wrong check digit (should be 5, not 1)
    expect(validateUpcA('012345678901')).toBe(false);
  });

  test('returns false for non-12-digit string (too short)', () => {
    expect(validateUpcA('04210000526')).toBe(false);
  });

  test('returns false for non-12-digit string (too long)', () => {
    expect(validateUpcA('0421000052644')).toBe(false);
  });

  test('returns false for string with letters', () => {
    expect(validateUpcA('04210000526A')).toBe(false);
  });

  test('returns false for empty string', () => {
    expect(validateUpcA('')).toBe(false);
  });
});

// ============================================================
// validateEan13
// ============================================================
describe('validateEan13', () => {
  test('returns true for valid EAN-13 4006381333931', () => {
    // Digits: 4,0,0,6,3,8,1,3,3,3,9,3 => check digit 1
    // 4*1+0*3+0*1+6*3+3*1+8*3+1*1+3*3+3*1+3*3+9*1+3*3 = 89, (10-9)%10=1
    expect(validateEan13('4006381333931')).toBe(true);
  });

  test('returns true for valid EAN-13 5901234123457', () => {
    // 5*1+9*3+0*1+1*3+2*1+3*3+4*1+1*3+2*1+3*3+4*1+5*3 = 5+27+0+3+2+9+4+3+2+9+4+15 = 83
    // (10-3)%10 = 7. Check digit = 7
    expect(validateEan13('5901234123457')).toBe(true);
  });

  test('returns false for invalid EAN-13 check digit', () => {
    // 4006381333930 has wrong check digit (should be 1, not 0)
    expect(validateEan13('4006381333930')).toBe(false);
  });

  test('returns false for wrong length (12 digits)', () => {
    expect(validateEan13('400638133393')).toBe(false);
  });

  test('returns false for string with letters', () => {
    expect(validateEan13('400638133393A')).toBe(false);
  });

  test('returns false for empty string', () => {
    expect(validateEan13('')).toBe(false);
  });
});

// ============================================================
// validateGtin14
// ============================================================
describe('validateGtin14', () => {
  test('returns true for valid GTIN-14 10614141000415', () => {
    // 1*3+0*1+6*3+1*1+4*3+1*1+4*3+1*1+0*3+0*1+0*3+4*1+1*3 = 55, (10-5)%10=5
    expect(validateGtin14('10614141000415')).toBe(true);
  });

  test('returns true for valid GTIN-14 all zeros', () => {
    // 00000000000000: all zeros, check digit = 0
    expect(validateGtin14('00000000000000')).toBe(true);
  });

  test('returns false for invalid GTIN-14 check digit', () => {
    // 10614141000410 has wrong check digit (should be 5, not 0)
    expect(validateGtin14('10614141000410')).toBe(false);
  });

  test('returns false for wrong length (13 digits)', () => {
    expect(validateGtin14('1061414100041')).toBe(false);
  });

  test('returns false for string with letters', () => {
    expect(validateGtin14('1061414100041A')).toBe(false);
  });
});

// ============================================================
// normalizeBarcode
// ============================================================
describe('normalizeBarcode', () => {
  test('strips hyphens from barcode', () => {
    expect(normalizeBarcode('042-100-005264')).toBe('042100005264');
  });

  test('strips spaces from barcode', () => {
    expect(normalizeBarcode('042 100 005264')).toBe('042100005264');
  });

  test('strips mixed hyphens and spaces', () => {
    expect(normalizeBarcode('042-100 005264')).toBe('042100005264');
  });

  test('pads 11-digit code with leading zero', () => {
    expect(normalizeBarcode('42100005264')).toBe('042100005264');
  });

  test('leaves 12-digit code unchanged', () => {
    expect(normalizeBarcode('042100005264')).toBe('042100005264');
  });

  test('leaves 13-digit code unchanged', () => {
    expect(normalizeBarcode('4006381333931')).toBe('4006381333931');
  });

  test('leaves 14-digit code unchanged', () => {
    expect(normalizeBarcode('10614141000415')).toBe('10614141000415');
  });
});

// ============================================================
// detectBarcodeType
// ============================================================
describe('detectBarcodeType', () => {
  test('detects valid 12-digit UPC-A', () => {
    const result = detectBarcodeType('042100005264');
    expect(result.type).toBe('upc-a');
    expect(result.isValid).toBe(true);
  });

  test('detects invalid 12-digit UPC-A', () => {
    const result = detectBarcodeType('042100005260');
    expect(result.type).toBe('upc-a');
    expect(result.isValid).toBe(false);
  });

  test('detects valid 13-digit EAN-13', () => {
    const result = detectBarcodeType('4006381333931');
    expect(result.type).toBe('ean-13');
    expect(result.isValid).toBe(true);
  });

  test('detects invalid 13-digit EAN-13', () => {
    const result = detectBarcodeType('4006381333930');
    expect(result.type).toBe('ean-13');
    expect(result.isValid).toBe(false);
  });

  test('detects valid 14-digit GTIN-14', () => {
    const result = detectBarcodeType('10614141000415');
    expect(result.type).toBe('gtin-14');
    expect(result.isValid).toBe(true);
  });

  test('detects invalid 14-digit GTIN-14', () => {
    const result = detectBarcodeType('10614141000410');
    expect(result.type).toBe('gtin-14');
    expect(result.isValid).toBe(false);
  });

  test('normalizes 11-digit input and detects as UPC-A', () => {
    // 42100005264 (11 digits) => normalized to 042100005264 => valid UPC-A
    const result = detectBarcodeType('42100005264');
    expect(result.type).toBe('upc-a');
    expect(result.isValid).toBe(true);
  });

  test('detects alphanumeric SKU (letters and digits)', () => {
    const result = detectBarcodeType('ABC-123-XYZ');
    expect(result.type).toBe('sku');
    expect(result.isValid).toBe(true);
  });

  test('detects alphanumeric SKU (min length 4)', () => {
    const result = detectBarcodeType('AB12');
    expect(result.type).toBe('sku');
    expect(result.isValid).toBe(true);
  });

  test('returns unknown for too-short input', () => {
    const result = detectBarcodeType('AB');
    expect(result.type).toBe('unknown');
    expect(result.isValid).toBe(false);
  });

  test('returns unknown for empty string', () => {
    const result = detectBarcodeType('');
    expect(result.type).toBe('unknown');
    expect(result.isValid).toBe(false);
  });
});

// ============================================================
// upcToEan
// ============================================================
describe('upcToEan', () => {
  test('converts 12-digit UPC to 13-digit EAN by adding leading zero', () => {
    expect(upcToEan('042100005264')).toBe('0042100005264');
  });

  test('returns non-12-digit input unchanged (13 digits)', () => {
    expect(upcToEan('4006381333931')).toBe('4006381333931');
  });

  test('returns non-12-digit input unchanged (11 digits)', () => {
    expect(upcToEan('42100005264')).toBe('42100005264');
  });

  test('returns non-12-digit input unchanged (empty string)', () => {
    expect(upcToEan('')).toBe('');
  });
});
