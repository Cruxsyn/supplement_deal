/**
 * Integration tests for the search flow
 * Tests: API endpoints, caching behavior, depth configuration
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { SEARCH_DEPTHS, _testing } from '../../src/scraper';

const { ResultCache, UrlCache, RequestBudget } = _testing;

describe('SEARCH_DEPTHS configuration', () => {
  test('quick depth has lowest limits', () => {
    expect(SEARCH_DEPTHS.quick.maxUrls).toBe(30);
    expect(SEARCH_DEPTHS.quick.maxQueries).toBe(6);
  });

  test('normal depth has balanced limits', () => {
    expect(SEARCH_DEPTHS.normal.maxUrls).toBe(75);
    expect(SEARCH_DEPTHS.normal.maxQueries).toBe(12);
  });

  test('deep depth has higher limits', () => {
    expect(SEARCH_DEPTHS.deep.maxUrls).toBe(150);
    expect(SEARCH_DEPTHS.deep.maxQueries).toBe(18);
  });

  test('exhaustive depth has maximum limits', () => {
    expect(SEARCH_DEPTHS.exhaustive.maxUrls).toBe(300);
    expect(SEARCH_DEPTHS.exhaustive.maxQueries).toBe(25);
  });

  test('depth limits are properly ordered', () => {
    expect(SEARCH_DEPTHS.quick.maxUrls).toBeLessThan(SEARCH_DEPTHS.normal.maxUrls);
    expect(SEARCH_DEPTHS.normal.maxUrls).toBeLessThan(SEARCH_DEPTHS.deep.maxUrls);
    expect(SEARCH_DEPTHS.deep.maxUrls).toBeLessThan(SEARCH_DEPTHS.exhaustive.maxUrls);
  });
});

describe('ResultCache', () => {
  let cache: InstanceType<typeof ResultCache>;

  beforeEach(() => {
    cache = new ResultCache();
  });

  test('stores and retrieves results', () => {
    const mockResults = [
      {
        title: 'Test Product',
        price: 20,
        currency: 'USD',
        quantity: 100,
        unit: 'g',
        price_per_unit: 0.20,
        vendor: 'test.com',
        url: 'https://test.com/product',
        confidence: 0.8,
      },
    ];

    cache.set('creatine', 'supplements', ['US'], 'normal', mockResults as any);
    const retrieved = cache.get('creatine', 'supplements', ['US'], 'normal');

    expect(retrieved).not.toBeNull();
    expect(retrieved!.length).toBe(1);
    expect(retrieved![0].title).toBe('Test Product');
  });

  test('returns null for cache miss', () => {
    const result = cache.get('nonexistent', 'supplements', ['US'], 'normal');
    expect(result).toBeNull();
  });

  test('differentiates by category', () => {
    const mockResults = [{ title: 'Supplement' }];

    cache.set('query', 'supplements', ['US'], 'normal', mockResults as any);

    const supplementHit = cache.get('query', 'supplements', ['US'], 'normal');
    const buildingMiss = cache.get('query', 'building', ['US'], 'normal');

    expect(supplementHit).not.toBeNull();
    expect(buildingMiss).toBeNull();
  });

  test('differentiates by depth', () => {
    const mockResults = [{ title: 'Product' }];

    cache.set('query', 'supplements', ['US'], 'quick', mockResults as any);

    const quickHit = cache.get('query', 'supplements', ['US'], 'quick');
    const deepMiss = cache.get('query', 'supplements', ['US'], 'deep');

    expect(quickHit).not.toBeNull();
    expect(deepMiss).toBeNull();
  });

  test('differentiates by countries', () => {
    const mockResults = [{ title: 'Product' }];

    cache.set('query', 'supplements', ['US', 'UK'], 'normal', mockResults as any);

    const exactHit = cache.get('query', 'supplements', ['US', 'UK'], 'normal');
    const differentMiss = cache.get('query', 'supplements', ['US'], 'normal');

    expect(exactHit).not.toBeNull();
    expect(differentMiss).toBeNull();
  });

  test('case-insensitive query matching', () => {
    const mockResults = [{ title: 'Product' }];

    cache.set('Creatine Monohydrate', 'supplements', ['US'], 'normal', mockResults as any);
    const hit = cache.get('creatine monohydrate', 'supplements', ['US'], 'normal');

    expect(hit).not.toBeNull();
  });

  test('clears cache', () => {
    const mockResults = [{ title: 'Product' }];

    cache.set('query', 'supplements', ['US'], 'normal', mockResults as any);
    cache.clear();

    const result = cache.get('query', 'supplements', ['US'], 'normal');
    expect(result).toBeNull();
  });
});

describe('UrlCache', () => {
  let cache: InstanceType<typeof UrlCache>;

  beforeEach(() => {
    cache = new UrlCache();
  });

  test('stores and retrieves HTML', () => {
    const html = '<html><body>Test</body></html>';
    cache.set('https://example.com/page', html);

    const retrieved = cache.get('https://example.com/page');
    expect(retrieved).toBe(html);
  });

  test('returns null for cache miss', () => {
    const result = cache.get('https://nonexistent.com/page');
    expect(result).toBeNull();
  });

  test('stores different URLs independently', () => {
    cache.set('https://example.com/page1', 'HTML 1');
    cache.set('https://example.com/page2', 'HTML 2');

    expect(cache.get('https://example.com/page1')).toBe('HTML 1');
    expect(cache.get('https://example.com/page2')).toBe('HTML 2');
  });

  test('clears cache', () => {
    cache.set('https://example.com/page', 'HTML');
    cache.clear();

    const result = cache.get('https://example.com/page');
    expect(result).toBeNull();
  });
});

describe('RequestBudget', () => {
  let budget: InstanceType<typeof RequestBudget>;

  beforeEach(() => {
    budget = new RequestBudget();
  });

  test('allows requests initially', () => {
    expect(budget.canMakeRequest('DuckDuckGo')).toBe(true);
    expect(budget.canMakeRequest('Google')).toBe(true);
    expect(budget.canMakeRequest('Bing')).toBe(true);
  });

  test('records successful requests', () => {
    budget.recordRequest('DuckDuckGo', true, 500);

    const stats = budget.getStats('DuckDuckGo');
    expect(stats).toBeDefined();
    expect(stats!.requestCount).toBe(1);
    expect(stats!.successCount).toBe(1);
    expect(stats!.failCount).toBe(0);
  });

  test('records failed requests', () => {
    budget.recordRequest('Google', false, 1000);

    const stats = budget.getStats('Google');
    expect(stats).toBeDefined();
    expect(stats!.requestCount).toBe(1);
    expect(stats!.successCount).toBe(0);
    expect(stats!.failCount).toBe(1);
  });

  test('backs off from failing engines', () => {
    // Record many failures
    for (let i = 0; i < 10; i++) {
      budget.recordRequest('BadEngine', false, 500);
    }

    // Should back off after many failures
    const canMake = budget.canMakeRequest('BadEngine');
    expect(canMake).toBe(false);
  });

  test('resets budget', () => {
    budget.recordRequest('DuckDuckGo', true, 500);
    budget.reset();

    const stats = budget.getStats('DuckDuckGo');
    expect(stats).toBeUndefined();
  });
});

describe('Currency Normalization', () => {
  test('normalizeToUSD converts currencies correctly', async () => {
    const { normalizeToUSD } = await import('../../../../shared/utils');

    expect(normalizeToUSD(100, 'USD')).toBe(100);
    expect(normalizeToUSD(100, 'EUR')).toBeCloseTo(108, 0); // EUR rate ~1.08
    expect(normalizeToUSD(100, 'GBP')).toBeCloseTo(127, 0); // GBP rate ~1.27
    expect(normalizeToUSD(100, 'CAD')).toBeCloseTo(74, 0);  // CAD rate ~0.74
  });

  test('unknown currency defaults to 1.0 rate', async () => {
    const { normalizeToUSD } = await import('../../../../shared/utils');

    expect(normalizeToUSD(100, 'XYZ')).toBe(100);
    expect(normalizeToUSD(100, 'UNKNOWN')).toBe(100);
  });
});

describe('Query Generation', () => {
  test('generates site-specific vendor queries first', async () => {
    const { generateCategorySearchQueries } = await import('../../../../shared/utils');

    const queries = generateCategorySearchQueries('creatine', 'supplements', ['US']);

    // New strategy: first queries use site: operator to target vendor pages directly
    const firstFewQueries = queries.slice(0, 5).join(' ').toLowerCase();

    const hasSiteQuery = firstFewQueries.includes('site:');
    expect(hasSiteQuery).toBe(true);
  });

  test('includes vendor groups in queries', async () => {
    const { generateCategorySearchQueries, CATEGORY_VENDORS } = await import('../../../../shared/utils');

    const queries = generateCategorySearchQueries('whey protein', 'supplements', ['US']);
    const allQueries = queries.join(' ');

    // Should include at least some vendor names
    const vendors = CATEGORY_VENDORS.supplements;
    const hasVendor = vendors.some(v => allQueries.includes(v.split('.')[0]));
    expect(hasVendor).toBe(true);
  });

  test('includes country-specific queries for non-US countries', async () => {
    const { generateCategorySearchQueries } = await import('../../../../shared/utils');

    const queries = generateCategorySearchQueries('vitamin d3', 'supplements', ['US', 'UK', 'DE']);
    const allQueries = queries.join(' ').toLowerCase();

    // Should include UK and Germany references
    expect(allQueries).toMatch(/uk|united kingdom|gbp/i);
    expect(allQueries).toMatch(/de|germany|eur/i);
  });
});
