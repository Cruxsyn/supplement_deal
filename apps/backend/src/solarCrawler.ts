/**
 * Solar Panel Leaderboard Crawler
 *
 * Crawls solar panel vendors across multiple countries to build a
 * price-per-watt leaderboard. Uses the same stealth fetch infrastructure
 * as the main scraper.
 *
 * Pipeline:
 * 1. Generate search queries per country
 * 2. Search across multiple engines to find product URLs
 * 3. Fetch and parse product pages in parallel
 * 4. Extract solar-specific data (wattage, efficiency, type, dimensions)
 * 5. Filter and rank by price per watt
 * 6. Save leaderboard to disk
 */

import { smartFetchParallel, stealthFetch, isBlockedResponse, requiresBrowser } from './stealthFetch';
import { _searchEngines } from './scraper';
import type {
  Country, SolarPanelResult, SolarPanelSpecs, SolarPanelType,
  SolarLeaderboard, ShippingInfo,
} from '../../../shared/types';
import {
  parsePrice,
  normalizeToUSD,
  extractDomain,
  detectCountryFromUrl,
  cleanTitle,
  COUNTRY_CONFIG,
  SOLAR_VENDORS,
  SOLAR_DEAL_AGGREGATORS,
  generateSolarSearchQueries,
  parseSolarWattage,
  parseSolarPanelType,
  parseSolarEfficiency,
  parseSolarDimensions,
  parseSolarWeight,
} from '../../../shared/utils';
import { parseHTML } from 'linkedom';
import { isPlaywrightAvailable } from './playwrightRenderer';

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_LEADERBOARD_PATH = 'data/solar-leaderboard.json';
const MAX_CONCURRENT_FETCHES = 8;

/** Domains to exclude from crawling (non-product pages) */
const EXCLUDED_DOMAINS = [
  // Social media
  'wikipedia.org', 'reddit.com', 'youtube.com', 'facebook.com',
  'twitter.com', 'x.com', 'instagram.com', 'tiktok.com', 'pinterest.com',
  'quora.com', 'medium.com', 'linkedin.com',
  // Search engines
  'google.com', 'bing.com', 'duckduckgo.com', 'yahoo.com',
  // News / listicles / affiliate / info
  'buzzfeed.com', 'huffpost.com', 'nytimes.com', 'forbes.com',
  'businessinsider.com', 'cnet.com', 'tomsguide.com', 'techradar.com',
  'thewirecutter.com', 'nymag.com', 'thespruce.com', 'consumeraffairs.com',
  'energy.gov', 'epa.gov',
  // Forums / Q&A
  'stackexchange.com', 'stackoverflow.com',
  // Solar review / info / guides (not stores)
  'solarpowerworldonline.com', 'solarreviews.com', 'greentechrenewables.com',
  'energysage.com', 'palmetto.com', 'nrgcleanpower.com', 'ecoflow.com',
  'cleanenergy.org', 'seia.org', 'solarpowerrocks.com',
  'comparepower.com', 'solartechonline.com', 'solar.com',
];

/** URL path patterns that indicate blog/article/guide pages, NOT product pages */
const BLOG_PATH_PATTERNS = [
  /\/blog\//i, /\/article/i, /\/news\//i, /\/guide/i,
  /\/learn/i, /\/resource/i, /\/faq/i, /\/how-to/i,
  /\/what-is/i, /\/review/i, /\/compare/i, /\/vs\//i,
  /\/best-/i, /\/top-\d/i, /\/cost/i, /\/price.*guide/i,
  /\/calculator/i, /\/estimate/i, /\/savings/i,
  /\/education/i, /\/info\//i, /\/about/i,
];

// ============================================================================
// SEARCH PHASE
// ============================================================================

/**
 * Use search engines to find solar panel product URLs for a set of queries.
 * Uses Tier 1 and Tier 2 engines (Bing, Yahoo, Brave, Startpage) for reliability.
 */
async function searchForSolarUrls(
  queries: string[],
  onProgress?: (msg: string) => void,
): Promise<string[]> {
  const allUrls = new Set<string>();
  const {
    getEnginesForQuery, fetchSearchEngine, recordEngineBlock, recordEngineSuccess,
    engineRateLimited, requestBudget,
  } = _searchEngines;

  for (let qi = 0; qi < queries.length; qi++) {
    const query = queries[qi];
    const engines = getEnginesForQuery(qi);

    // Use only Tier 1 and Tier 2 engines for solar crawling
    const usableEngines = engines.filter(e => e.tier <= 2);

    onProgress?.(`[Search ${qi + 1}/${queries.length}] "${query}" across ${usableEngines.length} engines`);

    for (const engine of usableEngines) {
      // Check rate limit
      const expiry = engineRateLimited.get(engine.name);
      if (expiry && Date.now() < expiry) continue;

      // Check budget
      if (!requestBudget.canMakeRequest(engine.name)) continue;

      try {
        const startTime = Date.now();
        const urls = await engine.fn(query);
        const elapsed = Date.now() - startTime;
        requestBudget.recordRequest(engine.name, true, elapsed);
        recordEngineSuccess(engine.name);

        for (const url of urls) {
          allUrls.add(url);
        }

        onProgress?.(`  ${engine.name}: ${urls.length} URLs (${elapsed}ms)`);
      } catch (error: any) {
        requestBudget.recordRequest(engine.name, false);
        if (error?.name === 'RateLimitError') {
          recordEngineBlock(engine);
        }
      }
    }
  }

  return [...allUrls];
}

// ============================================================================
// URL FILTERING & PRIORITIZATION
// ============================================================================

/**
 * Filter out non-product domains and deduplicate URLs.
 */
function filterUrls(urls: string[]): string[] {
  const excludedSet = new Set(EXCLUDED_DOMAINS);
  const seen = new Set<string>();

  return urls.filter(url => {
    // Deduplicate
    if (seen.has(url)) return false;
    seen.add(url);

    try {
      const domain = extractDomain(url);
      // Exclude non-product domains
      if (excludedSet.has(domain) || [...excludedSet].some(d => domain.endsWith('.' + d))) {
        return false;
      }
      // Exclude blog/article/guide URLs by path pattern
      if (BLOG_PATH_PATTERNS.some(p => p.test(url))) {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  });
}

/**
 * Prioritize URLs: known solar vendors first, then aggregators, then e-commerce patterns, then rest.
 * Browser-required domains are deprioritized when Playwright is unavailable.
 */
function prioritizeSolarUrls(urls: string[]): string[] {
  const vendorSet = new Set(SOLAR_VENDORS.map(v => v.replace(/^www\./, '')));
  const aggSet = new Set(SOLAR_DEAL_AGGREGATORS.map(s => s.replace(/^www\./, '')));
  const playwrightAvailable = isPlaywrightAvailable();

  const tier1: string[] = []; // Known solar vendor domains
  const tier2: string[] = []; // Deal aggregators
  const tier3: string[] = []; // E-commerce URLs (product/item/buy patterns)
  const tier4: string[] = []; // Everything else
  const tier5: string[] = []; // Browser-required domains without Playwright

  for (const url of urls) {
    const domain = extractDomain(url).replace(/^www\./, '');

    // Deprioritize browser-required domains when Playwright unavailable
    if (!playwrightAvailable && requiresBrowser(url)) {
      tier5.push(url);
      continue;
    }

    if (vendorSet.has(domain) || [...vendorSet].some(v => domain.endsWith(v))) {
      tier1.push(url);
    } else if (aggSet.has(domain) || [...aggSet].some(s => domain.endsWith(s))) {
      tier2.push(url);
    } else if (
      /\/(product|item|buy|shop|store|p\/|dp\/|ip\/)/i.test(url) ||
      /[?&](product|item|sku|pid)=/i.test(url) ||
      /solar|panel|watt/i.test(url)
    ) {
      tier3.push(url);
    } else {
      tier4.push(url);
    }
  }

  return [...tier1, ...tier2, ...tier3, ...tier4, ...tier5];
}

// ============================================================================
// DATA EXTRACTION
// ============================================================================

/**
 * Extract solar panel product data from an HTML page.
 * Returns null if price OR wattage cannot be extracted.
 */
export function extractSolarPanelData(html: string, url: string): SolarPanelResult | null {
  try {
    const { document } = parseHTML(html);

    // === TITLE EXTRACTION ===
    let title = '';
    const ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle) title = ogTitle.getAttribute('content') || '';
    if (!title) {
      const h1 = document.querySelector('h1');
      if (h1) title = h1.textContent || '';
    }
    if (!title) {
      const titleTag = document.querySelector('title');
      if (titleTag) title = titleTag.textContent || '';
    }
    title = cleanTitle(title);
    if (!title) return null;

    // === PRODUCT PAGE VALIDATION ===
    // A real product page must have at least ONE of these signals:
    // 1. JSON-LD Product schema
    // 2. "Add to cart" button/text
    // 3. Product-specific meta tags (og:type=product)
    // 4. Price-specific structured elements (itemprop="price")
    // Without these, it's likely a blog/article/category page.
    const bodyText = document.body?.textContent?.toLowerCase() || '';
    const hasJsonLdProduct = (() => {
      const scripts = document.querySelectorAll('script[type="application/ld+json"]');
      for (const s of scripts) {
        try {
          const d = JSON.parse(s.textContent || '');
          if (d['@type'] === 'Product' || d['@type'] === 'ProductGroup') return true;
          if (d['@graph']?.some((i: any) => i['@type'] === 'Product')) return true;
        } catch {}
      }
      return false;
    })();
    const hasAddToCart = /add.to.cart|add.to.basket|buy.now|purchase/i.test(bodyText);
    const hasProductMeta = !!document.querySelector('meta[property="og:type"][content*="product"], meta[property="product:price:amount"]');
    const hasPriceItemprop = !!document.querySelector('[itemprop="price"]');
    const hasDataPrice = !!document.querySelector('[data-price]');

    const productSignals = [hasJsonLdProduct, hasAddToCart, hasProductMeta, hasPriceItemprop, hasDataPrice]
      .filter(Boolean).length;

    // Require at least 1 product signal to avoid extracting from articles
    if (productSignals === 0) return null;

    // === PRICE EXTRACTION ===
    // Prefer structured data over text scan to avoid article prices
    let price: number | null = null;
    let currency = 'USD';
    let priceFromStructuredData = false;

    // 1. JSON-LD structured data
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
        if (data['@type'] === 'Product' && data.offers?.price) {
          price = parseFloat(data.offers.price);
          currency = data.offers.priceCurrency || 'USD';
          priceFromStructuredData = true;
          break;
        }
      } catch {
        // Invalid JSON, skip
      }
    }
    if (price !== null) priceFromStructuredData = true;

    // 2. Meta tags
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

    // 3. CSS selectors
    if (price === null) {
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
          if (parsed && parsed.value > 0 && parsed.value < 50000) {
            price = parsed.value;
            currency = parsed.currency;
            break;
          }
        }
        if (price !== null) break;
      }
    }

    // 4. Text scan - ONLY if strong product signals exist (add-to-cart, JSON-LD)
    // Without product signals, text scan picks up article prices incorrectly
    if (price === null && productSignals >= 2) {
      const scanText = document.body?.textContent || '';
      const priceMatches = scanText.match(/[$\u20AC\u00A3]\s*\d+[.,]?\d*/g);
      if (priceMatches) {
        for (const match of priceMatches) {
          const parsed = parsePrice(match);
          if (parsed && parsed.value > 30 && parsed.value < 50000) {
            price = parsed.value;
            currency = parsed.currency;
            break;
          }
        }
      }
    }

    // Price is required
    if (price === null || price <= 0) return null;

    // === WATTAGE EXTRACTION ===
    // Try title first, then spec tables, then body text
    let wattage: number | null = parseSolarWattage(title);

    if (wattage === null) {
      // Search spec tables and product detail areas
      const specSelectors = [
        'table', '[class*="spec"]', '[class*="detail"]',
        '[class*="feature"]', '[class*="product-info"]',
      ];
      for (const selector of specSelectors) {
        const elements = document.querySelectorAll(selector);
        for (const el of elements) {
          const text = el.textContent || '';
          wattage = parseSolarWattage(text);
          if (wattage !== null) break;
        }
        if (wattage !== null) break;
      }
    }

    // Skip body text scan for wattage - too noisy, catches article mentions
    // Only title and spec tables are reliable sources

    // Wattage is required and must be a realistic single-panel value (5W-1000W)
    if (wattage === null || wattage <= 5 || wattage > 1000) return null;

    // === PANEL TYPE ===
    const panelType = parseSolarPanelType(title) !== 'unknown'
      ? parseSolarPanelType(title)
      : parseSolarPanelType(document.body?.textContent || '');

    // === EFFICIENCY ===
    let efficiency: number | null = null;
    const specAreas = document.querySelectorAll('table, [class*="spec"], [class*="detail"], [class*="feature"]');
    for (const el of specAreas) {
      efficiency = parseSolarEfficiency(el.textContent || '');
      if (efficiency !== null) break;
    }
    if (efficiency === null) {
      efficiency = parseSolarEfficiency(document.body?.textContent || '');
    }

    // === DIMENSIONS ===
    let dimensions: SolarPanelSpecs['dimensions'] = null;
    for (const el of specAreas) {
      dimensions = parseSolarDimensions(el.textContent || '');
      if (dimensions !== null) break;
    }

    // === WEIGHT ===
    let weightKg: number | null = null;
    for (const el of specAreas) {
      weightKg = parseSolarWeight(el.textContent || '');
      if (weightKg !== null) break;
    }

    // === SHIPPING ===
    const shipping = extractSolarShippingInfo(document, price);

    // === BRAND ===
    let brand: string | null = null;
    // Try JSON-LD manufacturer
    for (const script of jsonLdScripts) {
      try {
        const data = JSON.parse(script.textContent || '');
        const product = data['@type'] === 'Product' ? data :
          data['@graph']?.find((item: any) => item['@type'] === 'Product');
        if (product?.brand?.name) {
          brand = product.brand.name;
          break;
        }
        if (product?.manufacturer?.name) {
          brand = product.manufacturer.name;
          break;
        }
      } catch {
        // skip
      }
    }
    // Try to extract brand from title (first word is often the brand)
    if (!brand && title) {
      const knownBrands = [
        'Renogy', 'LONGi', 'JA Solar', 'Trina', 'Canadian Solar', 'Jinko',
        'Risen', 'Hanwha', 'Q CELLS', 'REC', 'SunPower', 'LG', 'Panasonic',
        'Ecoflow', 'Bluetti', 'Goal Zero', 'BougeRV', 'HQST', 'Newpowa',
        'Rich Solar', 'Jackery', 'Grape Solar', 'Aptos', 'Silfab', 'Axitec',
      ];
      for (const b of knownBrands) {
        if (title.toLowerCase().includes(b.toLowerCase())) {
          brand = b;
          break;
        }
      }
    }

    // === COUNTRY ===
    const country = detectCountryFromUrl(url) || 'US';

    // === PRICE PER WATT ===
    const priceUsd = normalizeToUSD(price, currency);
    const pricePerWatt = price / wattage;
    const pricePerWattUsd = priceUsd / wattage;

    // === CONFIDENCE ===
    let confidence = 0;
    if (price > 0) confidence += priceFromStructuredData ? 0.3 : 0.15;
    if (wattage > 0) confidence += 0.25;
    if (efficiency !== null) confidence += 0.1;
    if (shipping.isFree || shipping.cost !== null) confidence += 0.15;
    if (brand) confidence += 0.1;
    // Bonus for strong product signals
    if (hasJsonLdProduct) confidence += 0.1;

    return {
      title,
      price,
      currency,
      priceUsd,
      pricePerWatt: Math.round(pricePerWatt * 1000) / 1000,
      pricePerWattUsd: Math.round(pricePerWattUsd * 1000) / 1000,
      specs: {
        wattage,
        panelType,
        efficiency,
        dimensions,
        weightKg,
        warranty: null,
        cellCount: null,
        brand,
        model: null,
      },
      vendor: extractDomain(url),
      url,
      country,
      shipping,
      confidence,
      lastCrawled: new Date().toISOString(),
    };
  } catch (error) {
    console.error(`[SolarCrawler] Error extracting data from ${url}:`, error);
    return null;
  }
}

/**
 * Extract shipping info from a solar panel product page.
 * Follows the same pattern as the main scraper.
 */
function extractSolarShippingInfo(document: any, price: number): ShippingInfo {
  const bodyText = document.body?.textContent?.toLowerCase() || '';

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

  // Extract shipping cost
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
      if (parsed && parsed.value >= 0 && parsed.value < 500) {
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

// ============================================================================
// FILTERING
// ============================================================================

/**
 * Filter solar panel results:
 * - Remove entries with pricePerWatt outside $0.05-$5.00 (likely extraction errors)
 * - Remove entries with no shipping info (isFree false AND cost null)
 * - Deduplicate by URL
 * - Deduplicate by vendor + similar pricePerWatt (within 5%)
 */
export function filterSolarResults(results: SolarPanelResult[]): SolarPanelResult[] {
  const filtered: SolarPanelResult[] = [];
  const seenUrls = new Set<string>();
  const vendorPriceKeys = new Set<string>();

  for (const result of results) {
    // Skip invalid price per watt (real panels: $0.10-$3.00/W)
    if (result.pricePerWattUsd < 0.10 || result.pricePerWattUsd > 3.0) continue;

    // Skip low confidence results (likely bad extraction)
    if (result.confidence < 0.4) continue;

    // Note: Many solar retailers only show shipping at checkout.
    // We keep results with unknown shipping but penalize confidence.
    // The frontend shows "Shipping TBD" for these.

    // Deduplicate by URL
    if (seenUrls.has(result.url)) continue;
    seenUrls.add(result.url);

    // Deduplicate by vendor + similar pricePerWatt (within 5%)
    // Round pricePerWatt to nearest 5% bucket
    const priceBucket = Math.round(result.pricePerWattUsd * 20); // 5% = 1/20
    const vendorKey = `${result.vendor}:${priceBucket}`;
    if (vendorPriceKeys.has(vendorKey)) continue;
    vendorPriceKeys.add(vendorKey);

    filtered.push(result);
  }

  return filtered;
}

// ============================================================================
// PERSISTENCE
// ============================================================================

/**
 * Save leaderboard to disk as JSON.
 */
export function saveLeaderboard(leaderboard: SolarLeaderboard, path?: string): void {
  const filePath = path || DEFAULT_LEADERBOARD_PATH;
  try {
    Bun.write(filePath, JSON.stringify(leaderboard, null, 2));
    console.log(`[SolarCrawler] Leaderboard saved to ${filePath} (${leaderboard.results.length} results)`);
  } catch (error) {
    console.error(`[SolarCrawler] Failed to save leaderboard to ${filePath}:`, error);
  }
}

/**
 * Load leaderboard from disk (synchronous).
 * Returns null if file does not exist or is invalid.
 */
export function loadLeaderboard(path?: string): SolarLeaderboard | null {
  const filePath = path || DEFAULT_LEADERBOARD_PATH;
  try {
    const fs = require('fs');
    if (!fs.existsSync(filePath)) return null;
    const text = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(text) as SolarLeaderboard;
  } catch {
    return null;
  }
}

/**
 * Async version of loadLeaderboard for runtime use.
 */
export async function loadLeaderboardAsync(path?: string): Promise<SolarLeaderboard | null> {
  const filePath = path || DEFAULT_LEADERBOARD_PATH;
  try {
    const file = Bun.file(filePath);
    const exists = await file.exists();
    if (!exists) return null;
    const text = await file.text();
    return JSON.parse(text) as SolarLeaderboard;
  } catch {
    return null;
  }
}

// ============================================================================
// MAIN CRAWL PIPELINE
// ============================================================================

/**
 * Crawl solar panel vendors and build a price-per-watt leaderboard.
 *
 * Pipeline:
 * 1. Generate search queries per country
 * 2. Search across engines to find product URLs
 * 3. Deduplicate and prioritize URLs
 * 4. Fetch pages in parallel
 * 5. Extract solar panel data
 * 6. Filter and rank by price per watt
 */
export async function crawlSolarLeaderboard(options: {
  countries?: Country[];
  maxPagesPerCountry?: number;
  maxTotalPages?: number;
  onProgress?: (progress: { stage: string; message: string; detail?: string; stats?: any }) => void;
}): Promise<SolarLeaderboard> {
  const {
    countries = ['US', 'CA', 'UK', 'DE', 'AU'],
    maxPagesPerCountry = 500,
    maxTotalPages = 3000,
    onProgress,
  } = options;

  const crawlStarted = new Date().toISOString();
  const startTime = Date.now();

  const allResults: SolarPanelResult[] = [];
  const vendorsCrawled = new Set<string>();
  let totalCrawled = 0;
  let totalExtracted = 0;

  onProgress?.({
    stage: 'starting',
    message: `Starting solar leaderboard crawl for ${countries.length} countries`,
    detail: `Countries: ${countries.join(', ')}`,
  });

  // === PHASE 1: Generate search queries for all countries ===
  const allQueries: { query: string; country: Country }[] = [];
  for (const country of countries) {
    const queries = generateSolarSearchQueries(country);
    for (const query of queries) {
      allQueries.push({ query, country });
    }
  }

  onProgress?.({
    stage: 'searching',
    message: `Generated ${allQueries.length} search queries across ${countries.length} countries`,
  });

  // === PHASE 2: Search for URLs ===
  const allUrls = new Set<string>();
  const countryQueryGroups = new Map<Country, string[]>();

  for (const country of countries) {
    const queries = allQueries
      .filter(q => q.country === country)
      .map(q => q.query);
    countryQueryGroups.set(country, queries);
  }

  for (const [country, queries] of countryQueryGroups) {
    onProgress?.({
      stage: 'searching',
      message: `Searching for solar panels in ${COUNTRY_CONFIG[country].name}...`,
      detail: `${queries.length} queries`,
    });

    const urls = await searchForSolarUrls(queries, (msg) => {
      onProgress?.({ stage: 'searching', message: msg });
    });

    for (const url of urls) {
      allUrls.add(url);
    }

    onProgress?.({
      stage: 'searching',
      message: `${COUNTRY_CONFIG[country].name}: found ${urls.length} URLs (${allUrls.size} total unique)`,
    });
  }

  // === PHASE 3: Filter and prioritize URLs ===
  let filteredUrls = filterUrls([...allUrls]);
  filteredUrls = prioritizeSolarUrls(filteredUrls);

  // Cap total pages
  const urlsToFetch = filteredUrls.slice(0, maxTotalPages);

  onProgress?.({
    stage: 'crawling',
    message: `Filtered to ${urlsToFetch.length} URLs (from ${allUrls.size} total)`,
    detail: `Max pages: ${maxTotalPages}`,
  });

  // === PHASE 4: Fetch pages in parallel ===
  const fetchedPages = await smartFetchParallel(urlsToFetch, {
    maxConcurrent: MAX_CONCURRENT_FETCHES,
    timeout: 20000,
    onProgress: (completed, total, currentUrl) => {
      totalCrawled = completed;
      if (completed % 25 === 0 || completed === total) {
        onProgress?.({
          stage: 'crawling',
          message: `Fetching pages: ${completed}/${total}`,
          detail: currentUrl,
          stats: { totalCrawled: completed, totalUrls: total },
        });
      }
    },
  });

  totalCrawled = fetchedPages.size;

  onProgress?.({
    stage: 'extracting',
    message: `Fetched ${fetchedPages.size} pages, extracting solar data...`,
  });

  // === PHASE 5: Extract solar panel data ===
  let extractCount = 0;
  for (const [url, html] of fetchedPages) {
    // Skip blocked responses
    if (isBlockedResponse(html)) continue;

    try {
      const result = extractSolarPanelData(html, url);
      if (result) {
        allResults.push(result);
        vendorsCrawled.add(result.vendor);
        totalExtracted++;
        extractCount++;

        if (extractCount % 10 === 0) {
          onProgress?.({
            stage: 'extracting',
            message: `Extracted ${extractCount} solar panels so far...`,
            stats: { totalExtracted: extractCount },
          });
        }
      }
    } catch (error) {
      // One failed page should not crash the pipeline
      console.error(`[SolarCrawler] Extraction error for ${url}:`, error);
    }
  }

  onProgress?.({
    stage: 'ranking',
    message: `Extracted ${totalExtracted} panels, filtering and ranking...`,
  });

  // === PHASE 6: Filter ===
  const filteredResults = filterSolarResults(allResults);

  // === PHASE 7: Sort by pricePerWattUsd ascending ===
  filteredResults.sort((a, b) => a.pricePerWattUsd - b.pricePerWattUsd);

  // Take top 1000
  const topResults = filteredResults.slice(0, 1000);

  const crawlCompleted = new Date().toISOString();
  const crawlDurationMs = Date.now() - startTime;

  const leaderboard: SolarLeaderboard = {
    results: topResults,
    metadata: {
      totalCrawled,
      totalExtracted,
      totalAfterFiltering: topResults.length,
      crawlStarted,
      crawlCompleted,
      crawlDurationMs,
      countriesCrawled: countries,
      vendorsCrawled: [...vendorsCrawled],
      version: 1,
    },
  };

  onProgress?.({
    stage: 'complete',
    message: `Crawl complete! ${topResults.length} panels in leaderboard`,
    stats: leaderboard.metadata,
  });

  return leaderboard;
}
