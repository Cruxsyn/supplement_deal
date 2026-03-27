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
  calculateConfidenceWithUpc,
  cleanTitle,
  extractDomain,
  normalizeBarcode,
  detectBarcodeType,
  generateCategorySearchQueries,
  getExcludedDomains,
  detectCountryFromUrl,
  normalizeToUSD,
  CATEGORY_VENDORS,
  DEAL_AGGREGATOR_SITES,
} from '../../../shared/utils';
import type { ScrapedProduct, ProductResult, ProductIdentifier, QualityVerification, ProductCategory, Country, ShippingInfo, PromotionInfo } from '../../../shared/types';

// Stealth fetch with anti-detection measures
import {
  stealthFetch,
  smartFetchParallel,
  RateLimitError,
  randomDelay,
  getSearchEngineHeaders,
  getSessionProfile,
  rotateProfile,
  isProtectedDomain,
  requiresBrowser,
  smartFetch,
  isBlockedResponse,
} from './stealthFetch';

// Browser availability check
import { isPlaywrightAvailable } from './playwrightRenderer';

// HTML parsing using linkedom for Bun compatibility
import { parseHTML } from 'linkedom';

const REQUEST_TIMEOUT = 15000;
const MAX_CONCURRENT_FETCHES = 8;

// Configurable search depths
export type SearchDepth = 'quick' | 'normal' | 'deep' | 'exhaustive';

export const SEARCH_DEPTHS: Record<SearchDepth, { maxUrls: number; maxQueries: number }> = {
  quick: { maxUrls: 30, maxQueries: 6 },
  normal: { maxUrls: 75, maxQueries: 12 },
  deep: { maxUrls: 150, maxQueries: 18 },
  exhaustive: { maxUrls: 300, maxQueries: 25 },
};

// Default for backwards compatibility
const MAX_RESULTS_TO_CRAWL = 50;

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

// RateLimitError is now imported from stealthFetch

/**
 * Fetch from search engine with stealth headers.
 *
 * CRITICAL FIX: Previously this used raw fetch() which bypassed all stealth
 * measures (cookie persistence, retry logic, profile consistency). Now it builds
 * proper stealth headers AND validates the response is not a captcha/block page.
 * Also treats HTTP 403 as a block signal (many search engines use 403 not 429).
 */
async function fetchSearchEngine(
  searchEngine: string,
  searchUrl: string
): Promise<string | null> {
  const profile = getSessionProfile();
  const headers = getSearchEngineHeaders(searchEngine, profile);

  try {
    // Variable delay to avoid uniform request timing (a strong bot signal)
    await randomDelay(300, 800);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    const response = await fetch(searchUrl, {
      method: 'GET',
      headers,
      signal: controller.signal,
      redirect: 'follow',
    });

    clearTimeout(timeout);

    // Treat both 429 and 403 as rate limit/block signals.
    // Google and Bing commonly return 403 instead of 429.
    if (response.status === 429 || response.status === 403) {
      rotateProfile();
      throw new RateLimitError(`HTTP ${response.status} blocked: ${searchUrl}`);
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const html = await response.text();

    // Detect soft-blocks: 200 OK but the body is a captcha/challenge page.
    // Without this check we would parse the captcha page for product URLs
    // and get zero results silently, wasting the entire query.
    if (isBlockedResponse(html)) {
      console.warn(`[SearchEngine] ${searchEngine} returned a captcha/block page for: ${searchUrl}`);
      rotateProfile();
      throw new RateLimitError(`Soft-blocked by ${searchEngine}: ${searchUrl}`);
    }

    return html;
  } catch (error) {
    if (error instanceof RateLimitError) {
      throw error;
    }
    console.error(`[SearchEngine] Failed to fetch from ${searchEngine}:`, error);
    return null;
  }
}

/**
 * Fetch HTML content from a URL with stealth measures and caching
 * Uses smartFetch which automatically routes to Playwright for protected domains
 * Throws RateLimitError on 429 so callers can handle rate limiting appropriately
 */
async function fetchWithRetry(
  url: string,
  retries: number = 2,
  useCache: boolean = true
): Promise<string | null> {
  // Check URL cache first
  if (useCache) {
    const cached = urlCache.get(url);
    if (cached) {
      return cached;
    }
  }

  try {
    // Use smart fetch - automatically uses Playwright for browser-required domains
    const html = await smartFetch(url, {
      timeout: requiresBrowser(url) ? 30000 : REQUEST_TIMEOUT,
      retries,
      useProxy: isProtectedDomain(url),
      preserveCookies: true,
    });

    // Cache successful fetches
    if (useCache && html) {
      urlCache.set(url, html);
    }

    return html;
  } catch (error) {
    // Propagate rate limit errors
    if (error instanceof RateLimitError) {
      throw error;
    }
    console.error(`Failed to fetch ${url}:`, error);
    return null;
  }
}

/**
 * Search using Brave Search (more scraper-friendly)
 */
async function searchBrave(query: string): Promise<string[]> {
  const encodedQuery = encodeURIComponent(query);
  const searchUrl = `https://search.brave.com/search?q=${encodedQuery}&source=web`;

  const html = await fetchSearchEngine('brave', searchUrl);
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

  const html = await fetchSearchEngine('duckduckgo', searchUrl);
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

  const html = await fetchSearchEngine('google', searchUrl);
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
 * Search using Google Shopping (Tier 2 - product-specific results with prices)
 */
async function searchGoogleShopping(query: string): Promise<string[]> {
  const encodedQuery = encodeURIComponent(query);
  const searchUrl = `https://www.google.com/search?tbm=shop&q=${encodedQuery}`;

  const html = await fetchSearchEngine('google-shopping', searchUrl);
  if (!html) return [];

  const { document } = parseHTML(html);
  const urls: string[] = [];

  // Google Shopping product links
  const selectors = [
    'a[href*="/shopping/product/"]',
    '.sh-dgr__content a[href^="http"]',
    '.sh-dlr__list-result a[href^="http"]',
    'a.shntl[href^="http"]',
    '.mnIHsc a[href^="http"]',
  ];

  for (const selector of selectors) {
    const links = document.querySelectorAll(selector);
    for (const link of links) {
      const href = link.getAttribute('href');
      if (href && href.startsWith('http') && !href.includes('google.com')) {
        // Extract actual URL from Google redirect if needed
        const urlMatch = href.match(/[?&](?:url|q)=([^&]+)/);
        const actualUrl = urlMatch ? decodeURIComponent(urlMatch[1]) : href;
        if (actualUrl.startsWith('http')) {
          urls.push(actualUrl);
        }
      }
    }
  }

  // Fallback: any external links
  if (urls.length === 0) {
    const allLinks = document.querySelectorAll('a[href^="http"]');
    for (const link of allLinks) {
      const href = link.getAttribute('href');
      if (href && !href.includes('google.com') && !href.includes('gstatic.com')) {
        urls.push(href);
      }
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

  const html = await fetchSearchEngine('ecosia', searchUrl);
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

  const html = await fetchSearchEngine('yahoo', searchUrl);
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

  const html = await fetchSearchEngine('startpage', searchUrl);
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
 * Search using Bing (Tier 1 - reliable, good shopping results)
 */
async function searchBing(query: string): Promise<string[]> {
  const encodedQuery = encodeURIComponent(query);
  const searchUrl = `https://www.bing.com/search?q=${encodedQuery}&count=50`;

  const html = await fetchSearchEngine('bing', searchUrl);
  if (!html) return [];

  const { document } = parseHTML(html);
  const urls: string[] = [];

  // Bing results: <li class="b_algo"><h2><a href="...">
  const selectors = [
    '.b_algo h2 a',
    '.b_algo a[href^="http"]',
    'li.b_algo a',
    'a[href^="http"]:not([href*="bing.com"]):not([href*="microsoft.com"])',
  ];

  for (const selector of selectors) {
    const links = document.querySelectorAll(selector);
    for (const link of links) {
      const href = link.getAttribute('href');
      if (href && href.startsWith('http') &&
          !href.includes('bing.com') &&
          !href.includes('microsoft.com') &&
          !href.includes('msn.com')) {
        urls.push(href);
      }
    }
    if (urls.length > 20) break;
  }

  return urls.slice(0, MAX_RESULTS_TO_CRAWL);
}

/**
 * Search using Mojeek (Tier 2 - independent index, good for diversity)
 */
async function searchMojeek(query: string): Promise<string[]> {
  const encodedQuery = encodeURIComponent(query);
  const searchUrl = `https://www.mojeek.com/search?q=${encodedQuery}`;

  const html = await fetchSearchEngine('mojeek', searchUrl);
  if (!html) return [];

  const { document } = parseHTML(html);
  const urls: string[] = [];

  // Mojeek results
  const links = document.querySelectorAll('.results-standard a.ob, a.title[href^="http"]');
  for (const link of links) {
    const href = link.getAttribute('href');
    if (href && href.startsWith('http') && !href.includes('mojeek.com')) {
      urls.push(href);
    }
  }

  // Fallback
  if (urls.length === 0) {
    const allLinks = document.querySelectorAll('a[href^="http"]');
    for (const link of allLinks) {
      const href = link.getAttribute('href');
      if (href && !href.includes('mojeek.com')) {
        urls.push(href);
      }
    }
  }

  return urls.slice(0, MAX_RESULTS_TO_CRAWL);
}

/**
 * Search using Yandex (Tier 2 - strong for EU/Asia results, independent index)
 */
async function searchYandex(query: string): Promise<string[]> {
  const encodedQuery = encodeURIComponent(query);
  const searchUrl = `https://yandex.com/search/?text=${encodedQuery}`;

  const html = await fetchSearchEngine('yandex', searchUrl);
  if (!html) return [];

  const { document } = parseHTML(html);
  const urls: string[] = [];

  // Yandex organic results
  const selectors = [
    '.serp-item a.link[href^="http"]',
    '.OrganicTitle a[href^="http"]',
    'a.organic__url[href^="http"]',
    '.Organic a[href^="http"]',
  ];

  for (const selector of selectors) {
    const links = document.querySelectorAll(selector);
    for (const link of links) {
      const href = link.getAttribute('href');
      if (href && href.startsWith('http') && !href.includes('yandex.') && !href.includes('ya.ru')) {
        urls.push(href);
      }
    }
  }

  // Fallback
  if (urls.length === 0) {
    const allLinks = document.querySelectorAll('a[href^="http"]');
    for (const link of allLinks) {
      const href = link.getAttribute('href');
      if (href && !href.includes('yandex.') && !href.includes('ya.ru')) {
        urls.push(href);
      }
    }
  }

  return urls.slice(0, MAX_RESULTS_TO_CRAWL);
}

/**
 * Search using Qwant (Tier 2 - European index, good for EU vendors)
 */
async function searchQwant(query: string): Promise<string[]> {
  const encodedQuery = encodeURIComponent(query);
  const searchUrl = `https://www.qwant.com/?q=${encodedQuery}&t=web`;

  const html = await fetchSearchEngine('qwant', searchUrl);
  if (!html) return [];

  const { document } = parseHTML(html);
  const urls: string[] = [];

  // Qwant results
  const selectors = [
    'a[data-testid="serp-url"]',
    '.result__url a',
    'a.external[href^="http"]',
  ];

  for (const selector of selectors) {
    const links = document.querySelectorAll(selector);
    for (const link of links) {
      const href = link.getAttribute('href');
      if (href && href.startsWith('http') && !href.includes('qwant.com')) {
        urls.push(href);
      }
    }
  }

  // Fallback: any external links
  if (urls.length === 0) {
    const allLinks = document.querySelectorAll('a[href^="http"]');
    for (const link of allLinks) {
      const href = link.getAttribute('href');
      if (href && !href.includes('qwant.com')) {
        urls.push(href);
      }
    }
  }

  return urls.slice(0, MAX_RESULTS_TO_CRAWL);
}

/**
 * Search using SearXNG (meta-search aggregator)
 * Uses public instances for meta-search across multiple engines.
 * SearXNG instances change frequently; we try multiple and use JSON API
 * when available for more reliable parsing.
 *
 * If SEARXNG_INSTANCE env var is set, it will be used as the primary instance
 * (for self-hosted SearXNG, which is the most reliable option).
 */
async function searchSearXNG(query: string): Promise<string[]> {
  // Allow self-hosted instance via environment variable (most reliable option)
  const selfHosted = process.env.SEARXNG_INSTANCE;

  // Public instances (rotate for reliability).
  // These are large, well-maintained instances as of early 2026.
  const publicInstances = [
    'https://searx.be',
    'https://search.bus-hit.me',
    'https://priv.au',
    'https://search.ononoki.org',
    'https://searx.tiekoetter.com',
  ];

  const instances = selfHosted ? [selfHosted, ...publicInstances] : publicInstances;
  const instance = instances[Math.floor(Math.random() * instances.length)];
  const encodedQuery = encodeURIComponent(query);

  // Try JSON API first (more reliable parsing), fall back to HTML
  const searchUrl = `${instance}/search?q=${encodedQuery}&format=json&categories=general`;

  try {
    const profile = getSessionProfile();
    const headers = getSearchEngineHeaders('searxng', profile);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    const response = await fetch(searchUrl, { headers, signal: controller.signal });
    clearTimeout(timeout);

    if (response.ok) {
      const data = await response.json() as any;
      if (data.results && Array.isArray(data.results)) {
        return data.results
          .map((r: any) => r.url)
          .filter((url: string) => url && url.startsWith('http'))
          .slice(0, MAX_RESULTS_TO_CRAWL);
      }
    }
  } catch {
    // JSON API failed, fall back to HTML parsing below
  }

  // Fallback: HTML parsing
  const htmlSearchUrl = `${instance}/search?q=${encodedQuery}&format=html&categories=general`;
  const html = await fetchSearchEngine('searxng', htmlSearchUrl);
  if (!html) return [];

  const { document } = parseHTML(html);
  const urls: string[] = [];

  // SearXNG results
  const selectors = [
    '.result a.url_wrapper',
    '.result-default a[href^="http"]',
    'article a[href^="http"]',
    'h3 a[href^="http"]',
  ];

  for (const selector of selectors) {
    const links = document.querySelectorAll(selector);
    for (const link of links) {
      const href = link.getAttribute('href');
      if (href && href.startsWith('http') &&
          !href.includes('searx') &&
          !href.includes('bus-hit.me') &&
          !href.includes('priv.au') &&
          !href.includes('ononoki.org') &&
          !href.includes('tiekoetter.com')) {
        urls.push(href);
      }
    }
  }

  // Fallback
  if (urls.length === 0) {
    const allLinks = document.querySelectorAll('a[href^="http"]');
    for (const link of allLinks) {
      const href = link.getAttribute('href');
      if (href && !href.includes('searx')) {
        urls.push(href);
      }
    }
  }

  return urls.slice(0, MAX_RESULTS_TO_CRAWL);
}

/**
 * Extract shipping information from page
 * Detects free shipping, shipping costs, and free shipping thresholds
 */
function extractShippingInfo(document: any, price: number): ShippingInfo {
  const bodyText = document.body?.textContent?.toLowerCase() || '';

  // Check for free shipping patterns
  const freeShippingPatterns = [
    /free\s+shipping/i,
    /ships?\s+free/i,
    /no\s+shipping\s+cost/i,
    /free\s+delivery/i,
    /complimentary\s+shipping/i,
  ];

  const isFree = freeShippingPatterns.some(p => p.test(bodyText));

  // Check for free shipping threshold
  const thresholdPatterns = [
    /free\s+shipping\s+(?:on\s+)?(?:orders?\s+)?(?:over\s+)?\$?(\d+)/i,
    /free\s+delivery\s+(?:on\s+)?(?:orders?\s+)?(?:over\s+)?\$?(\d+)/i,
    /\$(\d+)\s+(?:or\s+more\s+)?(?:for\s+)?free\s+shipping/i,
  ];

  let freeThreshold: number | undefined;
  for (const pattern of thresholdPatterns) {
    const match = bodyText.match(pattern);
    if (match) {
      freeThreshold = parseFloat(match[1]);
      break;
    }
  }

  // Extract shipping cost if shown
  const shippingSelectors = [
    '[class*="shipping-cost"]',
    '[class*="delivery-cost"]',
    '[data-shipping]',
    '.shipping-price',
  ];

  let cost: number | null = null;
  for (const selector of shippingSelectors) {
    const el = document.querySelector(selector);
    if (el) {
      const text = el.textContent || '';
      const parsed = parsePrice(text);
      if (parsed && parsed.value >= 0 && parsed.value < 100) {
        cost = parsed.value;
        break;
      }
    }
  }

  // Auto-qualify for free shipping if price exceeds threshold
  if (freeThreshold && price >= freeThreshold) {
    return { cost: 0, freeThreshold, isFree: true };
  }

  return { cost, freeThreshold, isFree };
}

/**
 * Extract coupon and promotion information from page
 * Detects visible coupon codes, subscribe & save, bulk discounts
 */
function extractPromotionInfo(document: any): PromotionInfo {
  const info: PromotionInfo = { hasCoupon: false };
  const bodyText = document.body?.textContent || '';

  // Look for visible coupon codes
  const couponSelectors = [
    '[class*="coupon"]',
    '[class*="promo-code"]',
    '[class*="discount-code"]',
    '[data-coupon]',
    '.voucher-code',
    '.promo-badge',
  ];

  for (const selector of couponSelectors) {
    const el = document.querySelector(selector);
    if (el) {
      const text = el.textContent || '';
      // Match common coupon patterns (typically all caps, alphanumeric, 4-15 chars)
      const codeMatch = text.match(/\b([A-Z0-9]{4,15})\b/);
      if (codeMatch) {
        info.hasCoupon = true;
        info.couponCode = codeMatch[1];

        // Try to extract discount amount
        const discountMatch = text.match(/(\d+%?\s*off|\$\d+\s*off)/i);
        if (discountMatch) {
          info.couponDiscount = discountMatch[1];
        }
        break;
      }
    }
  }

  // Detect subscribe & save
  const subscribePatterns = [
    /subscribe\s*(?:&|and)?\s*save\s*(\d+%?)/i,
    /save\s*(\d+%?)\s*(?:with\s+)?subscri/i,
    /(\d+%?)\s*off\s*(?:with\s+)?subscri/i,
  ];

  for (const pattern of subscribePatterns) {
    const match = bodyText.match(pattern);
    if (match) {
      info.subscribeDiscount = match[1];
      break;
    }
  }

  // Detect bulk discounts
  const bulkPatterns = [
    /buy\s*(\d+)\s*(?:get|save)\s*(\d+%?)/i,
    /(\d+%?)\s*off\s*(?:when\s+you\s+)?buy\s*(\d+)/i,
    /save\s*(\d+%?)\s*on\s*(\d+)\s*or\s*more/i,
  ];

  for (const pattern of bulkPatterns) {
    const match = bodyText.match(pattern);
    if (match) {
      info.bulkDiscount = match[0];
      break;
    }
  }

  return info;
}

/**
 * Extract sale/original price from page
 * Returns both current (sale) price and original (was) price when available
 */
function extractSalePrice(document: any): { current: number | null; original: number | null; currency: string } {
  let current: number | null = null;
  let original: number | null = null;
  let currency = 'USD';

  // Sale price selectors (current/discounted price)
  const salePriceSelectors = [
    '.sale-price',
    '.special-price',
    '.now-price',
    '.reduced-price',
    '.discount-price',
    '[class*="sale"][class*="price"]',
    '[class*="discount"][class*="price"]',
    '[data-sale-price]',
    '.price-current',
  ];

  // Original price selectors (was/strikethrough price)
  const originalPriceSelectors = [
    '.was-price',
    '.original-price',
    '.regular-price',
    '.list-price',
    '.compare-price',
    '[class*="was"][class*="price"]',
    '[class*="original"][class*="price"]',
    '[class*="strikethrough"]',
    's.price',
    'del',
    '.price-was',
  ];

  // Try to find sale price
  for (const selector of salePriceSelectors) {
    const el = document.querySelector(selector);
    if (el) {
      const text = el.textContent || el.getAttribute('content') || el.getAttribute('data-sale-price') || '';
      const parsed = parsePrice(text);
      if (parsed && parsed.value > 0 && parsed.value < 10000) {
        current = parsed.value;
        currency = parsed.currency;
        break;
      }
    }
  }

  // Try to find original price
  for (const selector of originalPriceSelectors) {
    const el = document.querySelector(selector);
    if (el) {
      const text = el.textContent || el.getAttribute('content') || '';
      const parsed = parsePrice(text);
      if (parsed && parsed.value > 0 && parsed.value < 10000) {
        // Original price should be higher than current
        if (current === null || parsed.value > current) {
          original = parsed.value;
        }
        break;
      }
    }
  }

  return { current, original, currency };
}

/**
 * Heuristic extraction of product data from HTML
 *
 * Strategy:
 * 1. Look for common price patterns (schema.org, meta tags, visible text)
 * 2. Extract title from multiple sources (og:title, h1, title tag)
 * 3. Parse quantity from title and description
 * 4. No hardcoded selectors - use pattern matching
 * 5. Extract shipping, coupons, and sale prices (Phase 2)
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

  // === IDENTIFIER/UPC EXTRACTION ===
  const identifiers: ProductIdentifier[] = [];

  // 1. Extract from JSON-LD schema.org (highest priority)
  for (const script of jsonLdScripts) {
    try {
      const data = JSON.parse(script.textContent || '');
      const product = data['@type'] === 'Product' ? data :
                      data['@graph']?.find((item: any) => item['@type'] === 'Product');

      if (product) {
        // Standard GTIN fields
        const gtinFields = ['gtin', 'gtin12', 'gtin13', 'gtin14', 'productID'];
        for (const field of gtinFields) {
          if (product[field]) {
            const code = normalizeBarcode(String(product[field]));
            const { type, isValid } = detectBarcodeType(code);
            if (type !== 'unknown') {
              identifiers.push({
                type,
                value: code,
                isValidCheckDigit: isValid,
                source: 'json-ld'
              });
            }
          }
        }

        // SKU and MPN
        if (product.sku) {
          identifiers.push({
            type: 'sku',
            value: String(product.sku),
            isValidCheckDigit: true,
            source: 'json-ld'
          });
        }
        if (product.mpn) {
          identifiers.push({
            type: 'mpn',
            value: String(product.mpn),
            isValidCheckDigit: true,
            source: 'json-ld'
          });
        }
      }
    } catch {
      // Invalid JSON, skip
    }
  }

  // 2. Extract from meta tags
  const metaSelectors = [
    'meta[property="product:upc"]',
    'meta[property="og:upc"]',
    'meta[property="product:ean"]',
    'meta[name="upc"]',
    'meta[name="ean"]',
    'meta[name="gtin"]',
  ];

  for (const selector of metaSelectors) {
    const element = document.querySelector(selector);
    if (element) {
      const value = element.getAttribute('content');
      if (value) {
        const code = normalizeBarcode(value);
        const { type, isValid } = detectBarcodeType(code);
        if (type !== 'unknown') {
          identifiers.push({
            type,
            value: code,
            isValidCheckDigit: isValid,
            source: 'meta-tag'
          });
        }
      }
    }
  }

  // 3. Extract from microdata (itemprop attributes)
  const microdataSelectors = [
    '[itemprop="gtin"]',
    '[itemprop="gtin12"]',
    '[itemprop="gtin13"]',
    '[itemprop="gtin14"]',
    '[itemprop="sku"]',
    '[itemprop="mpn"]',
    '[itemprop="productID"]',
  ];

  for (const selector of microdataSelectors) {
    const elements = document.querySelectorAll(selector);
    for (const element of elements) {
      const value = element.getAttribute('content') || element.textContent;
      if (value) {
        const code = normalizeBarcode(value.trim());
        const { type, isValid } = detectBarcodeType(code);
        if (type !== 'unknown') {
          identifiers.push({
            type,
            value: code,
            isValidCheckDigit: isValid,
            source: 'microdata'
          });
        }
      }
    }
  }

  // 4. Extract from data attributes
  const dataAttrElements = document.querySelectorAll('[data-upc], [data-ean], [data-gtin], [data-barcode]');
  for (const element of dataAttrElements) {
    const attrs = ['data-upc', 'data-ean', 'data-gtin', 'data-barcode'];
    for (const attr of attrs) {
      const value = element.getAttribute(attr);
      if (value) {
        const code = normalizeBarcode(value);
        const { type, isValid } = detectBarcodeType(code);
        if (type !== 'unknown') {
          identifiers.push({
            type,
            value: code,
            isValidCheckDigit: isValid,
            source: 'data-attribute'
          });
        }
      }
    }
  }

  // 5. Extract from text patterns near UPC/Barcode labels
  const bodyText = document.body?.textContent || '';
  const textPatterns = [
    /UPC[:\s#]*(\d{12})/gi,
    /EAN[:\s#]*(\d{13})/gi,
    /GTIN[:\s#]*(\d{12,14})/gi,
    /Barcode[:\s#]*(\d{12,14})/gi,
  ];

  for (const pattern of textPatterns) {
    let match;
    while ((match = pattern.exec(bodyText)) !== null) {
      const code = normalizeBarcode(match[1]);
      const { type, isValid } = detectBarcodeType(code);
      if (type !== 'unknown' && isValid) {
        identifiers.push({
          type,
          value: code,
          isValidCheckDigit: isValid,
          source: 'text-pattern'
        });
      }
    }
  }

  // Deduplicate identifiers
  const uniqueIdentifiers = identifiers.filter((id, index, self) =>
    index === self.findIndex(t => t.value === id.value && t.type === id.type)
  );

  // Determine primary UPC (prefer validated universal codes)
  const primaryUpc = uniqueIdentifiers.find(id =>
    ['upc-a', 'ean-13', 'gtin-14'].includes(id.type) && id.isValidCheckDigit
  )?.value;

  // Extract SKU
  const sku = uniqueIdentifiers.find(id => id.type === 'sku')?.value;

  const vendor = extractDomain(url);

  // === PHASE 2: ENHANCED EXTRACTIONS ===

  // Try to get sale/original price for discount detection
  const saleInfo = extractSalePrice(document);
  let original_price: number | undefined;
  let discount_percent: number | undefined;

  // If we found a sale price that's different from main price extraction
  if (saleInfo.current !== null && price !== null) {
    // Use the lower of the two as current price (prioritize sale price)
    if (saleInfo.current < price) {
      original_price = price;
      price = saleInfo.current;
    }
  }

  // If we found an original price higher than current
  if (saleInfo.original !== null && price !== null && saleInfo.original > price) {
    original_price = saleInfo.original;
    discount_percent = Math.round(((saleInfo.original - price) / saleInfo.original) * 100);
  }

  // Extract shipping information
  const shipping = price !== null ? extractShippingInfo(document, price) : undefined;

  // Extract promotion/coupon information
  const promotion = extractPromotionInfo(document);

  return {
    title,
    price,
    currency,
    rawQuantity,
    quantity,
    unit,
    url,
    vendor,
    identifiers: uniqueIdentifiers.length > 0 ? uniqueIdentifiers : undefined,
    primaryUpc,
    sku,
    // Phase 2 fields
    original_price,
    discount_percent,
    shipping,
    promotion: promotion.hasCoupon || promotion.subscribeDiscount || promotion.bulkDiscount ? promotion : undefined,
  };
}

/**
 * Calculate composite deal score (EFFECTIVE TOTAL COST PRIORITY)
 * Higher score = better deal
 *
 * Key insight: the "best deal" is the lowest TOTAL cost including shipping,
 * not just the lowest sticker price. A $15 product with $8 shipping is worse
 * than a $20 product with free shipping.
 */
function calculateDealScore(result: ProductResult, allResults: ProductResult[]): number {
  // Calculate effective price per unit including shipping cost impact
  let effectivePricePerUnit = result.price_per_unit;
  if (result.shipping?.cost && result.shipping.cost > 0 && result.quantity) {
    // Spread shipping cost across units
    const shippingPerUnit = result.shipping.cost / result.quantity;
    effectivePricePerUnit += shippingPerUnit;
  }

  // Calculate average effective price per unit for comparison
  const avgPricePerUnit = allResults.reduce((sum, r) => {
    let eff = r.price_per_unit;
    if (r.shipping?.cost && r.shipping.cost > 0 && r.quantity) {
      eff += r.shipping.cost / r.quantity;
    }
    return sum + eff;
  }, 0) / allResults.length;

  // How much below average (higher = better deal)
  const discountMagnitude = (avgPricePerUnit - effectivePricePerUnit) / avgPricePerUnit;

  // Base score: inverse of effective price per unit (lower total cost = higher score)
  let score = 1 / (effectivePricePerUnit + 0.001);

  // Boost for significant discounts (>20% below average)
  if (discountMagnitude > 0.2) {
    score *= 1 + (discountMagnitude * 0.5);
  }

  // Boost for high confidence
  score *= (0.8 + result.confidence * 0.4);

  // Boost for UPC verification
  if (result.verification?.hasValidUpc) {
    score *= 1.15;
  }

  // Boost for cross-vendor confirmation
  if (result.verification?.crossVendorMatches && result.verification.crossVendorMatches > 0) {
    score *= 1 + (result.verification.crossVendorMatches * 0.05);
  }

  // Boost for free shipping (already factored into effective price, but small extra boost
  // because free shipping = certainty about total cost)
  if (result.shipping?.isFree) {
    score *= 1.05;
  }

  // Boost for sale/discounted items
  if (result.discount_percent && result.discount_percent > 10) {
    score *= 1 + (result.discount_percent / 200);
  }

  // Boost for available coupons
  if (result.promotion?.hasCoupon) {
    score *= 1.05;
  }

  return score;
}

/**
 * Process scraped products into ranked results
 * CHEAP PRICE PRIORITY: Results ranked by composite deal score
 */
function processResults(products: ScrapedProduct[], query: string): ProductResult[] {
  const results: ProductResult[] = [];

  // Group products by UPC for cross-vendor matching
  const upcGroups = new Map<string, ScrapedProduct[]>();
  for (const product of products) {
    if (product.primaryUpc) {
      const existing = upcGroups.get(product.primaryUpc) || [];
      existing.push(product);
      upcGroups.set(product.primaryUpc, existing);
    }
  }

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

    // Calculate normalized USD price for cross-currency comparison
    const pricePerUnitUsd = normalizeToUSD(pricePerUnit, product.currency);

    // Calculate cross-vendor matches
    const crossVendorMatches = product.primaryUpc
      ? (upcGroups.get(product.primaryUpc)?.length || 1) - 1
      : 0;

    // Check if product has a valid UPC
    const hasValidUpc = product.identifiers?.some(id =>
      ['upc-a', 'ean-13', 'gtin-14'].includes(id.type) && id.isValidCheckDigit
    ) || false;

    // Calculate verification score
    let verificationScore = 0;
    if (hasValidUpc) verificationScore += 0.4;
    const sources = new Set(product.identifiers?.map(id => id.source) || []);
    if (sources.size >= 2) verificationScore += 0.2;
    verificationScore += Math.min(crossVendorMatches * 0.1, 0.4);

    const verification: QualityVerification = {
      hasValidUpc,
      crossVendorMatches,
      verificationScore: Math.min(verificationScore, 1),
    };

    // Calculate confidence with UPC boost
    const confidence = calculateConfidenceWithUpc({
      price: product.price,
      quantity: product.quantity,
      unit: product.unit,
      title: product.title,
      hasValidUpc,
      crossVendorMatches,
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
      price_per_unit_usd: Math.round(pricePerUnitUsd * 10000) / 10000,
      vendor: product.vendor,
      url: product.url,
      confidence: Math.round(confidence * 100) / 100,
      upc: product.primaryUpc,
      identifiers: product.identifiers,
      verification,
      // Phase 2 fields
      original_price: product.original_price,
      discount_percent: product.discount_percent,
      shipping: product.shipping,
      promotion: product.promotion,
    });
  }

  // Calculate deal scores for all results
  for (const result of results) {
    result.deal_score = Math.round(calculateDealScore(result, results) * 1000) / 1000;
  }

  // CHEAP PRICE PRIORITY: Sort by deal score (descending - highest score = best deal)
  results.sort((a, b) => (b.deal_score || 0) - (a.deal_score || 0));

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

  return deduplicated.slice(0, 50); // Return top 50 results
}

/**
 * Fetch multiple URLs in parallel with concurrency limit and progress reporting
 * Uses smartFetchParallel which automatically routes to Playwright for protected sites
 */
async function fetchInParallel(
  urls: string[],
  onProgress?: (crawled: number, total: number, currentUrl: string) => void
): Promise<Map<string, string>> {
  // Use smart parallel fetch - automatically uses Playwright for protected domains
  return smartFetchParallel(urls, {
    maxConcurrent: MAX_CONCURRENT_FETCHES,
    timeout: REQUEST_TIMEOUT,
    retries: 1,
    preserveCookies: true,
    onProgress,
  });
}

/**
 * Deduplicate queries by removing near-duplicates
 * Uses simple word overlap detection
 */
function deduplicateQueries(queries: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const query of queries) {
    // Normalize: lowercase, remove punctuation, sort words
    const normalized = query.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 2) // Remove short words
      .sort()
      .join(' ');

    if (!seen.has(normalized)) {
      seen.add(normalized);
      result.push(query);
    }
  }

  return result;
}

/**
 * Generate focused search queries based on category, countries, and depth
 * Scales query count based on search depth configuration
 */
function generateDeepSearchQueries(
  query: string,
  category: ProductCategory = 'supplements',
  countries: Country[] = ['US'],
  maxQueries: number = 12
): string[] {
  // Extract the main product name (without quantity)
  const productName = query.replace(/\d+\s*(g|kg|mg|lb|lbs|oz|capsules?|tablets?|caps?|tabs?|servings?|mm|cm|m|pcs?|pieces?)\b/gi, '').trim();

  // Use the category-specific query generator
  const rawQueries = generateCategorySearchQueries(productName, category, countries);

  // Deduplicate similar queries
  const dedupedQueries = deduplicateQueries(rawQueries);

  // Apply depth-based limit
  return dedupedQueries.slice(0, maxQueries);
}

/**
 * Search engine configuration with reliability tiers
 * Tier 1: Most reliable, use for all queries
 * Tier 2: Good but may rate limit, use sparingly
 * Tier 3: Aggressive rate limiting, only use if others fail
 */
interface SearchEngineConfig {
  name: string;
  fn: (query: string) => Promise<string[]>;
  tier: 1 | 2 | 3;
  rateLimitCooldownMs: number; // How long to wait after rate limit
}

// Engine tier assignments revised March 2026 based on live testing:
// - DuckDuckGo demoted to Tier 3: now serves "anomaly" captchas on all requests.
// - Yahoo promoted to Tier 1: consistently returns results, no blocking observed.
// - Brave promoted to Tier 1: returns good results, low block rate.
// - Bing and Ecosia remain Tier 1: most tolerant of non-browser requests.
// - Google stays Tier 2: aggressively blocks with CAPTCHAs.
// - Startpage stays Tier 2: Google proxy, works when Google doesn't block.
const SEARCH_ENGINES: SearchEngineConfig[] = [
  // Tier 1: Most reliable - use for every query
  { name: 'Bing', fn: searchBing, tier: 1, rateLimitCooldownMs: 45000 },
  { name: 'Yahoo', fn: searchYahoo, tier: 1, rateLimitCooldownMs: 45000 },
  { name: 'Ecosia', fn: searchEcosia, tier: 1, rateLimitCooldownMs: 30000 },
  { name: 'Brave', fn: searchBrave, tier: 1, rateLimitCooldownMs: 60000 },
  // Tier 2: Good but higher block risk
  { name: 'Startpage', fn: searchStartpage, tier: 2, rateLimitCooldownMs: 60000 },
  { name: 'Google', fn: searchGoogle, tier: 2, rateLimitCooldownMs: 90000 },
  { name: 'SearXNG', fn: searchSearXNG, tier: 2, rateLimitCooldownMs: 90000 },
  { name: 'Qwant', fn: searchQwant, tier: 2, rateLimitCooldownMs: 60000 },
  { name: 'Mojeek', fn: searchMojeek, tier: 2, rateLimitCooldownMs: 60000 },
  { name: 'GoogleShopping', fn: searchGoogleShopping, tier: 2, rateLimitCooldownMs: 90000 },
  { name: 'Yandex', fn: searchYandex, tier: 2, rateLimitCooldownMs: 60000 },
  // Tier 3: Aggressive rate limiting / captcha blocking - use rarely
  { name: 'DuckDuckGo', fn: searchDuckDuckGoLite, tier: 3, rateLimitCooldownMs: 300000 },
];

// Track rate limit state per engine with escalating cooldowns.
// Each consecutive block doubles the cooldown (capped at 10 minutes).
const engineRateLimited = new Map<string, number>(); // engine name -> timestamp when rate limit expires
const engineBlockCount = new Map<string, number>(); // consecutive block count for escalation

// Track how many queries we've sent to each engine this session
const engineQueryCount = new Map<string, number>();

/**
 * Record a rate-limit/block event for an engine.
 * Uses exponential escalation: each consecutive block doubles the cooldown.
 */
function recordEngineBlock(engine: SearchEngineConfig): void {
  const consecutive = (engineBlockCount.get(engine.name) || 0) + 1;
  engineBlockCount.set(engine.name, consecutive);
  // Escalate: base cooldown * 2^(consecutive-1), capped at 10 minutes
  const escalatedCooldown = Math.min(
    engine.rateLimitCooldownMs * Math.pow(2, consecutive - 1),
    600000
  );
  engineRateLimited.set(engine.name, Date.now() + escalatedCooldown);
  console.log(`[RateLimit] ${engine.name} blocked (x${consecutive}), cooling down ${Math.round(escalatedCooldown / 1000)}s`);
}

/**
 * Record a successful request for an engine, resetting its block count.
 */
function recordEngineSuccess(engineName: string): void {
  engineBlockCount.set(engineName, 0);
}

// === PHASE 4: CACHING SYSTEMS ===

/**
 * Request Budget System for proactive rate limiting
 */
interface EngineStats {
  requestCount: number;
  successCount: number;
  failCount: number;
  lastRequestTime: number;
  avgResponseTime: number;
}

class RequestBudget {
  private engineStats = new Map<string, EngineStats>();
  private globalRequestCount = 0;
  private readonly maxGlobalRequestsPerMinute = 60;
  private requestTimestamps: number[] = [];

  canMakeRequest(engineName: string): boolean {
    const now = Date.now();

    // Clean old timestamps
    this.requestTimestamps = this.requestTimestamps.filter(t => now - t < 60000);

    // Check global rate limit
    if (this.requestTimestamps.length >= this.maxGlobalRequestsPerMinute) {
      return false;
    }

    // Check engine-specific health - back off from failing engines
    const stats = this.engineStats.get(engineName);
    if (stats && stats.failCount > stats.successCount * 2 && stats.requestCount > 5) {
      return false;
    }

    return true;
  }

  recordRequest(engineName: string, success: boolean, responseTime: number = 0): void {
    const now = Date.now();
    this.requestTimestamps.push(now);
    this.globalRequestCount++;

    const stats = this.engineStats.get(engineName) || {
      requestCount: 0,
      successCount: 0,
      failCount: 0,
      lastRequestTime: 0,
      avgResponseTime: 0,
    };

    stats.requestCount++;
    stats.lastRequestTime = now;
    stats.avgResponseTime = (stats.avgResponseTime + responseTime) / 2;

    if (success) {
      stats.successCount++;
    } else {
      stats.failCount++;
    }

    this.engineStats.set(engineName, stats);
  }

  getStats(engineName: string): EngineStats | undefined {
    return this.engineStats.get(engineName);
  }

  reset(): void {
    this.engineStats.clear();
    this.requestTimestamps = [];
    this.globalRequestCount = 0;
  }
}

const requestBudget = new RequestBudget();

/**
 * Result Cache with 30-minute TTL
 */
interface CacheEntry {
  results: ProductResult[];
  timestamp: number;
  query: string;
  category: ProductCategory;
  countries: Country[];
}

class ResultCache {
  private cache = new Map<string, CacheEntry>();
  private readonly maxAge = 30 * 60 * 1000; // 30 minutes
  private readonly maxEntries = 100;

  private getCacheKey(query: string, category: ProductCategory, countries: Country[], depth: SearchDepth): string {
    return `${query.toLowerCase().trim()}:${category}:${countries.sort().join(',')}:${depth}`;
  }

  get(query: string, category: ProductCategory, countries: Country[], depth: SearchDepth): ProductResult[] | null {
    const key = this.getCacheKey(query, category, countries, depth);
    const entry = this.cache.get(key);

    if (!entry) return null;

    // Check if expired
    if (Date.now() - entry.timestamp > this.maxAge) {
      this.cache.delete(key);
      return null;
    }

    console.log(`[Cache] Hit for "${query}" (${category})`);
    return entry.results;
  }

  set(query: string, category: ProductCategory, countries: Country[], depth: SearchDepth, results: ProductResult[]): void {
    // Evict old entries if at capacity
    if (this.cache.size >= this.maxEntries) {
      const oldest = [...this.cache.entries()]
        .sort(([, a], [, b]) => a.timestamp - b.timestamp)[0];
      if (oldest) {
        this.cache.delete(oldest[0]);
      }
    }

    const key = this.getCacheKey(query, category, countries, depth);
    this.cache.set(key, {
      results,
      timestamp: Date.now(),
      query,
      category,
      countries,
    });
    console.log(`[Cache] Stored ${results.length} results for "${query}"`);
  }

  clear(): void {
    this.cache.clear();
  }
}

const resultCache = new ResultCache();

/**
 * URL Cache with 1-hour TTL for fetched pages
 */
class UrlCache {
  private cache = new Map<string, { html: string; timestamp: number }>();
  private readonly maxAge = 60 * 60 * 1000; // 1 hour
  private readonly maxEntries = 500;

  get(url: string): string | null {
    const entry = this.cache.get(url);
    if (!entry) return null;

    if (Date.now() - entry.timestamp > this.maxAge) {
      this.cache.delete(url);
      return null;
    }

    return entry.html;
  }

  set(url: string, html: string): void {
    // Evict if at capacity
    if (this.cache.size >= this.maxEntries) {
      const oldest = [...this.cache.entries()]
        .sort(([, a], [, b]) => a.timestamp - b.timestamp)[0];
      if (oldest) {
        this.cache.delete(oldest[0]);
      }
    }

    this.cache.set(url, { html, timestamp: Date.now() });
  }

  clear(): void {
    this.cache.clear();
  }
}

const urlCache = new UrlCache();

/**
 * Get engines to use for a given query index
 * - First 2 queries: Tier 1 engines only (most reliable)
 * - Queries 3-4: Tier 1 + Tier 2 engines
 * - Query 5+: All engines (if not rate limited)
 */
function getEnginesForQuery(queryIndex: number, countries: Country[] = ['US']): SearchEngineConfig[] {
  const now = Date.now();

  // Determine if the search targets EU/UK regions
  const euCountries = new Set(['UK', 'DE', 'FR', 'NL', 'IE', 'SE', 'IT', 'ES', 'AT', 'BE', 'CH', 'PL']);
  const hasEuCountry = countries.some(c => euCountries.has(c));

  // EU-friendly engines that should be prioritized for EU searches
  const euEngines = new Set(['Qwant', 'Ecosia', 'Mojeek', 'Yandex']);

  return SEARCH_ENGINES.filter(engine => {
    // Skip if rate limited
    const rateLimitExpiry = engineRateLimited.get(engine.name);
    if (rateLimitExpiry && now < rateLimitExpiry) {
      return false;
    }

    // Tier-based filtering with region awareness
    if (queryIndex < 2) {
      // First 2 queries: tier 1, plus EU engines early if EU countries selected
      if (engine.tier === 1) return true;
      if (hasEuCountry && euEngines.has(engine.name)) return true;
      return false;
    } else if (queryIndex < 4) {
      // Queries 3-4: tier 1 and 2
      return engine.tier <= 2;
    } else {
      // After query 4: all engines, but limit tier 3
      if (engine.tier === 3) {
        const count = engineQueryCount.get(engine.name) || 0;
        return count < 1;
      }
      return true;
    }
  });
}

// EXCLUDED_DOMAINS is now dynamically generated per category using getExcludedDomains()

/**
 * Prioritize URLs for crawling when we have more URLs than our budget
 *
 * Priority tiers:
 * 1. Known vendor domains for this category (most likely to have buyable product pages)
 * 2. Deal aggregator sites (price tracking, coupon data)
 * 3. Other e-commerce looking URLs (contain /product/, /buy/, /shop/, cart references)
 * 4. Everything else
 *
 * Within each tier, URLs are kept in discovery order (search engine ranking)
 */
function prioritizeUrls(urls: string[], category: ProductCategory): string[] {
  const vendors = new Set(CATEGORY_VENDORS[category].map(v => v.replace(/^www\./, '')));
  const dealSites = new Set((DEAL_AGGREGATOR_SITES[category] || []).map(s => s.replace(/^www\./, '')));

  // Check if Playwright is available - if not, deprioritize browser-required domains
  const playwrightAvailable = isPlaywrightAvailable();

  const tier1: string[] = []; // Known vendor domains (fetchable)
  const tier2: string[] = []; // Deal aggregator sites
  const tier3: string[] = []; // E-commerce looking URLs
  const tier4: string[] = []; // Everything else
  const tier5: string[] = []; // Browser-required domains (unfetchable without Playwright)

  for (const url of urls) {
    const domain = extractDomain(url).replace(/^www\./, '');

    // If Playwright unavailable, demote browser-required domains to bottom tier
    if (!playwrightAvailable && requiresBrowser(url)) {
      tier5.push(url);
      continue;
    }

    if (vendors.has(domain) || [...vendors].some(v => domain.endsWith(v))) {
      tier1.push(url);
    } else if (dealSites.has(domain) || [...dealSites].some(s => domain.endsWith(s))) {
      tier2.push(url);
    } else if (
      /\/(product|item|buy|shop|store|p\/|dp\/|ip\/)/i.test(url) ||
      /[?&](product|item|sku|pid)=/i.test(url)
    ) {
      tier3.push(url);
    } else {
      tier4.push(url);
    }
  }

  return [...tier1, ...tier2, ...tier3, ...tier4, ...tier5];
}

/**
 * Main deep search function with progress reporting
 * Orchestrates comprehensive search across multiple engines and queries
 */
export async function searchSupplementsDeep(
  query: string,
  onProgress?: ProgressCallback,
  category: ProductCategory = 'supplements',
  countries: Country[] = ['US'],
  depth: SearchDepth = 'normal'
): Promise<ProductResult[]> {
  // Check result cache first
  const cachedResults = resultCache.get(query, category, countries, depth);
  if (cachedResults) {
    // Emit complete progress for cached results
    if (onProgress) {
      onProgress({
        stage: 'complete',
        message: 'Results loaded from cache!',
        detail: `Found ${cachedResults.length} cached products`,
        resultsCount: cachedResults.length,
        elapsedMs: 0,
      });
    }
    return cachedResults;
  }

  // Get depth configuration
  const depthConfig = SEARCH_DEPTHS[depth];
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

  const categoryNames: Record<ProductCategory, string> = {
    supplements: 'supplements',
    building: 'building products',
    robotics: 'robotics parts',
  };

  console.log(`[DeepSearch] Starting ${depth} search for: ${query} (${categoryNames[category]})`);
  emit({
    stage: 'starting',
    message: `Initializing ${depth} search...`,
    detail: `Searching for "${query}" (${categoryNames[category]}) across ${countries.join(', ')} - ${depth} mode`,
  });

  // Generate all search queries based on category, countries, and depth
  const searchQueries = generateDeepSearchQueries(query, category, countries, depthConfig.maxQueries);
  console.log(`[DeepSearch] Generated ${searchQueries.length} search queries for ${category} (${depth} mode)`);

  // Collect URLs from all search engines and queries
  const allUrls = new Set<string>();
  let searchEnginesQueried = 0;

  // Estimate total operations - we use tier-based selection now, so fewer engines per query
  // Tier 1 engines (2) for all queries, plus some Tier 2/3 for later queries
  const tier1Count = SEARCH_ENGINES.filter(e => e.tier === 1).length;
  const avgEnginesPerQuery = tier1Count + 0.5; // Conservative estimate
  const totalSearchOperations = Math.ceil(searchQueries.length * avgEnginesPerQuery);

  emit({
    stage: 'searching',
    message: 'Searching across the web...',
    detail: `Running ${searchQueries.length} optimized queries across reliable search engines`,
    searchEnginesQueried: 0,
    totalSearchEngines: totalSearchOperations,
    urlsFound: 0,
  });

  // Reset query counts for this session
  engineQueryCount.clear();

  // Process queries with tier-based engine selection
  // Tier 1 engines used for all queries, Tier 2/3 used sparingly
  for (let queryIndex = 0; queryIndex < searchQueries.length; queryIndex++) {
    const searchQuery = searchQueries[queryIndex];

    // Get engines appropriate for this query based on tier system
    const enginesForQuery = getEnginesForQuery(queryIndex, countries);

    if (enginesForQuery.length === 0) {
      console.log(`[DeepSearch] No engines available for query ${queryIndex + 1}, all rate limited`);
      continue;
    }

    console.log(`[DeepSearch] Query ${queryIndex + 1}/${searchQueries.length}: Using ${enginesForQuery.map(e => e.name).join(', ')}`);

    for (const engine of enginesForQuery) {
      // Check request budget before making request (proactive rate limiting)
      if (!requestBudget.canMakeRequest(engine.name)) {
        console.log(`[DeepSearch] Skipping ${engine.name} - request budget exhausted`);
        continue;
      }

      const reqStart = Date.now();
      try {
        const urls = await engine.fn(searchQuery);
        searchEnginesQueried++;

        // Track successful query and reset block escalation
        engineQueryCount.set(engine.name, (engineQueryCount.get(engine.name) || 0) + 1);
        recordEngineSuccess(engine.name);
        requestBudget.recordRequest(engine.name, true, Date.now() - reqStart);

        urls.forEach((url) => allUrls.add(url));

        emit({
          stage: 'searching',
          message: `Searching: ${engine.name}`,
          detail: searchQuery.slice(0, 50) + (searchQuery.length > 50 ? '...' : ''),
          searchEnginesQueried,
          totalSearchEngines: totalSearchOperations,
          urlsFound: allUrls.size,
        });

        // Per-tier delays between engine requests.
        // Tier 3 gets the longest delay; tier 1 the shortest.
        // Adding randomness prevents uniform inter-request timing.
        const delayRanges: Record<number, [number, number]> = {
          1: [500, 1100],
          2: [800, 1600],
          3: [1500, 3000],
        };
        const [dMin, dMax] = delayRanges[engine.tier] || [600, 1200];
        await randomDelay(dMin, dMax);
      } catch (error: any) {
        searchEnginesQueried++;
        requestBudget.recordRequest(engine.name, false, Date.now() - reqStart);

        // Handle rate limiting with escalating cooldowns
        if (error instanceof RateLimitError || error?.name === 'RateLimitError') {
          recordEngineBlock(engine);
        } else {
          console.error(`[DeepSearch] ${engine.name} failed:`, error?.message || error);
        }
      }
    }

    // Variable delay between queries - longer pause every 5th query to break patterns
    if ((queryIndex + 1) % 5 === 0) {
      await randomDelay(2000, 4000);
    } else {
      await randomDelay(800, 1800);
    }
  }

  console.log(`[DeepSearch] Found ${allUrls.size} total URLs`);

  // Filter out non-product URLs using category-specific exclusions
  const excludedDomains = getExcludedDomains(category);
  const filteredUrls = Array.from(allUrls).filter((url) => {
    const domain = extractDomain(url);
    return !excludedDomains.some((excluded) => domain.includes(excluded));
  });

  // Prioritize URLs: known vendors first, then deal sites, then e-commerce URLs, then rest
  const productUrls = prioritizeUrls(filteredUrls, category);

  console.log(`[DeepSearch] Filtered to ${productUrls.length} product URLs (prioritized by vendor/deal relevance)`);

  emit({
    stage: 'crawling',
    message: 'Crawling product pages...',
    detail: `Found ${productUrls.length} potential product pages to analyze (${depth} mode: max ${depthConfig.maxUrls})`,
    urlsFound: productUrls.length,
    urlsCrawled: 0,
    totalUrlsToCrawl: Math.min(productUrls.length, depthConfig.maxUrls),
  });

  // Fetch prioritized product pages (limit based on search depth)
  const urlsToCrawl = productUrls.slice(0, depthConfig.maxUrls);
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

  // Store results in cache for future requests
  resultCache.set(query, category, countries, depth, results);

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
export async function searchSupplements(
  query: string,
  category: ProductCategory = 'supplements',
  countries: Country[] = ['US']
): Promise<ProductResult[]> {
  return searchSupplementsDeep(query, undefined, category, countries, 'normal');
}

/**
 * Generic deep search function alias with depth support
 */
export async function searchProductsDeep(
  query: string,
  category: ProductCategory,
  countries: Country[],
  onProgress?: ProgressCallback,
  depth: SearchDepth = 'normal'
): Promise<ProductResult[]> {
  return searchSupplementsDeep(query, onProgress, category, countries, depth);
}

// === EXPORTS FOR TESTING ===
// These are exported to allow unit testing of internal functions

export const _testing = {
  extractProductData,
  extractShippingInfo,
  extractPromotionInfo,
  extractSalePrice,
  calculateDealScore,
  processResults,
  parsePrice,
  ResultCache,
  UrlCache,
  RequestBudget,
  // Search engine parsers
  searchBrave,
  searchDuckDuckGoLite,
  searchGoogle,
  searchBing,
  searchEcosia,
  searchYahoo,
  searchStartpage,
  searchMojeek,
  searchQwant,
  searchSearXNG,
  searchGoogleShopping,
  searchYandex,
  // URL and query helpers
  prioritizeUrls,
  deduplicateQueries,
  generateDeepSearchQueries,
  getEnginesForQuery,
  fetchSearchEngine,
  fetchWithRetry,
  fetchInParallel,
};

// === SEARCH ENGINE EXPORTS (for solar crawler and other modules) ===
export const _searchEngines = {
  searchBrave, searchBing, searchYahoo, searchEcosia, searchStartpage,
  searchGoogle, searchGoogleShopping, searchMojeek, searchYandex,
  searchQwant, searchSearXNG, searchDuckDuckGoLite,
  SEARCH_ENGINES, getEnginesForQuery, fetchSearchEngine,
  engineRateLimited, recordEngineBlock, recordEngineSuccess, requestBudget,
};
