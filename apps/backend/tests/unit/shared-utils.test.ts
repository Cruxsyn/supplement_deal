import { describe, test, expect } from 'bun:test';
import {
  normalizeToGrams,
  parseQuantity,
  calculateConfidence,
  calculateConfidenceWithUpc,
  cleanTitle,
  extractDomain,
  detectCountryFromUrl,
  getRandomUserAgent,
  getExcludedDomains,
  COUNTRY_CONFIG,
  EXCHANGE_RATES_TO_USD,
  normalizeToUSD,
} from '../../../../shared/utils';

// ---------------------------------------------------------------------------
// 1. normalizeToGrams
// ---------------------------------------------------------------------------
describe('normalizeToGrams', () => {
  test('converts grams (g, gram, grams)', () => {
    expect(normalizeToGrams(500, 'g')).toBe(500);
    expect(normalizeToGrams(250, 'gram')).toBe(250);
    expect(normalizeToGrams(100, 'grams')).toBe(100);
  });

  test('converts kilograms (kg, kilogram, kilograms)', () => {
    expect(normalizeToGrams(1, 'kg')).toBe(1000);
    expect(normalizeToGrams(2.5, 'kilogram')).toBe(2500);
    expect(normalizeToGrams(0.5, 'kilograms')).toBe(500);
  });

  test('converts milligrams (mg, milligram, milligrams)', () => {
    expect(normalizeToGrams(1000, 'mg')).toBeCloseTo(1, 5);
    expect(normalizeToGrams(500, 'milligram')).toBeCloseTo(0.5, 5);
    expect(normalizeToGrams(250, 'milligrams')).toBeCloseTo(0.25, 5);
  });

  test('converts pounds (lb, lbs, pound, pounds)', () => {
    expect(normalizeToGrams(1, 'lb')).toBeCloseTo(453.592, 2);
    expect(normalizeToGrams(1, 'lbs')).toBeCloseTo(453.592, 2);
    expect(normalizeToGrams(2, 'pound')).toBeCloseTo(907.184, 2);
    expect(normalizeToGrams(0.5, 'pounds')).toBeCloseTo(226.796, 2);
  });

  test('converts ounces (oz, ounce, ounces)', () => {
    expect(normalizeToGrams(1, 'oz')).toBeCloseTo(28.3495, 3);
    expect(normalizeToGrams(16, 'ounce')).toBeCloseTo(453.592, 1);
    expect(normalizeToGrams(8, 'ounces')).toBeCloseTo(226.796, 1);
  });

  test('returns null for non-weight units', () => {
    expect(normalizeToGrams(60, 'capsules')).toBeNull();
    expect(normalizeToGrams(90, 'tablets')).toBeNull();
    expect(normalizeToGrams(30, 'servings')).toBeNull();
    expect(normalizeToGrams(500, 'ml')).toBeNull();
    expect(normalizeToGrams(10, 'pieces')).toBeNull();
  });

  test('is case-insensitive', () => {
    expect(normalizeToGrams(1, 'KG')).toBe(1000);
    expect(normalizeToGrams(500, 'MG')).toBeCloseTo(0.5, 5);
    expect(normalizeToGrams(100, 'Grams')).toBe(100);
  });

  test('trims whitespace from unit', () => {
    expect(normalizeToGrams(1, '  kg  ')).toBe(1000);
    expect(normalizeToGrams(500, ' g ')).toBe(500);
  });

  test('handles zero value', () => {
    expect(normalizeToGrams(0, 'g')).toBe(0);
    expect(normalizeToGrams(0, 'kg')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 2. parseQuantity
// ---------------------------------------------------------------------------
describe('parseQuantity', () => {
  test('parses simple number+unit without space', () => {
    expect(parseQuantity('500g')).toEqual({ value: 500, unit: 'g' });
    expect(parseQuantity('1000mg')).toEqual({ value: 1000, unit: 'mg' });
  });

  test('parses number+unit with space', () => {
    expect(parseQuantity('500 g')).toEqual({ value: 500, unit: 'g' });
    expect(parseQuantity('1.5 kg')).toEqual({ value: 1.5, unit: 'kg' });
    expect(parseQuantity('2 lbs')).toEqual({ value: 2, unit: 'lbs' });
  });

  test('parses capsules and tablets', () => {
    expect(parseQuantity('100 capsules')).toEqual({ value: 100, unit: 'capsules' });
    expect(parseQuantity('60 tablets')).toEqual({ value: 60, unit: 'tablets' });
    expect(parseQuantity('30 servings')).toEqual({ value: 30, unit: 'servings' });
  });

  test('parses multiplied format (120 x 500mg) - first pattern matches the per-unit value', () => {
    // Note: the first regex pattern matches "500mg" before the "x" pattern,
    // so it returns the per-unit value rather than the multiplied total
    const result = parseQuantity('120 x 500mg');
    expect(result).toEqual({ value: 500, unit: 'mg' });
  });

  test('parses multiplied format (60 x 1g) - first pattern matches per-unit value', () => {
    const result = parseQuantity('60 x 1g');
    expect(result).toEqual({ value: 1, unit: 'g' });
  });

  test('normalizes unit names', () => {
    expect(parseQuantity('500 gram')).toEqual({ value: 500, unit: 'g' });
    expect(parseQuantity('500 grams')).toEqual({ value: 500, unit: 'g' });
    expect(parseQuantity('1 kilogram')).toEqual({ value: 1, unit: 'kg' });
    expect(parseQuantity('2 kilograms')).toEqual({ value: 2, unit: 'kg' });
    expect(parseQuantity('500 milligram')).toEqual({ value: 500, unit: 'mg' });
    expect(parseQuantity('500 milligrams')).toEqual({ value: 500, unit: 'mg' });
    expect(parseQuantity('1 pound')).toEqual({ value: 1, unit: 'lb' });
    expect(parseQuantity('2 pounds')).toEqual({ value: 2, unit: 'lb' });
    expect(parseQuantity('8 ounce')).toEqual({ value: 8, unit: 'oz' });
    expect(parseQuantity('8 ounces')).toEqual({ value: 8, unit: 'oz' });
  });

  test('normalizes capsule/tablet variants', () => {
    expect(parseQuantity('60 cap')).toEqual({ value: 60, unit: 'capsules' });
    expect(parseQuantity('60 caps')).toEqual({ value: 60, unit: 'capsules' });
    expect(parseQuantity('60 tab')).toEqual({ value: 60, unit: 'tablets' });
    expect(parseQuantity('60 tabs')).toEqual({ value: 60, unit: 'tablets' });
    expect(parseQuantity('30 softgel')).toEqual({ value: 30, unit: 'softgels' });
  });

  test('normalizes scoop/dose to servings', () => {
    expect(parseQuantity('30 scoop')).toEqual({ value: 30, unit: 'servings' });
    expect(parseQuantity('30 scoops')).toEqual({ value: 30, unit: 'servings' });
    expect(parseQuantity('30 dose')).toEqual({ value: 30, unit: 'servings' });
    expect(parseQuantity('30 doses')).toEqual({ value: 30, unit: 'servings' });
  });

  test('normalizes litre/liter to l', () => {
    expect(parseQuantity('1 litre')).toEqual({ value: 1, unit: 'l' });
    expect(parseQuantity('2 liter')).toEqual({ value: 2, unit: 'l' });
  });

  test('returns null for empty/null/undefined text', () => {
    expect(parseQuantity('')).toBeNull();
    expect(parseQuantity(null as any)).toBeNull();
    expect(parseQuantity(undefined as any)).toBeNull();
  });

  test('returns null for text without quantities', () => {
    expect(parseQuantity('no quantity here')).toBeNull();
    expect(parseQuantity('just a product name')).toBeNull();
  });

  test('parses decimal values', () => {
    expect(parseQuantity('1.5 kg')).toEqual({ value: 1.5, unit: 'kg' });
    expect(parseQuantity('0.5 g')).toEqual({ value: 0.5, unit: 'g' });
  });
});

// ---------------------------------------------------------------------------
// 3. calculateConfidence
// ---------------------------------------------------------------------------
describe('calculateConfidence', () => {
  test('returns maximum score for complete product data', () => {
    const score = calculateConfidence({
      price: 29.99,
      quantity: 500,
      unit: 'g',
      title: 'Creatine Monohydrate 500g Powder',
    });
    expect(score).toBe(1);
  });

  test('adds 0.3 for price present', () => {
    const withPrice = calculateConfidence({ price: 10, quantity: null, unit: null, title: '' });
    const withoutPrice = calculateConfidence({ price: null, quantity: null, unit: null, title: '' });
    expect(withPrice - withoutPrice).toBeCloseTo(0.3, 5);
  });

  test('adds 0.3 for quantity present', () => {
    const withQuantity = calculateConfidence({ price: null, quantity: 500, unit: null, title: '' });
    const withoutQuantity = calculateConfidence({ price: null, quantity: null, unit: null, title: '' });
    expect(withQuantity - withoutQuantity).toBeCloseTo(0.3, 5);
  });

  test('adds 0.2 for known unit', () => {
    const withUnit = calculateConfidence({ price: null, quantity: null, unit: 'g', title: '' });
    const withoutUnit = calculateConfidence({ price: null, quantity: null, unit: null, title: '' });
    expect(withUnit - withoutUnit).toBeCloseTo(0.2, 5);
  });

  test('adds 0.1 for title longer than 10 chars', () => {
    const longTitle = calculateConfidence({ price: null, quantity: null, unit: null, title: 'A decent product title' });
    const shortTitle = calculateConfidence({ price: null, quantity: null, unit: null, title: 'Short' });
    expect(longTitle - shortTitle).toBeCloseTo(0.1, 5);
  });

  test('adds 0.1 bonus for title with quantity pattern', () => {
    const withPattern = calculateConfidence({ price: null, quantity: null, unit: null, title: 'Creatine 500g powder supplement' });
    const withoutPattern = calculateConfidence({ price: null, quantity: null, unit: null, title: 'A decent product title' });
    expect(withPattern - withoutPattern).toBeCloseTo(0.1, 5);
  });

  test('recognizes all known units', () => {
    const knownUnits = ['g', 'kg', 'mg', 'lb', 'oz', 'capsules', 'tablets', 'servings', 'softgels'];
    for (const unit of knownUnits) {
      const score = calculateConfidence({ price: null, quantity: null, unit, title: '' });
      expect(score).toBeGreaterThan(0);
    }
  });

  test('returns 0 for minimal product data', () => {
    const score = calculateConfidence({ price: null, quantity: null, unit: null, title: '' });
    expect(score).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 4. calculateConfidenceWithUpc
// ---------------------------------------------------------------------------
describe('calculateConfidenceWithUpc', () => {
  test('returns base score without UPC fields', () => {
    const score = calculateConfidenceWithUpc({
      price: 29.99,
      quantity: 500,
      unit: 'g',
      title: 'Creatine Monohydrate 500g Powder',
    });
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(1.0);
  });

  test('adds UPC bonus of 0.15', () => {
    const withoutUpc = calculateConfidenceWithUpc({
      price: 29.99, quantity: 500, unit: 'g',
      title: 'Creatine Monohydrate 500g Powder',
      hasValidUpc: false,
    });
    const withUpc = calculateConfidenceWithUpc({
      price: 29.99, quantity: 500, unit: 'g',
      title: 'Creatine Monohydrate 500g Powder',
      hasValidUpc: true,
    });
    expect(withUpc).toBeGreaterThan(withoutUpc);
  });

  test('adds cross-vendor bonus (0.05 per match, max 0.15)', () => {
    const base = calculateConfidenceWithUpc({
      price: 10, quantity: 100, unit: 'g', title: 'Test Product Name',
      crossVendorMatches: 0,
    });
    const oneMatch = calculateConfidenceWithUpc({
      price: 10, quantity: 100, unit: 'g', title: 'Test Product Name',
      crossVendorMatches: 1,
    });
    const threeMatches = calculateConfidenceWithUpc({
      price: 10, quantity: 100, unit: 'g', title: 'Test Product Name',
      crossVendorMatches: 3,
    });
    const fiveMatches = calculateConfidenceWithUpc({
      price: 10, quantity: 100, unit: 'g', title: 'Test Product Name',
      crossVendorMatches: 5,
    });

    expect(oneMatch).toBeGreaterThan(base);
    expect(threeMatches).toBeGreaterThan(oneMatch);
    // 5 matches should be capped at same as 3 (max 0.15)
    expect(fiveMatches).toBeCloseTo(threeMatches, 5);
  });

  test('score is clamped to 1.0 max', () => {
    const score = calculateConfidenceWithUpc({
      price: 29.99,
      quantity: 500,
      unit: 'g',
      title: 'Creatine Monohydrate 500g Powder',
      hasValidUpc: true,
      crossVendorMatches: 10,
    });
    expect(score).toBeLessThanOrEqual(1.0);
  });

  test('returns 0 for minimal product data', () => {
    const score = calculateConfidenceWithUpc({
      price: null, quantity: null, unit: null, title: '',
    });
    expect(score).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 5. cleanTitle
// ---------------------------------------------------------------------------
describe('cleanTitle', () => {
  test('collapses multiple whitespace to single space', () => {
    expect(cleanTitle('Hello    World')).toBe('Hello World');
    expect(cleanTitle('  Multiple   Spaces  ')).toBe('Multiple Spaces');
  });

  test('removes special non-word characters but keeps hyphens, commas, periods, parens', () => {
    expect(cleanTitle('Product - Name (500g), v2.0')).toBe('Product - Name (500g), v2.0');
    expect(cleanTitle('Product™ Name® Special!')).toBe('Product Name Special');
  });

  test('trims leading and trailing whitespace', () => {
    expect(cleanTitle('  Hello World  ')).toBe('Hello World');
  });

  test('truncates to 200 characters max', () => {
    const longTitle = 'A'.repeat(300);
    expect(cleanTitle(longTitle).length).toBe(200);
  });

  test('handles empty string', () => {
    expect(cleanTitle('')).toBe('');
  });

  test('keeps alphanumeric content intact', () => {
    expect(cleanTitle('Creatine Monohydrate 500g')).toBe('Creatine Monohydrate 500g');
  });
});

// ---------------------------------------------------------------------------
// 6. extractDomain
// ---------------------------------------------------------------------------
describe('extractDomain', () => {
  test('extracts domain from standard URL', () => {
    expect(extractDomain('https://example.com/path')).toBe('example.com');
  });

  test('strips www prefix', () => {
    expect(extractDomain('https://www.example.com/path')).toBe('example.com');
  });

  test('handles subdomains', () => {
    expect(extractDomain('https://shop.example.com/product')).toBe('shop.example.com');
  });

  test('returns unknown for invalid URL', () => {
    expect(extractDomain('not-a-url')).toBe('unknown');
    expect(extractDomain('')).toBe('unknown');
  });

  test('handles URLs with ports', () => {
    expect(extractDomain('https://example.com:8080/path')).toBe('example.com');
  });
});

// ---------------------------------------------------------------------------
// 7. detectCountryFromUrl
// ---------------------------------------------------------------------------
describe('detectCountryFromUrl', () => {
  test('detects US from .com domain', () => {
    expect(detectCountryFromUrl('https://amazon.com/product')).toBe('US');
  });

  test('detects CA from .ca domain', () => {
    expect(detectCountryFromUrl('https://amazon.ca/product')).toBe('CA');
  });

  test('detects UK from .co.uk domain', () => {
    expect(detectCountryFromUrl('https://amazon.co.uk/product')).toBe('UK');
  });

  test('detects UK from .uk domain', () => {
    expect(detectCountryFromUrl('https://example.uk/product')).toBe('UK');
  });

  test('detects DE from .de domain', () => {
    expect(detectCountryFromUrl('https://shop-apotheke.de/product')).toBe('DE');
  });

  test('detects FR from .fr domain', () => {
    expect(detectCountryFromUrl('https://example.fr/product')).toBe('FR');
  });

  test('detects ES from .es domain', () => {
    expect(detectCountryFromUrl('https://example.es/product')).toBe('ES');
  });

  test('detects IT from .it domain', () => {
    expect(detectCountryFromUrl('https://example.it/product')).toBe('IT');
  });

  test('detects NL from .nl domain', () => {
    expect(detectCountryFromUrl('https://example.nl/product')).toBe('NL');
  });

  test('detects SE from .se domain', () => {
    expect(detectCountryFromUrl('https://example.se/product')).toBe('SE');
  });

  test('detects AU from .com.au domain', () => {
    expect(detectCountryFromUrl('https://chemistwarehouse.com.au/product')).toBe('AU');
  });

  test('detects NZ from .co.nz domain', () => {
    expect(detectCountryFromUrl('https://example.co.nz/product')).toBe('NZ');
  });

  test('detects IE from .ie domain', () => {
    expect(detectCountryFromUrl('https://example.ie/product')).toBe('IE');
  });

  test('detects JP from .jp domain', () => {
    expect(detectCountryFromUrl('https://example.jp/product')).toBe('JP');
  });

  test('detects JP from .co.jp domain', () => {
    expect(detectCountryFromUrl('https://amazon.co.jp/product')).toBe('JP');
  });

  test('detects SG from .sg domain', () => {
    expect(detectCountryFromUrl('https://example.sg/product')).toBe('SG');
  });

  test('detects SG from .com.sg domain', () => {
    expect(detectCountryFromUrl('https://example.com.sg/product')).toBe('SG');
  });

  test('returns null for unknown TLD', () => {
    expect(detectCountryFromUrl('https://example.xyz/product')).toBeNull();
  });

  test('returns null for invalid URL', () => {
    expect(detectCountryFromUrl('not-a-url')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 8. getRandomUserAgent
// ---------------------------------------------------------------------------
describe('getRandomUserAgent', () => {
  test('returns a non-empty string', () => {
    const ua = getRandomUserAgent();
    expect(typeof ua).toBe('string');
    expect(ua.length).toBeGreaterThan(0);
  });

  test('contains Mozilla', () => {
    const ua = getRandomUserAgent();
    expect(ua).toContain('Mozilla');
  });

  test('returns a valid user agent string on multiple calls', () => {
    for (let i = 0; i < 20; i++) {
      const ua = getRandomUserAgent();
      expect(ua).toContain('Mozilla');
      expect(ua.length).toBeGreaterThan(10);
    }
  });
});

// ---------------------------------------------------------------------------
// 9. getExcludedDomains
// ---------------------------------------------------------------------------
describe('getExcludedDomains', () => {
  test('returns common excluded domains for supplements', () => {
    const domains = getExcludedDomains('supplements');
    expect(domains).toContain('wikipedia.org');
    expect(domains).toContain('reddit.com');
    expect(domains).toContain('youtube.com');
    expect(domains).toContain('google.com');
  });

  test('returns category-specific excluded domains for supplements', () => {
    const domains = getExcludedDomains('supplements');
    expect(domains).toContain('healthline.com');
    expect(domains).toContain('webmd.com');
    expect(domains).toContain('examine.com');
  });

  test('returns category-specific excluded domains for building', () => {
    const domains = getExcludedDomains('building');
    expect(domains).toContain('bobvila.com');
    expect(domains).toContain('familyhandyman.com');
  });

  test('returns category-specific excluded domains for robotics', () => {
    const domains = getExcludedDomains('robotics');
    expect(domains).toContain('hackaday.com');
    expect(domains).toContain('arxiv.org');
  });

  test('does NOT include deal aggregator sites', () => {
    const categories: Array<'supplements' | 'building' | 'robotics'> = ['supplements', 'building', 'robotics'];
    for (const cat of categories) {
      const domains = getExcludedDomains(cat);
      expect(domains).not.toContain('camelcamelcamel.com');
      expect(domains).not.toContain('slickdeals.net');
      expect(domains).not.toContain('dealsplus.com');
    }
  });

  test('includes common social media for all categories', () => {
    const categories: Array<'supplements' | 'building' | 'robotics'> = ['supplements', 'building', 'robotics'];
    for (const cat of categories) {
      const domains = getExcludedDomains(cat);
      expect(domains).toContain('facebook.com');
      expect(domains).toContain('twitter.com');
      expect(domains).toContain('instagram.com');
    }
  });
});

// ---------------------------------------------------------------------------
// 10. COUNTRY_CONFIG
// ---------------------------------------------------------------------------
describe('COUNTRY_CONFIG', () => {
  test('has all 14 country entries', () => {
    const countries = Object.keys(COUNTRY_CONFIG);
    expect(countries).toHaveLength(14);
    expect(countries).toContain('US');
    expect(countries).toContain('CA');
    expect(countries).toContain('UK');
    expect(countries).toContain('DE');
    expect(countries).toContain('FR');
    expect(countries).toContain('ES');
    expect(countries).toContain('IT');
    expect(countries).toContain('NL');
    expect(countries).toContain('SE');
    expect(countries).toContain('AU');
    expect(countries).toContain('NZ');
    expect(countries).toContain('IE');
    expect(countries).toContain('JP');
    expect(countries).toContain('SG');
  });

  test('every entry has required fields', () => {
    for (const [code, config] of Object.entries(COUNTRY_CONFIG)) {
      expect(config.name).toBeTruthy();
      expect(config.currency).toBeTruthy();
      expect(config.currencySymbol).toBeTruthy();
      expect(Array.isArray(config.domains)).toBe(true);
      expect(config.domains.length).toBeGreaterThan(0);
      expect(config.searchSuffix).toBeTruthy();
    }
  });

  test('US uses USD', () => {
    expect(COUNTRY_CONFIG.US.currency).toBe('USD');
  });

  test('UK uses GBP', () => {
    expect(COUNTRY_CONFIG.UK.currency).toBe('GBP');
  });

  test('EUR countries all use EUR', () => {
    const eurCountries: Array<keyof typeof COUNTRY_CONFIG> = ['DE', 'FR', 'ES', 'IT', 'NL', 'IE'];
    for (const c of eurCountries) {
      expect(COUNTRY_CONFIG[c].currency).toBe('EUR');
    }
  });

  test('JP uses JPY', () => {
    expect(COUNTRY_CONFIG.JP.currency).toBe('JPY');
  });

  test('SE uses SEK', () => {
    expect(COUNTRY_CONFIG.SE.currency).toBe('SEK');
  });

  test('SG uses SGD', () => {
    expect(COUNTRY_CONFIG.SG.currency).toBe('SGD');
  });

  test('AU uses AUD', () => {
    expect(COUNTRY_CONFIG.AU.currency).toBe('AUD');
  });

  test('NZ uses NZD', () => {
    expect(COUNTRY_CONFIG.NZ.currency).toBe('NZD');
  });

  test('CA uses CAD', () => {
    expect(COUNTRY_CONFIG.CA.currency).toBe('CAD');
  });
});

// ---------------------------------------------------------------------------
// 11. EXCHANGE_RATES_TO_USD
// ---------------------------------------------------------------------------
describe('EXCHANGE_RATES_TO_USD', () => {
  test('contains key currencies', () => {
    expect(EXCHANGE_RATES_TO_USD).toHaveProperty('USD');
    expect(EXCHANGE_RATES_TO_USD).toHaveProperty('EUR');
    expect(EXCHANGE_RATES_TO_USD).toHaveProperty('GBP');
    expect(EXCHANGE_RATES_TO_USD).toHaveProperty('CAD');
    expect(EXCHANGE_RATES_TO_USD).toHaveProperty('AUD');
    expect(EXCHANGE_RATES_TO_USD).toHaveProperty('NZD');
    expect(EXCHANGE_RATES_TO_USD).toHaveProperty('JPY');
    expect(EXCHANGE_RATES_TO_USD).toHaveProperty('SEK');
    expect(EXCHANGE_RATES_TO_USD).toHaveProperty('SGD');
  });

  test('USD rate is exactly 1.0', () => {
    expect(EXCHANGE_RATES_TO_USD.USD).toBe(1.0);
  });

  test('rates are reasonable', () => {
    expect(EXCHANGE_RATES_TO_USD.EUR).toBeGreaterThan(0.8);
    expect(EXCHANGE_RATES_TO_USD.EUR).toBeLessThan(1.5);

    expect(EXCHANGE_RATES_TO_USD.GBP).toBeGreaterThan(1.0);
    expect(EXCHANGE_RATES_TO_USD.GBP).toBeLessThan(2.0);

    expect(EXCHANGE_RATES_TO_USD.JPY).toBeGreaterThan(0.001);
    expect(EXCHANGE_RATES_TO_USD.JPY).toBeLessThan(0.02);

    expect(EXCHANGE_RATES_TO_USD.CAD).toBeGreaterThan(0.5);
    expect(EXCHANGE_RATES_TO_USD.CAD).toBeLessThan(1.0);
  });
});

// ---------------------------------------------------------------------------
// 12. normalizeToUSD
// ---------------------------------------------------------------------------
describe('normalizeToUSD', () => {
  test('USD converts 1:1', () => {
    expect(normalizeToUSD(100, 'USD')).toBe(100);
  });

  test('converts EUR to USD', () => {
    const result = normalizeToUSD(100, 'EUR');
    expect(result).toBeCloseTo(100 * EXCHANGE_RATES_TO_USD.EUR, 2);
  });

  test('converts GBP to USD', () => {
    const result = normalizeToUSD(50, 'GBP');
    expect(result).toBeCloseTo(50 * EXCHANGE_RATES_TO_USD.GBP, 2);
  });

  test('converts JPY to USD', () => {
    const result = normalizeToUSD(10000, 'JPY');
    expect(result).toBeCloseTo(10000 * EXCHANGE_RATES_TO_USD.JPY, 2);
  });

  test('is case-insensitive for currency codes', () => {
    expect(normalizeToUSD(100, 'usd')).toBe(100);
    expect(normalizeToUSD(100, 'eur')).toBeCloseTo(100 * EXCHANGE_RATES_TO_USD.EUR, 2);
  });

  test('defaults to rate 1.0 for unknown currency', () => {
    expect(normalizeToUSD(100, 'XYZ')).toBe(100);
    expect(normalizeToUSD(50, 'UNKNOWN')).toBe(50);
  });
});
