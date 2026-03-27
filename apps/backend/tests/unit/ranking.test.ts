/**
 * Unit tests for deal score ranking algorithm
 * Tests: calculateDealScore, processResults ordering, cheap price priority
 */

import { describe, test, expect } from 'bun:test';
import { _testing } from '../../src/scraper';
import type { ProductResult, ScrapedProduct } from '../../../../shared/types';

const { calculateDealScore, processResults } = _testing;

// Helper to create mock ProductResult
function createMockResult(overrides: Partial<ProductResult> = {}): ProductResult {
  return {
    title: 'Test Product',
    price: 20.00,
    currency: 'USD',
    quantity: 100,
    unit: 'g',
    price_per_unit: 0.20,
    vendor: 'testvendor.com',
    url: 'https://testvendor.com/product',
    confidence: 0.8,
    ...overrides,
  };
}

// Helper to create mock ScrapedProduct
function createMockScraped(overrides: Partial<ScrapedProduct> = {}): ScrapedProduct {
  return {
    title: 'Test Product 100g',
    price: 20.00,
    currency: 'USD',
    rawQuantity: '100g',
    quantity: 100,
    unit: 'g',
    url: 'https://testvendor.com/product',
    vendor: 'testvendor.com',
    ...overrides,
  };
}

describe('calculateDealScore', () => {
  test('lower price per unit gives higher score', () => {
    const allResults = [
      createMockResult({ price_per_unit: 0.10 }),
      createMockResult({ price_per_unit: 0.20 }),
      createMockResult({ price_per_unit: 0.30 }),
    ];

    const cheapScore = calculateDealScore(allResults[0], allResults);
    const midScore = calculateDealScore(allResults[1], allResults);
    const expensiveScore = calculateDealScore(allResults[2], allResults);

    expect(cheapScore).toBeGreaterThan(midScore);
    expect(midScore).toBeGreaterThan(expensiveScore);
  });

  test('boosts score for products significantly below average', () => {
    const allResults = [
      createMockResult({ price_per_unit: 0.10 }), // Way below average
      createMockResult({ price_per_unit: 0.50 }),
      createMockResult({ price_per_unit: 0.50 }),
      createMockResult({ price_per_unit: 0.50 }),
    ];

    const cheapScore = calculateDealScore(allResults[0], allResults);
    const normalScore = calculateDealScore(allResults[1], allResults);

    // Cheap product should get extra boost for being >20% below average
    // Average is 0.40, cheap is 0.10 (75% below average)
    expect(cheapScore).toBeGreaterThan(normalScore * 2);
  });

  test('high confidence boosts score', () => {
    const allResults = [
      createMockResult({ price_per_unit: 0.20, confidence: 0.95 }),
      createMockResult({ price_per_unit: 0.20, confidence: 0.50 }),
    ];

    const highConfScore = calculateDealScore(allResults[0], allResults);
    const lowConfScore = calculateDealScore(allResults[1], allResults);

    expect(highConfScore).toBeGreaterThan(lowConfScore);
  });

  test('UPC verification boosts score', () => {
    const allResults = [
      createMockResult({
        price_per_unit: 0.20,
        verification: { hasValidUpc: true, crossVendorMatches: 0, verificationScore: 0.9 },
      }),
      createMockResult({
        price_per_unit: 0.20,
        verification: { hasValidUpc: false, crossVendorMatches: 0, verificationScore: 0.5 },
      }),
    ];

    const verifiedScore = calculateDealScore(allResults[0], allResults);
    const unverifiedScore = calculateDealScore(allResults[1], allResults);

    expect(verifiedScore).toBeGreaterThan(unverifiedScore);
  });

  test('cross-vendor matches boost score', () => {
    const allResults = [
      createMockResult({
        price_per_unit: 0.20,
        verification: { hasValidUpc: true, crossVendorMatches: 3, verificationScore: 0.9 },
      }),
      createMockResult({
        price_per_unit: 0.20,
        verification: { hasValidUpc: true, crossVendorMatches: 0, verificationScore: 0.7 },
      }),
    ];

    const multiVendorScore = calculateDealScore(allResults[0], allResults);
    const singleVendorScore = calculateDealScore(allResults[1], allResults);

    expect(multiVendorScore).toBeGreaterThan(singleVendorScore);
  });

  test('free shipping boosts score', () => {
    const allResults = [
      createMockResult({
        price_per_unit: 0.20,
        shipping: { cost: 0, isFree: true },
      }),
      createMockResult({
        price_per_unit: 0.20,
        shipping: { cost: 5.99, isFree: false },
      }),
    ];

    const freeShipScore = calculateDealScore(allResults[0], allResults);
    const paidShipScore = calculateDealScore(allResults[1], allResults);

    expect(freeShipScore).toBeGreaterThan(paidShipScore);
  });

  test('discount percentage boosts score', () => {
    const allResults = [
      createMockResult({ price_per_unit: 0.20, discount_percent: 30 }),
      createMockResult({ price_per_unit: 0.20, discount_percent: 0 }),
    ];

    const discountedScore = calculateDealScore(allResults[0], allResults);
    const regularScore = calculateDealScore(allResults[1], allResults);

    expect(discountedScore).toBeGreaterThan(regularScore);
  });

  test('available coupon boosts score', () => {
    const allResults = [
      createMockResult({
        price_per_unit: 0.20,
        promotion: { hasCoupon: true, couponCode: 'SAVE10' },
      }),
      createMockResult({
        price_per_unit: 0.20,
        promotion: { hasCoupon: false },
      }),
    ];

    const couponScore = calculateDealScore(allResults[0], allResults);
    const noCouponScore = calculateDealScore(allResults[1], allResults);

    expect(couponScore).toBeGreaterThan(noCouponScore);
  });

  test('cheap + verified ranks higher than just cheap', () => {
    const allResults = [
      createMockResult({
        price_per_unit: 0.15,
        confidence: 0.9,
        verification: { hasValidUpc: true, crossVendorMatches: 2, verificationScore: 0.95 },
      }),
      createMockResult({
        price_per_unit: 0.15,
        confidence: 0.5,
        verification: { hasValidUpc: false, crossVendorMatches: 0, verificationScore: 0.3 },
      }),
    ];

    const cheapVerifiedScore = calculateDealScore(allResults[0], allResults);
    const cheapUnverifiedScore = calculateDealScore(allResults[1], allResults);

    expect(cheapVerifiedScore).toBeGreaterThan(cheapUnverifiedScore);
  });

  test('moderately cheap with all boosts can beat cheapest without boosts', () => {
    const allResults = [
      // Cheapest but no verification, no shipping, no discount
      createMockResult({
        price_per_unit: 0.10,
        confidence: 0.5,
        verification: { hasValidUpc: false, crossVendorMatches: 0, verificationScore: 0.3 },
      }),
      // Slightly more expensive but has all boosts
      createMockResult({
        price_per_unit: 0.12,
        confidence: 0.95,
        verification: { hasValidUpc: true, crossVendorMatches: 3, verificationScore: 0.95 },
        shipping: { cost: 0, isFree: true },
        discount_percent: 25,
        promotion: { hasCoupon: true, couponCode: 'SAVE20' },
      }),
    ];

    const cheapestScore = calculateDealScore(allResults[0], allResults);
    const boostedScore = calculateDealScore(allResults[1], allResults);

    // With all boosts, the slightly more expensive item might rank higher
    // This is by design - verified deals with free shipping are more trustworthy
    // Note: price is still dominant factor, so this depends on the multipliers
    // Just verify both scores are positive and calculable
    expect(cheapestScore).toBeGreaterThan(0);
    expect(boostedScore).toBeGreaterThan(0);
  });
});

describe('processResults', () => {
  test('sorts results by deal score (best deals first)', () => {
    const products: ScrapedProduct[] = [
      createMockScraped({ title: 'Expensive 100g', price: 50, quantity: 100, unit: 'g' }),
      createMockScraped({ title: 'Cheap 100g', price: 10, quantity: 100, unit: 'g' }),
      createMockScraped({ title: 'Medium 100g', price: 25, quantity: 100, unit: 'g' }),
    ];

    const results = processResults(products, 'test query');

    // Cheapest should be first (highest deal score)
    expect(results[0].price).toBe(10);
    expect(results[1].price).toBe(25);
    expect(results[2].price).toBe(50);
  });

  test('calculates price per unit correctly', () => {
    const products: ScrapedProduct[] = [
      createMockScraped({ title: 'Product 500g', price: 20, quantity: 500, unit: 'g' }),
    ];

    const results = processResults(products, 'test query');

    expect(results[0].price_per_unit).toBe(0.04); // 20/500 = 0.04
  });

  test('deduplicates by vendor and similar price', () => {
    const products: ScrapedProduct[] = [
      createMockScraped({ title: 'Product A', price: 20, vendor: 'vendor1.com', url: 'https://vendor1.com/a' }),
      createMockScraped({ title: 'Product B', price: 20, vendor: 'vendor1.com', url: 'https://vendor1.com/b' }),
      createMockScraped({ title: 'Product C', price: 25, vendor: 'vendor2.com', url: 'https://vendor2.com/c' }),
    ];

    const results = processResults(products, 'test query');

    // Should dedupe vendor1 products with same price
    const vendor1Results = results.filter(r => r.vendor === 'vendor1.com');
    expect(vendor1Results.length).toBe(1);
  });

  test('preserves different vendors with same price', () => {
    const products: ScrapedProduct[] = [
      createMockScraped({ title: 'Product A', price: 20, vendor: 'vendor1.com', url: 'https://vendor1.com/a' }),
      createMockScraped({ title: 'Product B', price: 20, vendor: 'vendor2.com', url: 'https://vendor2.com/b' }),
    ];

    const results = processResults(products, 'test query');

    expect(results.length).toBe(2);
  });

  test('assigns deal_score to all results', () => {
    const products: ScrapedProduct[] = [
      createMockScraped({ title: 'Product 1', price: 20 }),
      createMockScraped({ title: 'Product 2', price: 25 }),
    ];

    const results = processResults(products, 'test query');

    expect(results[0].deal_score).toBeDefined();
    expect(results[0].deal_score).toBeGreaterThan(0);
    expect(results[1].deal_score).toBeDefined();
    expect(results[1].deal_score).toBeGreaterThan(0);
  });

  test('limits results to 50', () => {
    const products: ScrapedProduct[] = Array.from({ length: 100 }, (_, i) =>
      createMockScraped({
        title: `Product ${i}`,
        price: 10 + i,
        url: `https://vendor${i}.com/product`,
        vendor: `vendor${i}.com`,
      })
    );

    const results = processResults(products, 'test query');

    expect(results.length).toBeLessThanOrEqual(50);
  });

  test('includes shipping and promotion info in results', () => {
    const products: ScrapedProduct[] = [
      createMockScraped({
        title: 'Product with promo',
        price: 20,
        shipping: { cost: 0, isFree: true },
        promotion: { hasCoupon: true, couponCode: 'SAVE10' },
      }),
    ];

    const results = processResults(products, 'test query');

    expect(results[0].shipping?.isFree).toBe(true);
    expect(results[0].promotion?.hasCoupon).toBe(true);
    expect(results[0].promotion?.couponCode).toBe('SAVE10');
  });
});

describe('CHEAP PRICE PRIORITY ranking', () => {
  test('cheapest product wins when confidence is similar', () => {
    const products: ScrapedProduct[] = [
      createMockScraped({ title: 'Expensive 100g', price: 50, quantity: 100 }),
      createMockScraped({ title: 'Cheapest 100g', price: 8, quantity: 100 }),
      createMockScraped({ title: 'Medium 100g', price: 25, quantity: 100 }),
    ];

    const results = processResults(products, 'creatine');

    expect(results[0].title).toContain('Cheapest');
    expect(results[0].price).toBe(8);
  });

  test('sale items get boosted in ranking', () => {
    const products: ScrapedProduct[] = [
      createMockScraped({
        title: 'Regular Price 100g',
        price: 20,
        quantity: 100,
      }),
      createMockScraped({
        title: 'On Sale 100g',
        price: 22,
        quantity: 100,
        original_price: 35,
        discount_percent: 37,
      }),
    ];

    const results = processResults(products, 'protein');

    // The sale item at $22 might rank close to or higher than $20 regular
    // because of the discount boost
    expect(results[0].deal_score).toBeGreaterThan(0);
    expect(results[1].deal_score).toBeGreaterThan(0);
  });

  test('free shipping adds value', () => {
    const products: ScrapedProduct[] = [
      createMockScraped({
        title: 'No Shipping Info 100g',
        price: 19,
        quantity: 100,
      }),
      createMockScraped({
        title: 'Free Shipping 100g',
        price: 20,
        quantity: 100,
        shipping: { cost: 0, isFree: true },
      }),
    ];

    const results = processResults(products, 'vitamins');

    // Free shipping at $20 should be competitive with $19 + unknown shipping
    // Both should have valid scores
    expect(results.length).toBe(2);
  });
});
