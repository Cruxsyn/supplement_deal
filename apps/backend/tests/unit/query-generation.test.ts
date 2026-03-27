import { describe, expect, test } from 'bun:test';
import {
  generateSearchQueries,
  generateCategorySearchQueries,
  CATEGORY_VENDORS,
  DEAL_AGGREGATOR_SITES,
  COUNTRY_CONFIG,
} from '../../../../shared/utils';

describe('generateSearchQueries', () => {
  test('returns an array of 5 queries', () => {
    const queries = generateSearchQueries('creatine monohydrate');
    expect(queries).toHaveLength(5);
  });

  test('first query includes "buy price"', () => {
    const queries = generateSearchQueries('creatine monohydrate');
    expect(queries[0]).toBe('creatine monohydrate buy price');
  });

  test('includes an "add to cart" query', () => {
    const queries = generateSearchQueries('creatine monohydrate');
    const addToCartQuery = queries.find(q => q.includes('"add to cart"'));
    expect(addToCartQuery).toBeDefined();
  });

  test('includes negative filters (-review -blog)', () => {
    const queries = generateSearchQueries('creatine monohydrate');
    const negativeQuery = queries.find(q => q.includes('-review') && q.includes('-blog'));
    expect(negativeQuery).toBeDefined();
  });

  test('trims input whitespace', () => {
    const queries = generateSearchQueries('  creatine monohydrate  ');
    for (const q of queries) {
      expect(q).not.toMatch(/^\s/);
      expect(q).toContain('creatine monohydrate');
    }
  });

  test('contains the supplement name in all queries', () => {
    const queries = generateSearchQueries('vitamin D3');
    for (const q of queries) {
      expect(q).toContain('vitamin D3');
    }
  });
});

describe('generateCategorySearchQueries', () => {
  test('returns a non-empty array for all categories', () => {
    for (const category of ['supplements', 'building', 'robotics'] as const) {
      const queries = generateCategorySearchQueries('test product', category);
      expect(queries.length).toBeGreaterThan(0);
    }
  });

  test('first few queries include site: operator', () => {
    const queries = generateCategorySearchQueries('creatine', 'supplements');
    // Top 8 vendors grouped by 2 = 4 site-specific queries at the start
    for (let i = 0; i < 4; i++) {
      expect(queries[i]).toContain('site:');
    }
  });

  test('site queries pair vendors in groups of 2', () => {
    const queries = generateCategorySearchQueries('creatine', 'supplements');
    const topVendors = CATEGORY_VENDORS.supplements.slice(0, 8);
    // First site query should pair vendors 0 and 1
    expect(queries[0]).toContain(`site:${topVendors[0]}`);
    expect(queries[0]).toContain(`site:${topVendors[1]}`);
    expect(queries[0]).toContain(' OR ');
  });

  test('includes shopping intent modifiers for supplements', () => {
    const queries = generateCategorySearchQueries('creatine', 'supplements');
    const allText = queries.join('\n');
    expect(allText).toContain('"add to cart"');
    expect(allText).toContain('"in stock" buy');
  });

  test('includes shopping intent modifiers for building', () => {
    const queries = generateCategorySearchQueries('drill bit set', 'building');
    const allText = queries.join('\n');
    expect(allText).toContain('"add to cart"');
  });

  test('includes deal aggregator queries', () => {
    const queries = generateCategorySearchQueries('creatine', 'supplements');
    const dealQuery = queries.find(
      q => q.includes('site:camelcamelcamel.com') || q.includes('site:slickdeals.net')
    );
    expect(dealQuery).toBeDefined();
  });

  test('includes country-specific queries for non-US countries', () => {
    const queries = generateCategorySearchQueries('creatine', 'supplements', ['US', 'UK', 'DE']);
    const allText = queries.join('\n');
    expect(allText).toContain('site:*.co.uk');
    expect(allText).toContain('site:*.de');
  });

  test('US-only search does not generate country-specific queries', () => {
    const queries = generateCategorySearchQueries('creatine', 'supplements', ['US']);
    const countryQueries = queries.filter(q => /site:\*\.\w/.test(q));
    expect(countryQueries).toHaveLength(0);
  });

  test('includes exact match queries at the end', () => {
    const queries = generateCategorySearchQueries('creatine', 'supplements');
    const lastTwo = queries.slice(-2);
    expect(lastTwo[0]).toBe('"creatine" buy');
    expect(lastTwo[1]).toBe('"creatine" price');
  });

  test('different categories use different vendors', () => {
    const suppQueries = generateCategorySearchQueries('test', 'supplements');
    const buildQueries = generateCategorySearchQueries('test', 'building');
    const roboQueries = generateCategorySearchQueries('test', 'robotics');

    expect(suppQueries.some(q => q.includes('site:iherb.com'))).toBe(true);
    expect(buildQueries.some(q => q.includes('site:homedepot.com'))).toBe(true);
    expect(roboQueries.some(q => q.includes('site:sparkfun.com'))).toBe(true);
  });

  test('trims query input', () => {
    const queries = generateCategorySearchQueries('  creatine  ', 'supplements');
    for (const q of queries) {
      expect(q).not.toMatch(/^\s/);
      expect(q).toContain('creatine');
      expect(q).not.toContain('  creatine  ');
    }
  });
});

describe('vendor list validation', () => {
  test('CATEGORY_VENDORS has entries for all 3 categories', () => {
    expect(CATEGORY_VENDORS).toHaveProperty('supplements');
    expect(CATEGORY_VENDORS).toHaveProperty('building');
    expect(CATEGORY_VENDORS).toHaveProperty('robotics');
  });

  test('each category has at least 15 vendors', () => {
    for (const category of ['supplements', 'building', 'robotics'] as const) {
      expect(CATEGORY_VENDORS[category].length).toBeGreaterThanOrEqual(15);
    }
  });

  test('supplements includes expected vendors', () => {
    const vendors = CATEGORY_VENDORS.supplements;
    expect(vendors).toContain('iherb.com');
    expect(vendors).toContain('amazon.com');
    expect(vendors).toContain('vitacost.com');
  });

  test('building includes expected vendors', () => {
    const vendors = CATEGORY_VENDORS.building;
    expect(vendors).toContain('homedepot.com');
    expect(vendors).toContain('lowes.com');
  });

  test('robotics includes expected vendors', () => {
    const vendors = CATEGORY_VENDORS.robotics;
    expect(vendors).toContain('sparkfun.com');
    expect(vendors).toContain('adafruit.com');
  });
});

describe('new query strategy validation', () => {
  test('price comparison patterns include per-serving or coupon queries for supplements', () => {
    const queries = generateCategorySearchQueries('creatine', 'supplements');
    const allText = queries.join('\n');
    // Section 6 adds price comparison modifiers
    expect(allText).toMatch(/per serving|coupon/i);
  });

  test('price comparison patterns include bulk or clearance queries for building', () => {
    const queries = generateCategorySearchQueries('drill bit set', 'building');
    const allText = queries.join('\n');
    expect(allText).toMatch(/price each|clearance/i);
  });

  test('alternative product queries include "alternative to" phrasing', () => {
    const queries = generateCategorySearchQueries('creatine', 'supplements');
    const altQuery = queries.find(q => q.includes('alternative to'));
    expect(altQuery).toBeDefined();
    expect(altQuery).toContain('"alternative to"');
    expect(altQuery).toContain('"creatine"');
    expect(altQuery).toContain('buy');
  });

  test('country-specific vendor domain queries include site: for regional vendors', () => {
    const queries = generateCategorySearchQueries('creatine', 'supplements');
    // Section 8 adds regional vendor domains (non-.com TLDs like .com.au, .co.jp, .de, .se)
    const regionalQuery = queries.find(q =>
      q.includes('site:') && (
        q.includes('.com.au') ||
        q.includes('.co.jp') ||
        q.includes('.de') ||
        q.includes('.se') ||
        q.includes('.co.nz') ||
        q.includes('.com.sg')
      )
    );
    expect(regionalQuery).toBeDefined();
  });

  test('country-specific vendor domain queries are present for building category', () => {
    const queries = generateCategorySearchQueries('drill bit set', 'building');
    const regionalQuery = queries.find(q =>
      q.includes('site:') && (
        q.includes('.com.au') ||
        q.includes('.co.nz') ||
        q.includes('.de') ||
        q.includes('.co.uk') ||
        q.includes('.com.sg')
      )
    );
    expect(regionalQuery).toBeDefined();
  });

  test('country-specific vendor domain queries are present for robotics category', () => {
    const queries = generateCategorySearchQueries('servo motor', 'robotics');
    const regionalQuery = queries.find(q =>
      q.includes('site:') && (
        q.includes('.com.au') ||
        q.includes('.co.nz') ||
        q.includes('.de') ||
        q.includes('.eu')
      )
    );
    expect(regionalQuery).toBeDefined();
  });
});

describe('deal aggregator validation', () => {
  test('DEAL_AGGREGATOR_SITES has entries for all 3 categories', () => {
    expect(DEAL_AGGREGATOR_SITES).toHaveProperty('supplements');
    expect(DEAL_AGGREGATOR_SITES).toHaveProperty('building');
    expect(DEAL_AGGREGATOR_SITES).toHaveProperty('robotics');
  });

  test('each category includes camelcamelcamel.com and slickdeals.net', () => {
    for (const category of ['supplements', 'building', 'robotics'] as const) {
      expect(DEAL_AGGREGATOR_SITES[category]).toContain('camelcamelcamel.com');
      expect(DEAL_AGGREGATOR_SITES[category]).toContain('slickdeals.net');
    }
  });
});
