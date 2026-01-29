/**
 * Web Scraper for Supplement Deal Finder
 *
 * This module handles:
 * 1. Search engine scraping (DuckDuckGo HTML)
 * 2. Product page crawling
 * 3. Price and quantity extraction using heuristics
 *
 * No external APIs - pure HTML scraping only.
 */

import {
  parsePrice,
  parseQuantity,
  normalizeToGrams,
  calculateConfidence,
  cleanTitle,
  extractDomain,
  getRandomUserAgent,
  randomDelay,
} from '../../../shared/utils';
import type { ScrapedProduct, ProductResult } from '../../../shared/types';

// HTML parsing using linkedom for Bun compatibility
import { parseHTML } from 'linkedom';

const REQUEST_TIMEOUT = 15000;
const MAX_CONCURRENT_FETCHES = 8;
const MAX_RESULTS_TO_CRAWL = 50; // Deep search crawls more URLs

// Progress callback type for streaming updates
export type ProgressCallback = (progress: SearchProgress) => void;

export interface SearchProgress {
  stage: 'starting' | 'searching' | 'crawling' | 'extracting' | 'ranking' | 'complete';
  message: string;
  detail?: string;
  searchEnginesQueried?: number;
  totalSearchEngines?: number;
  urlsFound?: number;
  urlsCrawled?: number;
  totalUrlsToCrawl?: number;
  productsExtracted?: number;
  currentUrl?: string;
  resultsCount?: number;
  elapsedMs?: number;
}

/**
 * Fetch HTML content from a URL with retry logic
 */
async function fetchWithRetry(
  url: string,
  retries: number = 2
): Promise<string | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

      const response = await fetch(url, {
        headers: {
          'User-Agent': getRandomUserAgent(),
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
        },
        signal: controller.signal,
        redirect: 'follow',
      });

      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return await response.text();
    } catch (error) {
      if (attempt < retries) {
        await randomDelay(1000, 2000);
        continue;
      }
      console.error(`Failed to fetch ${url}:`, error);
      return null;
    }
  }
  return null;
}

/**
 * Search using Brave Search (more scraper-friendly)
 */
async function searchBrave(query: string): Promise<string[]> {
  const encodedQuery = encodeURIComponent(query);
  const searchUrl = `https://search.brave.com/search?q=${encodedQuery}&source=web`;

  const html = await fetchWithRetry(searchUrl);
  if (!html) return [];

  const { document } = parseHTML(html);
  const urls: string[] = [];

  // Brave uses data-url attribute or href on result links
  // Results are typically in elements with class containing "result" or "snippet"
  const selectors = [
    'a[data-url]',
    '.snippet a',
    '.result a',
    'a.result-header',
    '.fdb a[href^="http"]',
  ];

  for (const selector of selectors) {
    const links = document.querySelectorAll(selector);
    for (const link of links) {
      const href = link.getAttribute('data-url') || link.getAttribute('href');
      if (href && href.startsWith('http') && !href.includes('brave.com')) {
        urls.push(href);
      }
    }
  }

  return urls.slice(0, MAX_RESULTS_TO_CRAWL);
}

/**
 * Search using DuckDuckGo Lite (simpler, more reliable)
 */
async function searchDuckDuckGoLite(query: string): Promise<string[]> {
  const encodedQuery = encodeURIComponent(query);
  const searchUrl = `https://lite.duckduckgo.com/lite/?q=${encodedQuery}`;

  const html = await fetchWithRetry(searchUrl);
  if (!html) return [];

  const { document } = parseHTML(html);
  const urls: string[] = [];

  // DDG Lite uses simple table layout with links
  const links = document.querySelectorAll('a.result-link, td a[href^="http"]');

  for (const link of links) {
    const href = link.getAttribute('href');
    if (href && href.startsWith('http') && !href.includes('duckduckgo.com')) {
      urls.push(href);
    }
  }

  // Also try extracting from any table cell links
  if (urls.length === 0) {
    const allLinks = document.querySelectorAll('a[href^="http"]');
    for (const link of allLinks) {
      const href = link.getAttribute('href');
      if (href && !href.includes('duckduckgo.com')) {
        urls.push(href);
      }
    }
  }

  return urls.slice(0, MAX_RESULTS_TO_CRAWL);
}

/**
 * Search using Google (with shopping-focused query)
 */
async function searchGoogle(query: string): Promise<string[]> {
  const encodedQuery = encodeURIComponent(query);
  // Use Google's no-JS version
  const searchUrl = `https://www.google.com/search?q=${encodedQuery}&num=20`;

  const html = await fetchWithRetry(searchUrl);
  if (!html) return [];

  const { document } = parseHTML(html);
  const urls: string[] = [];

  // Google results are in various formats - try multiple selectors
  const links = document.querySelectorAll('a[href^="/url?"], a[href^="http"]');

  for (const link of links) {
    let href = link.getAttribute('href');
    if (!href) continue;

    // Google wraps URLs in /url?q= format
    if (href.startsWith('/url?')) {
      const match = href.match(/[?&]q=([^&]+)/);
      if (match) {
        try {
          href = decodeURIComponent(match[1]);
        } catch {
          continue;
        }
      }
    }

    if (href.startsWith('http') &&
        !href.includes('google.com') &&
        !href.includes('youtube.com') &&
        !href.includes('maps.google')) {
      urls.push(href);
    }
  }

  return urls.slice(0, MAX_RESULTS_TO_CRAWL);
}

/**
 * Search using Ecosia
 */
async function searchEcosia(query: string): Promise<string[]> {
  const encodedQuery = encodeURIComponent(query);
  const searchUrl = `https://www.ecosia.org/search?q=${encodedQuery}`;

  const html = await fetchWithRetry(searchUrl);
  if (!html) return [];

  const { document } = parseHTML(html);
  const urls: string[] = [];

  // Ecosia results
  const links = document.querySelectorAll('a.result__link, .result a[href^="http"]');
  for (const link of links) {
    const href = link.getAttribute('href');
    if (href && href.startsWith('http') && !href.includes('ecosia.org')) {
      urls.push(href);
    }
  }

  // Fallback: any external links
  if (urls.length === 0) {
    const allLinks = document.querySelectorAll('a[href^="http"]');
    for (const link of allLinks) {
      const href = link.getAttribute('href');
      if (href && !href.includes('ecosia.org')) {
        urls.push(href);
      }
    }
  }

  return urls.slice(0, MAX_RESULTS_TO_CRAWL);
}

/**
 * Search using Yahoo
 */
async function searchYahoo(query: string): Promise<string[]> {
  const encodedQuery = encodeURIComponent(query);
  const searchUrl = `https://search.yahoo.com/search?p=${encodedQuery}`;

  const html = await fetchWithRetry(searchUrl);
  if (!html) return [];

  const { document } = parseHTML(html);
  const urls: string[] = [];

  // Yahoo wraps URLs - look for redirect patterns
  const links = document.querySelectorAll('a[href*="RU="]');
  for (const link of links) {
    const href = link.getAttribute('href');
    if (href) {
      const match = href.match(/RU=([^/]+)/);
      if (match) {
        try {
          const decodedUrl = decodeURIComponent(match[1]);
          if (decodedUrl.startsWith('http')) {
            urls.push(decodedUrl);
          }
        } catch {
          // Skip malformed URLs
        }
      }
    }
  }

  return urls.slice(0, MAX_RESULTS_TO_CRAWL);
}

/**
 * Search using Startpage (Google proxy, privacy-focused)
 */
async function searchStartpage(query: string): Promise<string[]> {
  const encodedQuery = encodeURIComponent(query);
  const searchUrl = `https://www.startpage.com/sp/search?query=${encodedQuery}`;

  const html = await fetchWithRetry(searchUrl);
  if (!html) return [];

  const { document } = parseHTML(html);
  const urls: string[] = [];

  // Startpage results
  const links = document.querySelectorAll('.w-gl__result-url, .result a[href^="http"]');
  for (const link of links) {
    const href = link.getAttribute('href');
    if (href && href.startsWith('http') && !href.includes('startpage.com')) {
      urls.push(href);
    }
  }

  return urls.slice(0, MAX_RESULTS_TO_CRAWL);
}

/**
 * Heuristic extraction of product data from HTML
 *
 * Strategy:
 * 1. Look for common price patterns (schema.org, meta tags, visible text)
 * 2. Extract title from multiple sources (og:title, h1, title tag)
 * 3. Parse quantity from title and description
 * 4. No hardcoded selectors - use pattern matching
 */
function extractProductData(html: string, url: string): ScrapedProduct | null {
  const { document } = parseHTML(html);

  // === TITLE EXTRACTION ===
  // Priority: og:title > product title schema > h1 > title tag
  let title = '';

  const ogTitle = document.querySelector('meta[property="og:title"]');
  if (ogTitle) {
    title = ogTitle.getAttribute('content') || '';
  }

  if (!title) {
    const h1 = document.querySelector('h1');
    if (h1) {
      title = h1.textContent || '';
    }
  }

  if (!title) {
    const titleTag = document.querySelector('title');
    if (titleTag) {
      title = titleTag.textContent || '';
    }
  }

  title = cleanTitle(title);
  if (!title) return null;

  // === PRICE EXTRACTION ===
  // Strategy: Look for structured data first, then common patterns
  let price: number | null = null;
  let currency = 'USD';

  // 1. Try JSON-LD structured data (schema.org)
  const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
  for (const script of jsonLdScripts) {
    try {
      const data = JSON.parse(script.textContent || '');
      const offers = data.offers || data['@graph']?.find((item: any) => item.offers)?.offers;
      if (offers) {
        const offer = Array.isArray(offers) ? offers[0] : offers;
        if (offer.price) {
          price = parseFloat(offer.price);
          currency = offer.priceCurrency || 'USD';
          break;
        }
      }
      // Check for Product type
      if (data['@type'] === 'Product' && data.offers?.price) {
        price = parseFloat(data.offers.price);
        currency = data.offers.priceCurrency || 'USD';
        break;
      }
    } catch {
      // Invalid JSON, skip
    }
  }

  // 2. Try meta tags (common in e-commerce)
  if (price === null) {
    const priceMeta = document.querySelector('meta[property="product:price:amount"], meta[name="price"]');
    if (priceMeta) {
      const priceStr = priceMeta.getAttribute('content');
      if (priceStr) {
        const parsed = parsePrice(priceStr);
        if (parsed) {
          price = parsed.value;
          currency = parsed.currency;
        }
      }
    }
  }

  // 3. Look for price patterns in common containers
  if (price === null) {
    // Common price-related class/attribute patterns
    const priceSelectors = [
      '[class*="price"]:not([class*="compare"]):not([class*="was"]):not([class*="old"])',
      '[data-price]',
      '[itemprop="price"]',
      '.product-price',
      '.sale-price',
      '.current-price',
      '#price',
    ];

    for (const selector of priceSelectors) {
      const elements = document.querySelectorAll(selector);
      for (const el of elements) {
        const text = el.textContent || el.getAttribute('content') || el.getAttribute('data-price') || '';
        const parsed = parsePrice(text);
        if (parsed && parsed.value > 0 && parsed.value < 10000) {
          price = parsed.value;
          currency = parsed.currency;
          break;
        }
      }
      if (price !== null) break;
    }
  }

  // 4. Last resort: scan visible text for price patterns
  if (price === null) {
    const bodyText = document.body?.textContent || '';
    // Look for currency patterns
    const priceMatches = bodyText.match(/[$€£]\s*\d+\.?\d*/g);
    if (priceMatches) {
      for (const match of priceMatches) {
        const parsed = parsePrice(match);
        if (parsed && parsed.value > 1 && parsed.value < 500) {
          price = parsed.value;
          currency = parsed.currency;
          break;
        }
      }
    }
  }

  // === QUANTITY EXTRACTION ===
  // Look in title first, then description, then page content
  let rawQuantity: string | null = null;
  let quantity: number | null = null;
  let unit: string | null = null;

  // Try parsing from title (most reliable)
  const titleQuantity = parseQuantity(title);
  if (titleQuantity) {
    quantity = titleQuantity.value;
    unit = titleQuantity.unit;
    rawQuantity = `${titleQuantity.value}${titleQuantity.unit}`;
  }

  // If not in title, look in meta description
  if (!quantity) {
    const descMeta = document.querySelector('meta[name="description"], meta[property="og:description"]');
    if (descMeta) {
      const desc = descMeta.getAttribute('content') || '';
      const descQuantity = parseQuantity(desc);
      if (descQuantity) {
        quantity = descQuantity.value;
        unit = descQuantity.unit;
        rawQuantity = `${descQuantity.value}${descQuantity.unit}`;
      }
    }
  }

  // Look in product detail areas
  if (!quantity) {
    const detailSelectors = [
      '[class*="product-detail"]',
      '[class*="product-info"]',
      '[class*="variant"]',
      '[class*="size"]',
      'table',
    ];

    for (const selector of detailSelectors) {
      const elements = document.querySelectorAll(selector);
      for (const el of elements) {
        const text = el.textContent || '';
        const parsed = parseQuantity(text);
        if (parsed) {
          quantity = parsed.value;
          unit = parsed.unit;
          rawQuantity = `${parsed.value}${parsed.unit}`;
          break;
        }
      }
      if (quantity) break;
    }
  }

  const vendor = extractDomain(url);

  return {
    title,
    price,
    currency,
    rawQuantity,
    quantity,
    unit,
    url,
    vendor,
  };
}

/**
 * Process scraped products into ranked results
 */
function processResults(products: ScrapedProduct[], query: string): ProductResult[] {
  const results: ProductResult[] = [];

  for (const product of products) {
    // Skip products without price or quantity
    if (product.price === null || product.quantity === null || product.unit === null) {
      continue;
    }

    // Calculate price per unit
    let pricePerUnit: number;
    const normalizedGrams = normalizeToGrams(product.quantity, product.unit);

    if (normalizedGrams !== null && normalizedGrams > 0) {
      // Price per gram for weight-based products
      pricePerUnit = product.price / normalizedGrams;
    } else {
      // Price per unit for count-based (capsules, tablets)
      pricePerUnit = product.price / product.quantity;
    }

    // Calculate confidence
    const confidence = calculateConfidence({
      price: product.price,
      quantity: product.quantity,
      unit: product.unit,
      title: product.title,
    });

    // Skip low confidence results
    if (confidence < 0.5) continue;

    results.push({
      title: product.title,
      price: product.price,
      currency: product.currency,
      quantity: product.quantity,
      unit: product.unit,
      price_per_unit: Math.round(pricePerUnit * 10000) / 10000,
      vendor: product.vendor,
      url: product.url,
      confidence: Math.round(confidence * 100) / 100,
    });
  }

  // Sort by price per unit (ascending) - best deals first
  results.sort((a, b) => a.price_per_unit - b.price_per_unit);

  // Deduplicate by vendor + similar price
  const seen = new Set<string>();
  const deduplicated: ProductResult[] = [];

  for (const result of results) {
    const key = `${result.vendor}-${Math.round(result.price_per_unit * 100)}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduplicated.push(result);
    }
  }

  return deduplicated.slice(0, 50); // Return top 50 results for deep search
}

/**
 * Fetch multiple URLs in parallel with concurrency limit and progress reporting
 */
async function fetchInParallel(
  urls: string[],
  onProgress?: (crawled: number, total: number, currentUrl: string) => void
): Promise<Map<string, string>> {
  const results = new Map<string, string>();
  const chunks: string[][] = [];
  let crawledCount = 0;

  // Split into chunks for rate limiting
  for (let i = 0; i < urls.length; i += MAX_CONCURRENT_FETCHES) {
    chunks.push(urls.slice(i, i + MAX_CONCURRENT_FETCHES));
  }

  for (const chunk of chunks) {
    const promises = chunk.map(async (url) => {
      if (onProgress) {
        onProgress(crawledCount, urls.length, url);
      }
      const html = await fetchWithRetry(url, 1);
      crawledCount++;
      if (html) {
        results.set(url, html);
      }
    });

    await Promise.all(promises);
    await randomDelay(300, 600); // Faster rate limiting for deep search
  }

  return results;
}

/**
 * Generate comprehensive search queries for deep search
 */
function generateDeepSearchQueries(query: string): string[] {
  // Extract the main supplement name (without quantity)
  const supplementName = query.replace(/\d+\s*(g|kg|mg|lb|lbs|oz|capsules?|tablets?|caps?|tabs?|servings?)\b/gi, '').trim();

  return [
    // Direct purchase intent
    `${query} buy online`,
    `${query} best price`,
    `${query} cheap`,
    `${query} discount`,
    `${query} sale`,
    `${supplementName} buy price`,
    `${supplementName} supplement shop`,
    `${supplementName} "add to cart"`,
    `${supplementName} powder buy`,

    // Store-specific searches
    `${supplementName} bodybuilding.com`,
    `${supplementName} amazon`,
    `${supplementName} bulk supplements`,
    `${supplementName} myprotein`,
    `${supplementName} vitacost`,
    `${supplementName} swanson vitamins`,
    `${supplementName} iherb`,
    `${supplementName} gnc`,
    `${supplementName} vitamin shoppe`,

    // Deal-focused
    `${supplementName} lowest price`,
    `${supplementName} cheapest`,
    `${supplementName} bulk buy`,
    `${supplementName} wholesale`,
    `${supplementName} deal`,

    // Product-specific
    `${supplementName} powder price`,
    `${supplementName} capsules price`,
    `buy ${supplementName} online`,
    `order ${supplementName}`,
    `${supplementName} supplement store`,
  ];
}

/**
 * All available search engines
 */
const SEARCH_ENGINES = [
  { name: 'Brave', fn: searchBrave },
  { name: 'DuckDuckGo', fn: searchDuckDuckGoLite },
  { name: 'Ecosia', fn: searchEcosia },
  { name: 'Yahoo', fn: searchYahoo },
  { name: 'Startpage', fn: searchStartpage },
  { name: 'Google', fn: searchGoogle },
];

/**
 * Domains to exclude (non-product sites)
 */
const EXCLUDED_DOMAINS = [
  'wikipedia.org',
  'reddit.com',
  'youtube.com',
  'facebook.com',
  'twitter.com',
  'instagram.com',
  'tiktok.com',
  'pinterest.com',
  'quora.com',
  'medium.com',
  'healthline.com',
  'webmd.com',
  'examine.com',
  'nih.gov',
  'ncbi.nlm.nih.gov',
  'mayoclinic.org',
  'drugs.com',
];

/**
 * Main deep search function with progress reporting
 * Orchestrates comprehensive search across multiple engines and queries
 */
export async function searchSupplementsDeep(
  query: string,
  onProgress?: ProgressCallback
): Promise<ProductResult[]> {
  const startTime = Date.now();

  const emit = (progress: Partial<SearchProgress>) => {
    if (onProgress) {
      onProgress({
        stage: 'starting',
        message: '',
        elapsedMs: Date.now() - startTime,
        ...progress,
      } as SearchProgress);
    }
  };

  console.log(`[DeepSearch] Starting comprehensive search for: ${query}`);
  emit({
    stage: 'starting',
    message: 'Initializing deep search...',
    detail: `Searching for "${query}" across multiple search engines`,
  });

  // Generate all search queries
  const searchQueries = generateDeepSearchQueries(query);
  console.log(`[DeepSearch] Generated ${searchQueries.length} search queries`);

  // Collect URLs from all search engines and queries
  const allUrls = new Set<string>();
  let searchEnginesQueried = 0;
  const totalSearchOperations = searchQueries.length * SEARCH_ENGINES.length;

  emit({
    stage: 'searching',
    message: 'Searching across the web...',
    detail: `Running ${searchQueries.length} queries across ${SEARCH_ENGINES.length} search engines`,
    searchEnginesQueried: 0,
    totalSearchEngines: totalSearchOperations,
    urlsFound: 0,
  });

  // Process queries in batches to avoid overwhelming
  const QUERIES_PER_BATCH = 3;
  for (let i = 0; i < searchQueries.length; i += QUERIES_PER_BATCH) {
    const queryBatch = searchQueries.slice(i, i + QUERIES_PER_BATCH);

    for (const searchQuery of queryBatch) {
      // Run all search engines in parallel for this query
      const enginePromises = SEARCH_ENGINES.map(async (engine) => {
        try {
          const urls = await engine.fn(searchQuery);
          searchEnginesQueried++;
          emit({
            stage: 'searching',
            message: `Searching: ${engine.name}`,
            detail: searchQuery.slice(0, 50) + (searchQuery.length > 50 ? '...' : ''),
            searchEnginesQueried,
            totalSearchEngines: totalSearchOperations,
            urlsFound: allUrls.size,
          });
          return urls;
        } catch (error) {
          console.error(`[DeepSearch] ${engine.name} failed:`, error);
          searchEnginesQueried++;
          return [];
        }
      });

      const results = await Promise.all(enginePromises);
      results.flat().forEach((url) => allUrls.add(url));
    }

    // Small delay between query batches
    await randomDelay(200, 400);
  }

  console.log(`[DeepSearch] Found ${allUrls.size} total URLs`);

  // Filter out non-product URLs
  const productUrls = Array.from(allUrls).filter((url) => {
    const domain = extractDomain(url);
    return !EXCLUDED_DOMAINS.some((excluded) => domain.includes(excluded));
  });

  console.log(`[DeepSearch] Filtered to ${productUrls.length} product URLs`);

  emit({
    stage: 'crawling',
    message: 'Crawling product pages...',
    detail: `Found ${productUrls.length} potential product pages to analyze`,
    urlsFound: productUrls.length,
    urlsCrawled: 0,
    totalUrlsToCrawl: Math.min(productUrls.length, MAX_RESULTS_TO_CRAWL),
  });

  // Fetch all product pages with progress
  const urlsToCrawl = productUrls.slice(0, MAX_RESULTS_TO_CRAWL);
  const pageContents = await fetchInParallel(urlsToCrawl, (crawled, total, currentUrl) => {
    emit({
      stage: 'crawling',
      message: `Crawling page ${crawled + 1} of ${total}`,
      detail: extractDomain(currentUrl),
      currentUrl,
      urlsCrawled: crawled,
      totalUrlsToCrawl: total,
      urlsFound: productUrls.length,
    });
  });

  console.log(`[DeepSearch] Successfully fetched ${pageContents.size} pages`);

  emit({
    stage: 'extracting',
    message: 'Extracting product data...',
    detail: `Analyzing ${pageContents.size} product pages for prices and quantities`,
    urlsCrawled: pageContents.size,
    totalUrlsToCrawl: urlsToCrawl.length,
  });

  // Extract product data from each page
  const products: ScrapedProduct[] = [];
  let extractedCount = 0;

  for (const [url, html] of pageContents) {
    try {
      const product = extractProductData(html, url);
      if (product) {
        products.push(product);
      }
      extractedCount++;

      if (extractedCount % 5 === 0) {
        emit({
          stage: 'extracting',
          message: `Extracting data: ${extractedCount} of ${pageContents.size}`,
          detail: `Found ${products.length} products with price data`,
          productsExtracted: products.length,
        });
      }
    } catch (error) {
      console.error(`[DeepSearch] Failed to extract from ${url}:`, error);
    }
  }

  console.log(`[DeepSearch] Extracted ${products.length} products`);

  emit({
    stage: 'ranking',
    message: 'Ranking results by value...',
    detail: `Analyzing ${products.length} products to find best deals`,
    productsExtracted: products.length,
  });

  // Process and rank results
  const results = processResults(products, query);

  console.log(`[DeepSearch] Returning ${results.length} ranked results`);

  emit({
    stage: 'complete',
    message: 'Search complete!',
    detail: `Found ${results.length} products ranked by value`,
    resultsCount: results.length,
    productsExtracted: products.length,
    urlsCrawled: pageContents.size,
    urlsFound: productUrls.length,
  });

  return results;
}

/**
 * Original quick search function (kept for backwards compatibility)
 */
export async function searchSupplements(query: string): Promise<ProductResult[]> {
  return searchSupplementsDeep(query);
}
