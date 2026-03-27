import { describe, expect, test } from 'bun:test';
import { formatCurrency, formatPricePerUnit, formatQuantity, truncate, formatElapsedTime, getStageIcon } from '../src/utils';

describe('formatCurrency', () => {
  test('formats USD', () => {
    expect(formatCurrency(19.99, 'USD')).toBe('$19.99');
  });

  test('formats EUR', () => {
    expect(formatCurrency(15.50, 'EUR')).toBe('\u20ac15.50');
  });

  test('formats GBP', () => {
    expect(formatCurrency(12.99, 'GBP')).toBe('\u00a312.99');
  });

  test('formats JPY', () => {
    expect(formatCurrency(1500, 'JPY')).toBe('\u00a51500.00');
  });

  test('formats AUD', () => {
    expect(formatCurrency(25.00, 'AUD')).toBe('A$25.00');
  });

  test('formats CAD', () => {
    expect(formatCurrency(30.00, 'CAD')).toBe('C$30.00');
  });

  test('formats INR', () => {
    expect(formatCurrency(100, 'INR')).toBe('\u20b9100.00');
  });

  test('returns em dash for null', () => {
    expect(formatCurrency(null, 'USD')).toBe('\u2014');
  });

  test('returns em dash for undefined', () => {
    expect(formatCurrency(undefined, 'USD')).toBe('\u2014');
  });

  test('returns em dash for NaN', () => {
    expect(formatCurrency(NaN, 'USD')).toBe('\u2014');
  });

  test('uses currency code as prefix for unknown currencies', () => {
    expect(formatCurrency(10.50, 'SEK')).toBe('SEK 10.50');
  });

  test('formats zero as $0.00, not em dash', () => {
    expect(formatCurrency(0, 'USD')).toBe('$0.00');
  });
});

describe('formatPricePerUnit', () => {
  test('formats normal values with 2 decimals', () => {
    expect(formatPricePerUnit(0.20, 'g')).toBe('0.20/g');
  });

  test('formats very small values with 4 decimals', () => {
    expect(formatPricePerUnit(0.0045, 'g')).toBe('0.0045/g');
  });

  test('formats with arbitrary unit', () => {
    expect(formatPricePerUnit(1.50, 'capsules')).toBe('1.50/capsules');
  });

  test('returns em dash with unit for null', () => {
    expect(formatPricePerUnit(null, 'g')).toBe('\u2014/g');
  });

  test('returns em dash with unit for undefined', () => {
    expect(formatPricePerUnit(undefined, 'g')).toBe('\u2014/g');
  });
});

describe('formatQuantity', () => {
  test('formats quantity with unit', () => {
    expect(formatQuantity(500, 'g')).toBe('500 g');
  });

  test('formats capsules', () => {
    expect(formatQuantity(60, 'capsules')).toBe('60 capsules');
  });

  test('returns em dash for null', () => {
    expect(formatQuantity(null, 'g')).toBe('\u2014');
  });

  test('returns em dash for undefined', () => {
    expect(formatQuantity(undefined, 'g')).toBe('\u2014');
  });
});

describe('truncate', () => {
  test('returns original if shorter than maxLength', () => {
    expect(truncate('hello', 10)).toBe('hello');
  });

  test('truncates with ellipsis when too long', () => {
    expect(truncate('hello world foo', 8)).toBe('hello...');
  });

  test('returns original if exactly maxLength', () => {
    expect(truncate('hello', 5)).toBe('hello');
  });

  test('returns original if length equals maxLength (short)', () => {
    expect(truncate('ab', 2)).toBe('ab');
  });

  test('truncates correctly at boundary', () => {
    expect(truncate('abcdef', 5)).toBe('ab...');
  });
});

describe('formatElapsedTime', () => {
  test('formats milliseconds below 1 second', () => {
    expect(formatElapsedTime(500)).toBe('500ms');
  });

  test('formats 999ms', () => {
    expect(formatElapsedTime(999)).toBe('999ms');
  });

  test('formats exactly 1 second', () => {
    expect(formatElapsedTime(1000)).toBe('1s');
  });

  test('formats multiple seconds', () => {
    expect(formatElapsedTime(5000)).toBe('5s');
  });

  test('formats just under 1 minute', () => {
    expect(formatElapsedTime(59999)).toBe('59s');
  });

  test('formats exactly 1 minute', () => {
    expect(formatElapsedTime(60000)).toBe('1m 0s');
  });

  test('formats minutes and seconds', () => {
    expect(formatElapsedTime(125000)).toBe('2m 5s');
  });
});

describe('getStageIcon', () => {
  test('returns ... for all known stages', () => {
    for (const stage of ['starting', 'searching', 'crawling', 'extracting', 'ranking', 'complete']) {
      expect(getStageIcon(stage)).toBe('...');
    }
  });

  test('returns ... for unknown stage', () => {
    expect(getStageIcon('unknown')).toBe('...');
  });
});
