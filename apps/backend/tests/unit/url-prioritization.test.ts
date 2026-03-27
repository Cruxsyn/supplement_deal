/**
 * Unit tests for URL prioritization, query deduplication, and deep search query generation
 * Tests: prioritizeUrls, deduplicateQueries, generateDeepSearchQueries
 */

import { describe, test, expect, mock } from 'bun:test';

// Mock playwright to avoid browser launch
mock.module('../../src/playwrightRenderer', () => ({
  renderPage: async () => null,
  renderPages: async () => [],
}));

import { _testing } from '../../src/scraper';

const { prioritizeUrls, deduplicateQueries, generateDeepSearchQueries } = _testing;

// ============================================================
// prioritizeUrls
// ============================================================

describe('prioritizeUrls', () => {
  test('known supplement vendor URLs are placed in tier 1 (first)', () => {
    const urls = [
      'https://randomsite.org/creatine',
      'https://iherb.com/creatine-500g',
      'https://unknownblog.com/review',
      'https://amazon.com/dp/B00123',
    ];

    const result = prioritizeUrls(urls, 'supplements');

    // Vendor URLs should come before non-vendor URLs
    expect(result.indexOf('https://iherb.com/creatine-500g')).toBeLessThan(
      result.indexOf('https://randomsite.org/creatine')
    );
    expect(result.indexOf('https://amazon.com/dp/B00123')).toBeLessThan(
      result.indexOf('https://unknownblog.com/review')
    );
  });

  test('deal aggregator URLs are placed in tier 2 (after vendors, before unknowns)', () => {
    const urls = [
      'https://unknownsite.com/page',
      'https://camelcamelcamel.com/product/B00123',
      'https://slickdeals.net/deal/creatine',
      'https://iherb.com/creatine',
    ];

    const result = prioritizeUrls(urls, 'supplements');

    // Vendor first, then deal sites, then unknown
    expect(result.indexOf('https://iherb.com/creatine')).toBeLessThan(
      result.indexOf('https://camelcamelcamel.com/product/B00123')
    );
    expect(result.indexOf('https://slickdeals.net/deal/creatine')).toBeLessThan(
      result.indexOf('https://unknownsite.com/page')
    );
  });

  test('e-commerce pattern URLs are placed in tier 3 (before generic unknowns)', () => {
    const urls = [
      'https://blog.example.com/article',
      'https://newstore.com/product/creatine-500g',
      'https://othershop.com/buy/widget',
      'https://wiki.example.org/info',
    ];

    const result = prioritizeUrls(urls, 'supplements');

    // E-commerce-pattern URLs before generic unknowns
    expect(result.indexOf('https://newstore.com/product/creatine-500g')).toBeLessThan(
      result.indexOf('https://blog.example.com/article')
    );
    expect(result.indexOf('https://othershop.com/buy/widget')).toBeLessThan(
      result.indexOf('https://wiki.example.org/info')
    );
  });

  test('preserves discovery order within the same tier', () => {
    const urls = [
      'https://iherb.com/product-a',
      'https://amazon.com/product-b',
      'https://vitacost.com/product-c',
    ];

    const result = prioritizeUrls(urls, 'supplements');

    // All are tier 1 vendors, order should stay the same
    expect(result).toEqual([
      'https://iherb.com/product-a',
      'https://amazon.com/product-b',
      'https://vitacost.com/product-c',
    ]);
  });

  test('works with building category vendors', () => {
    const urls = [
      'https://randomsite.com/tools',
      'https://homedepot.com/p/drill-set',
      'https://lowes.com/pd/saw',
    ];

    const result = prioritizeUrls(urls, 'building');

    expect(result[0]).toBe('https://homedepot.com/p/drill-set');
    expect(result[1]).toBe('https://lowes.com/pd/saw');
    expect(result[2]).toBe('https://randomsite.com/tools');
  });

  test('works with robotics category vendors', () => {
    const urls = [
      'https://someforum.com/thread/123',
      'https://sparkfun.com/products/12345',
      'https://adafruit.com/product/9999',
    ];

    const result = prioritizeUrls(urls, 'robotics');

    expect(result[0]).toBe('https://sparkfun.com/products/12345');
    expect(result[1]).toBe('https://adafruit.com/product/9999');
    expect(result[2]).toBe('https://someforum.com/thread/123');
  });

  test('handles www. prefix correctly', () => {
    const urls = [
      'https://www.iherb.com/creatine',
      'https://unknownsite.com/page',
    ];

    const result = prioritizeUrls(urls, 'supplements');

    // www.iherb.com should still match iherb.com vendor
    expect(result[0]).toBe('https://www.iherb.com/creatine');
  });

  test('handles empty URL list', () => {
    const result = prioritizeUrls([], 'supplements');
    expect(result).toEqual([]);
  });
});

// ============================================================
// deduplicateQueries
// ============================================================

describe('deduplicateQueries', () => {
  test('removes exact duplicate queries', () => {
    const queries = [
      'creatine monohydrate buy',
      'creatine monohydrate buy',
      'whey protein price',
    ];

    const result = deduplicateQueries(queries);
    expect(result).toHaveLength(2);
    expect(result).toContain('creatine monohydrate buy');
    expect(result).toContain('whey protein price');
  });

  test('removes case-insensitive duplicates and keeps the first occurrence', () => {
    const queries = [
      'Creatine Monohydrate Buy',
      'creatine monohydrate buy',
    ];

    const result = deduplicateQueries(queries);
    expect(result).toHaveLength(1);
    // Should keep the first one
    expect(result[0]).toBe('Creatine Monohydrate Buy');
  });

  test('treats reordered words as duplicates (word-sorted normalization)', () => {
    const queries = [
      'buy creatine monohydrate',
      'creatine monohydrate buy',
    ];

    const result = deduplicateQueries(queries);
    // After normalization (lowercase, sort words), both become "buy creatine monohydrate"
    expect(result).toHaveLength(1);
  });

  test('ignores punctuation when comparing', () => {
    const queries = [
      'creatine (site:iherb.com)',
      'creatine site:iherb.com',
    ];

    const result = deduplicateQueries(queries);
    // Punctuation removed: both normalize to the same words
    expect(result).toHaveLength(1);
  });

  test('ignores short words (length <= 2) during comparison', () => {
    const queries = [
      'creatine to buy at store',
      'creatine buy at store',
    ];

    const result = deduplicateQueries(queries);
    // "to" and "at" are <= 2 chars and get filtered out
    // Both normalize to: "buy creatine store"
    expect(result).toHaveLength(1);
  });

  test('preserves distinct queries', () => {
    const queries = [
      'creatine monohydrate price',
      'whey protein isolate buy',
      'vitamin d3 supplement',
    ];

    const result = deduplicateQueries(queries);
    expect(result).toHaveLength(3);
  });
});

// ============================================================
// generateDeepSearchQueries
// ============================================================

describe('generateDeepSearchQueries', () => {
  test('returns queries up to the maxQueries limit for quick depth', () => {
    const queries = generateDeepSearchQueries('creatine monohydrate', 'supplements', ['US'], 6);

    expect(queries.length).toBeLessThanOrEqual(6);
    expect(queries.length).toBeGreaterThan(0);
  });

  test('returns more queries when maxQueries is higher', () => {
    const quickQueries = generateDeepSearchQueries('creatine monohydrate', 'supplements', ['US'], 6);
    const deepQueries = generateDeepSearchQueries('creatine monohydrate', 'supplements', ['US'], 18);

    expect(deepQueries.length).toBeGreaterThanOrEqual(quickQueries.length);
  });

  test('strips quantity units from the query before generating', () => {
    const queries = generateDeepSearchQueries('creatine 500g', 'supplements', ['US'], 12);

    // The product name used for queries should be "creatine" not "creatine 500g"
    // At least some queries should not contain "500g"
    const withoutUnit = queries.filter(q => !q.includes('500g'));
    expect(withoutUnit.length).toBeGreaterThan(0);
  });

  test('generates deduplicated queries (no near-duplicates)', () => {
    const queries = generateDeepSearchQueries('creatine monohydrate', 'supplements', ['US'], 25);

    // All queries should be unique after dedup
    const deduped = deduplicateQueries(queries);
    expect(deduped.length).toBe(queries.length);
  });

  test('generates queries for building category', () => {
    const queries = generateDeepSearchQueries('cordless drill', 'building', ['US'], 12);

    expect(queries.length).toBeGreaterThan(0);
    // Should include site-specific queries for building vendors
    const hasBuildingVendor = queries.some(
      q => q.includes('homedepot.com') || q.includes('lowes.com') || q.includes('menards.com')
    );
    expect(hasBuildingVendor).toBe(true);
  });
});
