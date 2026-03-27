// Shared utilities for Deep Deal Finder

import type { ProductCategory, Country, ShippingInfo, PromotionInfo, SolarPanelType } from '../types';

/**
 * Exchange rates to USD (approximate, for price comparison only)
 * These should be updated periodically for accuracy
 */
export const EXCHANGE_RATES_TO_USD: Record<string, number> = {
  USD: 1.0,
  EUR: 1.08,
  GBP: 1.27,
  CAD: 0.74,
  AUD: 0.65,
  NZD: 0.61,
  JPY: 0.0067,
  SEK: 0.095,
  SGD: 0.74,
  INR: 0.012,
};

/**
 * Normalize price to USD for cross-currency comparison
 */
export function normalizeToUSD(price: number, currency: string): number {
  const rate = EXCHANGE_RATES_TO_USD[currency.toUpperCase()] || 1.0;
  return price * rate;
}

/**
 * Normalize quantity to grams for comparison
 * Returns null if conversion not possible
 */
export function normalizeToGrams(value: number, unit: string): number | null {
  const lowerUnit = unit.toLowerCase().trim();

  // Weight conversions to grams
  const conversions: Record<string, number> = {
    'g': 1,
    'gr': 1,
    'gm': 1,
    'gram': 1,
    'grams': 1,
    'kg': 1000,
    'kilogram': 1000,
    'kilograms': 1000,
    'mg': 0.001,
    'milligram': 0.001,
    'milligrams': 0.001,
    'mcg': 0.000001,
    'microgram': 0.000001,
    'micrograms': 0.000001,
    'lb': 453.592,
    'lbs': 453.592,
    'pound': 453.592,
    'pounds': 453.592,
    'oz': 28.3495,
    'ounce': 28.3495,
    'ounces': 28.3495,
    'fl oz': 29.5735, // approximate: 1 fl oz ≈ 29.57 ml ≈ 29.57g for water-based
  };

  if (conversions[lowerUnit] !== undefined) {
    return value * conversions[lowerUnit];
  }

  return null;
}

/**
 * Parse quantity string into value and unit
 * Handles formats like: "500g", "1.5 kg", "2 lbs", "100 capsules"
 */
export function parseQuantity(text: string): { value: number; unit: string } | null {
  if (!text) return null;

  // Clean the text
  const cleaned = text.toLowerCase().trim();

  // Common patterns for quantity extraction
  const patterns = [
    // "500g", "500 g", "500grams", "500gr", "500gm", "2.2 fl oz"
    /(\d+(?:\.\d+)?)\s*(g|gr|gm|gram|grams|kg|kilogram|kilograms|mg|milligram|milligrams|mcg|microgram|micrograms|lb|lbs|pound|pounds|fl\.?\s*oz|oz|ounce|ounces|ml|l|litre|liter|cc|iu)\b/i,
    // "500 capsules", "60 tablets", "30 servings"
    /(\d+(?:\.\d+)?)\s*(capsules?|tablets?|caps?|tabs?|softgels?|veggie\s*caps?|vcaps?|servings?|scoops?|doses?|packets?|sticks?|gummies?|chews?|lozenges?)/i,
    // Handle "x 500mg" format (like "120 x 500mg")
    /(\d+)\s*x\s*(\d+(?:\.\d+)?)\s*(mg|g|mcg|iu)/i,
  ];

  for (const pattern of patterns) {
    const match = cleaned.match(pattern);
    if (match) {
      // Handle "120 x 500mg" format
      if (match.length === 4 && match[0].includes('x')) {
        const count = parseFloat(match[1]);
        const perUnit = parseFloat(match[2]);
        const unit = match[3];
        // Convert to total mg/g
        return { value: count * perUnit, unit };
      }

      const value = parseFloat(match[1]);
      let unit = match[2].toLowerCase();

      // Normalize unit names
      if (unit === 'gram' || unit === 'grams' || unit === 'gr' || unit === 'gm') unit = 'g';
      if (unit === 'kilogram' || unit === 'kilograms') unit = 'kg';
      if (unit === 'milligram' || unit === 'milligrams') unit = 'mg';
      if (unit === 'microgram' || unit === 'micrograms' || unit === 'mcg') unit = 'mcg';
      if (unit === 'pound' || unit === 'pounds') unit = 'lb';
      if (unit === 'ounce' || unit === 'ounces') unit = 'oz';
      if (unit.includes('fl') && unit.includes('oz')) unit = 'fl oz';
      if (unit === 'capsule' || unit === 'caps' || unit === 'cap' || unit === 'vcaps' || unit === 'vcap') unit = 'capsules';
      if (unit.includes('veggie') && unit.includes('cap')) unit = 'capsules';
      if (unit === 'tablet' || unit === 'tabs' || unit === 'tab') unit = 'tablets';
      if (unit === 'softgel') unit = 'softgels';
      if (unit === 'serving' || unit === 'scoop' || unit === 'dose') unit = 'servings';
      if (unit === 'scoops' || unit === 'doses') unit = 'servings';
      if (unit === 'packet' || unit === 'packets' || unit === 'stick' || unit === 'sticks') unit = 'servings';
      if (unit === 'gummy' || unit === 'gummies' || unit === 'chew' || unit === 'chews' || unit === 'lozenge' || unit === 'lozenges') unit = 'servings';
      if (unit === 'litre' || unit === 'liter') unit = 'l';
      if (unit === 'cc') unit = 'ml';

      return { value, unit };
    }
  }

  return null;
}

/**
 * Extract price from text
 * Handles formats like: "$19.99", "€15,50", "£12.99", "19.99 USD"
 */
export function parsePrice(text: string): { value: number; currency: string } | null {
  if (!text) return null;

  const cleaned = text.trim();

  // Currency symbol patterns
  const patterns = [
    // $19.99, €15.50, £12.99
    /([£$€₹¥])\s*(\d+(?:[.,]\d{2})?)/,
    // 19.99 USD, 15.50 EUR
    /(\d+(?:[.,]\d{2})?)\s*(USD|EUR|GBP|INR|AUD|CAD|JPY)/i,
    // Just numbers with decimal (assume USD)
    /(\d+(?:\.\d{2}))/,
  ];

  const currencyMap: Record<string, string> = {
    '$': 'USD',
    '€': 'EUR',
    '£': 'GBP',
    '₹': 'INR',
    '¥': 'JPY',
  };

  for (const pattern of patterns) {
    const match = cleaned.match(pattern);
    if (match) {
      let value: number;
      let currency: string;

      if (match[1] in currencyMap) {
        // Symbol first
        currency = currencyMap[match[1]];
        value = parseFloat(match[2].replace(',', '.'));
      } else if (match[2] && /^[A-Z]{3}$/i.test(match[2])) {
        // Currency code after number
        value = parseFloat(match[1].replace(',', '.'));
        currency = match[2].toUpperCase();
      } else {
        // Just a number
        value = parseFloat(match[1].replace(',', '.'));
        currency = 'USD';
      }

      if (!isNaN(value) && value > 0) {
        return { value, currency };
      }
    }
  }

  return null;
}

/**
 * Calculate confidence score for a product result
 * Based on data completeness and clarity
 */
export function calculateConfidence(product: {
  price: number | null;
  quantity: number | null;
  unit: string | null;
  title: string;
}): number {
  let score = 0;
  let factors = 0;

  // Price clarity (0.3 weight)
  if (product.price !== null && product.price > 0) {
    score += 0.3;
  }
  factors += 0.3;

  // Quantity parsed (0.3 weight)
  if (product.quantity !== null && product.quantity > 0) {
    score += 0.3;
  }
  factors += 0.3;

  // Unit clarity (0.2 weight)
  if (product.unit !== null) {
    const knownUnits = ['g', 'kg', 'mg', 'lb', 'oz', 'capsules', 'tablets', 'servings', 'softgels'];
    if (knownUnits.includes(product.unit.toLowerCase())) {
      score += 0.2;
    }
  }
  factors += 0.2;

  // Title quality (0.2 weight)
  if (product.title && product.title.length > 10) {
    score += 0.1;
    // Bonus for containing quantity info
    if (/\d+\s*(g|kg|mg|capsules|tablets)/i.test(product.title)) {
      score += 0.1;
    }
  }
  factors += 0.2;

  return Math.min(1, score / factors * factors);
}

/**
 * Clean and normalize product title
 */
export function cleanTitle(title: string): string {
  return title
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s\-.,()]/g, '')
    .trim()
    .slice(0, 200);
}

/**
 * Extract domain from URL
 */
export function extractDomain(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return 'unknown';
  }
}

/**
 * Generate search queries for finding supplement prices
 */
export function generateSearchQueries(supplement: string): string[] {
  const base = supplement.trim();

  return [
    `${base} buy price`,
    `${base} shop online`,
    `"${base}" "add to cart"`,
    `${base} supplement store`,
    `${base} -review -blog -reddit`,
  ];
}

/**
 * Country-specific configuration for multi-country search
 */
export const COUNTRY_CONFIG: Record<Country, {
  name: string;
  currency: string;
  currencySymbol: string;
  domains: string[];
  searchSuffix: string;
}> = {
  US: { name: 'United States', currency: 'USD', currencySymbol: '$', domains: ['.com'], searchSuffix: 'USA' },
  CA: { name: 'Canada', currency: 'CAD', currencySymbol: 'C$', domains: ['.ca'], searchSuffix: 'Canada' },
  UK: { name: 'United Kingdom', currency: 'GBP', currencySymbol: '£', domains: ['.co.uk', '.uk'], searchSuffix: 'UK' },
  DE: { name: 'Germany', currency: 'EUR', currencySymbol: '€', domains: ['.de'], searchSuffix: 'Deutschland' },
  FR: { name: 'France', currency: 'EUR', currencySymbol: '€', domains: ['.fr'], searchSuffix: 'France' },
  ES: { name: 'Spain', currency: 'EUR', currencySymbol: '€', domains: ['.es'], searchSuffix: 'España' },
  IT: { name: 'Italy', currency: 'EUR', currencySymbol: '€', domains: ['.it'], searchSuffix: 'Italia' },
  NL: { name: 'Netherlands', currency: 'EUR', currencySymbol: '€', domains: ['.nl'], searchSuffix: 'Nederland' },
  SE: { name: 'Sweden', currency: 'SEK', currencySymbol: 'kr', domains: ['.se'], searchSuffix: 'Sverige' },
  AU: { name: 'Australia', currency: 'AUD', currencySymbol: 'A$', domains: ['.com.au', '.au'], searchSuffix: 'Australia' },
  NZ: { name: 'New Zealand', currency: 'NZD', currencySymbol: 'NZ$', domains: ['.co.nz', '.nz'], searchSuffix: 'New Zealand' },
  IE: { name: 'Ireland', currency: 'EUR', currencySymbol: '€', domains: ['.ie'], searchSuffix: 'Ireland' },
  JP: { name: 'Japan', currency: 'JPY', currencySymbol: '¥', domains: ['.jp', '.co.jp'], searchSuffix: '日本' },
  SG: { name: 'Singapore', currency: 'SGD', currencySymbol: 'S$', domains: ['.sg', '.com.sg'], searchSuffix: 'Singapore' },
};

/**
 * Category-specific vendor lists (expanded with discount/outlet vendors)
 * Organized by tier: major retailers, discount/warehouse, international, regional specialists
 */
export const CATEGORY_VENDORS: Record<ProductCategory, string[]> = {
  supplements: [
    // Tier 1: Fetchable without browser (verified no Cloudflare on product pages)
    // These sites return real HTML via fetch() - prioritize for scraping
    'allstarhealth.com', 'dpsnutrition.net', 'taoofherbs.com',
    'jacked-factory.com',
    // Tier 2: Major US retailers (need Playwright - deprioritized when unavailable)
    'iherb.com', 'vitacost.com', 'swansonvitamins.com', 'bulksupplements.com',
    'amazon.com', 'bodybuilding.com', 'gnc.com', 'vitaminshoppe.com',
    // Tier 3: Discount/Warehouse
    'costco.com', 'samsclub.com', 'puritan.com', 'pipingrock.com',
    'thrivemarket.com', 'luckyvitamin.com',
    // Tier 4: International
    'myprotein.com', 'hollandandbarrett.com',
    'bulk.com', 'theproteinworks.com', 'prozis.com', 'gymbeam.com',
    // Tier 5: Specialty/Direct
    'pureformulas.com', 'life-extension.com', 'supersmart.com', 'momentous.com',
    // Tier 6: Regional
    'chemistwarehouse.com.au', 'shop-apotheke.com', 'docmorris.de',
    // Tier 7: AU/NZ
    'amcal.com.au', 'pharmacyonline.com.au', 'healthpost.co.nz',
    // Tier 8: JP/SG
    'rakuten.co.jp', 'amazon.co.jp', 'guardian.com.sg', 'watsons.com.sg',
    // Tier 9: SE/Nordic
    'apotea.se', 'proteinbolaget.se',
  ],
  building: [
    // Tier 1: Major US retailers
    'homedepot.com', 'lowes.com', 'menards.com', 'acehardware.com',
    // Tier 2: Discount/Outlet (often cheapest)
    'harborfreight.com', 'northerntool.com', 'cpooutlets.com',
    'factoryauthorizedoutlet.com', 'toolnut.com',
    // Tier 3: UK/EU retailers
    'screwfix.com', 'toolstation.com', 'bunnings.com.au', 'bauhaus.de',
    // Tier 4: Industrial/wholesale
    'grainger.com', 'zoro.com', 'fastenal.com', 'mcmaster.com',
    // Tier 5: Tool brands & specialists
    'festoolusa.com', 'makita.com', 'dewalt.com', 'milwaukeetool.com',
    'toolup.com', 'toolbarn.com', 'kctoolco.com', 'ohio-power-tool.com',
    // Tier 6: NZ/AU
    'bunnings.co.nz', 'mitre10.co.nz',
    // Tier 7: DE/FR/EU
    'hornbach.de', 'obi.de', 'leroymerlin.fr',
    // Tier 8: SG/Asia
    'horme.com.sg',
    // Tier 9: Specialist woodworking/hand tools
    'woodcraft.com', 'rockler.com', 'thetoolstore.ca',
    'axminster.co.uk', 'rutlands.com', 'platetools.com',
  ],
  robotics: [
    // Tier 1: Hobbyist retailers
    'robotshop.com', 'sparkfun.com', 'adafruit.com', 'pololu.com',
    // Tier 2: Budget/China-direct (often cheapest)
    'aliexpress.com', 'banggood.com', 'lcsc.com',
    // Tier 3: Competition/education platforms
    'servocity.com', 'gobilda.com', 'andymark.com', 'revrobotics.com',
    // Tier 4: Electronics distributors
    'digikey.com', 'mouser.com', 'arrow.com', 'newark.com',
    // Tier 5: Industrial & international
    'automation24.com', 'automationdirect.com',
    'reichelt.de', 'rs-online.com', 'farnell.com', 'tme.eu',
    // Tier 6: AU/NZ
    'coreelectronics.com.au', 'littlebirdelectronics.com.au', 'nicegear.co.nz',
    // Tier 7: JP/SG
    'switch-science.com', 'akizukidenshi.com', 'cytron.io',
    // Tier 8: SE/Nordic
    'electrokit.com',
    // Tier 9: DTC/maker brands
    'seeedstudio.com', 'dfrobot.com', 'waveshare.com',
    'pimoroni.com', 'thepihut.com', 'oddwires.com',
  ],
};

/**
 * Deal aggregator sites that track prices, coupons, and discounts
 * These sites are valuable for discovering deals humans would find
 */
export const DEAL_AGGREGATOR_SITES: Record<ProductCategory, string[]> = {
  supplements: [
    'priceplow.com', 'slickdeals.net', 'dealsplus.com',
    'supplementreviews.com', 'labdoor.com', 'camelcamelcamel.com',
  ],
  building: [
    'camelcamelcamel.com', 'slickdeals.net', 'dealsplus.com',
    'toolguyd.com', 'garagejournal.com',
  ],
  robotics: [
    'camelcamelcamel.com', 'slickdeals.net',
    'hackaday.io',
  ],
};

/**
 * Generate category-specific search queries
 *
 * Strategy: Three types of queries that produce actual product pages:
 * 1. SITE-SPECIFIC: Target known vendor domains directly (most reliable)
 * 2. SHOPPING-INTENT: Phrases that match product listing pages
 * 3. DEAL DISCOVERY: Target aggregator/coupon sites for hidden deals
 *
 * Avoids: Generic "cheapest price" / "best deal" modifiers which return
 * review articles and listicles instead of buyable product pages.
 */
export function generateCategorySearchQueries(
  query: string,
  category: ProductCategory,
  countries: Country[] = ['US']
): string[] {
  const base = query.trim();
  const queries: string[] = [];

  // === 1. SITE-SPECIFIC QUERIES (highest value - go straight to vendor pages) ===
  // Use site: operator for top vendors known to have best prices
  const topVendors = CATEGORY_VENDORS[category].slice(0, 8);
  // Group into pairs for site: queries (2 vendors per query to stay focused)
  for (let i = 0; i < topVendors.length; i += 2) {
    const sites = topVendors.slice(i, i + 2);
    const siteQuery = sites.map(v => `site:${v}`).join(' OR ');
    queries.push(`${base} (${siteQuery})`);
  }

  // === 2. SHOPPING-INTENT QUERIES (match actual store pages) ===
  // These phrases appear on product listing pages, not review articles
  const shoppingModifiers: Record<ProductCategory, string[]> = {
    supplements: [
      '"add to cart"',
      '"in stock" buy',
      'price per serving',
      '-review -blog -article -reddit -"best 10"',
    ],
    building: [
      '"add to cart"',
      '"in stock" buy',
      'price each',
      '-review -blog -article -reddit -"best 10"',
    ],
    robotics: [
      '"add to cart"',
      '"in stock" buy',
      'price each',
      '-review -blog -article -reddit -"best 10"',
    ],
  };

  for (const modifier of shoppingModifiers[category]) {
    queries.push(`${base} ${modifier}`);
  }

  // === 3. DEAL AGGREGATOR QUERIES (find deals humans would find) ===
  const dealSites = DEAL_AGGREGATOR_SITES[category];
  if (dealSites.length > 0) {
    const dealSiteQuery = dealSites.slice(0, 3).map(s => `site:${s}`).join(' OR ');
    queries.push(`${base} (${dealSiteQuery})`);
  }

  // === 4. DISCOUNT VENDOR QUERIES (target known discount retailers) ===
  // These are vendors after the top 8 that are specifically discount/outlet
  const discountVendors = CATEGORY_VENDORS[category].slice(8, 14);
  if (discountVendors.length > 0) {
    const discountSiteQuery = discountVendors.slice(0, 3).map(v => `site:${v}`).join(' OR ');
    queries.push(`${base} (${discountSiteQuery})`);
    if (discountVendors.length > 3) {
      const discountSiteQuery2 = discountVendors.slice(3, 6).map(v => `site:${v}`).join(' OR ');
      queries.push(`${base} (${discountSiteQuery2})`);
    }
  }

  // === 5. COUNTRY-SPECIFIC QUERIES ===
  const nonUsCountries = countries.filter(c => c !== 'US').slice(0, 6);
  for (const country of nonUsCountries) {
    const config = COUNTRY_CONFIG[country];
    if (config) {
      // Use the country domain TLD for targeted results
      const tld = config.domains[0]; // e.g. ".co.uk", ".de"
      queries.push(`${base} buy site:*${tld}`);
    }
  }

  // === 6. PRICE COMPARISON PATTERNS ===
  const priceComparisonModifiers: Record<ProductCategory, string[]> = {
    supplements: ['"per serving" price', 'coupon code discount', 'buy supplement online'],
    building: ['"price each" bulk', 'clearance sale'],
    robotics: ['"unit price" buy', 'discount code'],
  };

  // === 6b. PRICE COMPARISON SITES (fetchable without browser) ===
  const priceCompSites: Record<ProductCategory, string[]> = {
    supplements: ['priceplow.com', 'nootropicsdepot.com', 'allstarhealth.com'],
    building: [],
    robotics: [],
  };
  if (priceCompSites[category].length > 0) {
    const pcsQuery = priceCompSites[category].map(s => `site:${s}`).join(' OR ');
    queries.push(`${base} (${pcsQuery})`);
  }
  for (const modifier of priceComparisonModifiers[category]) {
    queries.push(`${base} ${modifier}`);
  }

  // === 7. ALTERNATIVE PRODUCT QUERIES ===
  queries.push(`"alternative to" "${base}" buy`);

  // === 8. COUNTRY-SPECIFIC VENDOR DOMAIN QUERIES ===
  // Target regional vendor domains directly for non-US countries
  const regionalVendors = CATEGORY_VENDORS[category].filter(v =>
    /\.(co\.\w{2}|com\.\w{2}|\w{2}\.\w{2})$/.test(v) && !v.endsWith('.com')
  );
  if (regionalVendors.length > 0) {
    const regionalSiteQuery = regionalVendors.slice(0, 4).map(v => `site:${v}`).join(' OR ');
    queries.push(`${base} (${regionalSiteQuery})`);
  }

  // === 9. EXACT MATCH + SHOPPING QUERY ===
  // Quoted product name to avoid irrelevant results
  queries.push(`"${base}" buy`);
  queries.push(`"${base}" price`);

  return queries;
}

/**
 * Get excluded domains for a category (non-product sites)
 * NOTE: Deal aggregator sites (slickdeals, camelcamelcamel) are NOT excluded
 * because they contain valuable price/deal data even though they are not stores.
 */
export function getExcludedDomains(category: ProductCategory): string[] {
  const commonExcluded = [
    // Social media
    'wikipedia.org', 'reddit.com', 'youtube.com', 'facebook.com',
    'twitter.com', 'x.com', 'instagram.com', 'tiktok.com', 'pinterest.com',
    'quora.com', 'medium.com', 'linkedin.com',
    // Search engines (own results)
    'google.com', 'bing.com', 'duckduckgo.com', 'yahoo.com',
    // Generic listicle/affiliate sites
    'buzzfeed.com', 'huffpost.com', 'nytimes.com', 'forbes.com',
    'businessinsider.com', 'cnet.com', 'tomsguide.com', 'techradar.com',
    'thewirecutter.com', 'nymag.com', 'thespruce.com',
    // Forums/Q&A
    'stackexchange.com', 'stackoverflow.com',
  ];

  const categoryExcluded: Record<ProductCategory, string[]> = {
    supplements: [
      'healthline.com', 'webmd.com', 'examine.com', 'nih.gov',
      'ncbi.nlm.nih.gov', 'mayoclinic.org', 'drugs.com',
      'verywellhealth.com', 'medicalnewstoday.com', 'self.com',
      'menshealth.com', 'womenshealthmag.com',
    ],
    building: [
      'bobvila.com', 'familyhandyman.com', 'thisoldhouse.com',
      'diynetwork.com', 'instructables.com', 'hgtv.com',
      'protoolreviews.com', // reviews, not a store
    ],
    robotics: [
      'ieee.org', 'arxiv.org', 'hackaday.com', 'instructables.com',
      'makezine.com', 'ros.org', 'hackaday.io',
    ],
  };

  return [...commonExcluded, ...categoryExcluded[category]];
}

/**
 * Detect country from URL domain
 */
export function detectCountryFromUrl(url: string): Country | null {
  try {
    const { hostname } = new URL(url);

    for (const [country, config] of Object.entries(COUNTRY_CONFIG) as [Country, typeof COUNTRY_CONFIG[Country]][]) {
      for (const domain of config.domains) {
        if (hostname.endsWith(domain)) {
          return country;
        }
      }
    }

    // Default .com to US
    if (hostname.endsWith('.com')) {
      return 'US';
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Randomize user agent for requests
 */
export function getRandomUserAgent(): string {
  const agents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  ];

  return agents[Math.floor(Math.random() * agents.length)];
}

/**
 * Sleep for a random duration (rate limiting)
 */
export function randomDelay(minMs: number = 500, maxMs: number = 1500): Promise<void> {
  const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise(resolve => setTimeout(resolve, delay));
}

// === Barcode/UPC Utilities ===

import type { BarcodeType } from '../types';

/**
 * Validate UPC-A check digit (12 digits)
 * Uses standard Modulo 10 check digit algorithm
 */
export function validateUpcA(upc: string): boolean {
  if (!/^\d{12}$/.test(upc)) return false;

  const digits = upc.split('').map(Number);
  const checkDigit = digits[11];

  // Sum odd positions (0,2,4,6,8,10) * 3 + even positions (1,3,5,7,9)
  let sum = 0;
  for (let i = 0; i < 11; i++) {
    sum += digits[i] * (i % 2 === 0 ? 3 : 1);
  }

  const calculatedCheck = (10 - (sum % 10)) % 10;
  return checkDigit === calculatedCheck;
}

/**
 * Validate EAN-13 check digit (13 digits)
 */
export function validateEan13(ean: string): boolean {
  if (!/^\d{13}$/.test(ean)) return false;

  const digits = ean.split('').map(Number);
  const checkDigit = digits[12];

  // Sum odd positions * 1 + even positions * 3
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += digits[i] * (i % 2 === 0 ? 1 : 3);
  }

  const calculatedCheck = (10 - (sum % 10)) % 10;
  return checkDigit === calculatedCheck;
}

/**
 * Validate GTIN-14 check digit (14 digits)
 */
export function validateGtin14(gtin: string): boolean {
  if (!/^\d{14}$/.test(gtin)) return false;

  const digits = gtin.split('').map(Number);
  const checkDigit = digits[13];

  // Same algorithm as EAN-13 but with 13 digits before check
  let sum = 0;
  for (let i = 0; i < 13; i++) {
    sum += digits[i] * (i % 2 === 0 ? 3 : 1);
  }

  const calculatedCheck = (10 - (sum % 10)) % 10;
  return checkDigit === calculatedCheck;
}

/**
 * Normalize barcode to standard format
 * Handles stripped leading zeros (common issue)
 */
export function normalizeBarcode(code: string): string {
  const cleaned = code.replace(/[\s\-]/g, '');

  // Handle UPC with leading zeros stripped (11 digits → 12)
  if (/^\d{11}$/.test(cleaned)) {
    return '0' + cleaned;
  }

  return cleaned;
}

/**
 * Detect barcode type and validate check digit
 */
export function detectBarcodeType(code: string): { type: BarcodeType; isValid: boolean } {
  const cleaned = normalizeBarcode(code);

  if (/^\d{12}$/.test(cleaned)) {
    return { type: 'upc-a', isValid: validateUpcA(cleaned) };
  }
  if (/^\d{13}$/.test(cleaned)) {
    return { type: 'ean-13', isValid: validateEan13(cleaned) };
  }
  if (/^\d{14}$/.test(cleaned)) {
    return { type: 'gtin-14', isValid: validateGtin14(cleaned) };
  }

  // SKU/MPN are alphanumeric, can't validate check digit
  if (/^[A-Z0-9\-]{4,30}$/i.test(cleaned)) {
    return { type: 'sku', isValid: true };
  }

  return { type: 'unknown', isValid: false };
}

/**
 * Convert UPC-A to EAN-13 (add leading zero)
 */
export function upcToEan(upc: string): string {
  if (/^\d{12}$/.test(upc)) {
    return '0' + upc;
  }
  return upc;
}

/**
 * Calculate confidence score with UPC verification boost
 */
export function calculateConfidenceWithUpc(product: {
  price: number | null;
  quantity: number | null;
  unit: string | null;
  title: string;
  hasValidUpc?: boolean;
  crossVendorMatches?: number;
}): number {
  let score = 0;
  const maxScore = 1.2; // Allow for UPC bonus

  // Price clarity (0.25 weight)
  if (product.price !== null && product.price > 0) {
    score += 0.25;
  }

  // Quantity parsed (0.25 weight)
  if (product.quantity !== null && product.quantity > 0) {
    score += 0.25;
  }

  // Unit clarity (0.15 weight)
  if (product.unit !== null) {
    const knownUnits = ['g', 'kg', 'mg', 'lb', 'oz', 'capsules', 'tablets', 'servings', 'softgels'];
    if (knownUnits.includes(product.unit.toLowerCase())) {
      score += 0.15;
    }
  }

  // Title quality (0.15 weight)
  if (product.title && product.title.length > 10) {
    score += 0.1;
    if (/\d+\s*(g|kg|mg|capsules|tablets)/i.test(product.title)) {
      score += 0.05;
    }
  }

  // UPC verification bonus
  if (product.hasValidUpc) {
    score += 0.15;
  }

  // Cross-vendor confirmation bonus (max 0.15)
  if (product.crossVendorMatches && product.crossVendorMatches > 0) {
    score += Math.min(product.crossVendorMatches * 0.05, 0.15);
  }

  return Math.min(score / maxScore, 1);
}

// ============================================================================
// SOLAR PANEL LEADERBOARD UTILITIES
// ============================================================================

/**
 * Solar panel vendor domains organized by tier.
 * Tier 1: Fetchable without browser (no Cloudflare)
 * Tier 2: Need Playwright (major retailers with bot detection)
 * Tier 3: EU vendors
 * Tier 4: AU vendors
 * Tier 5: Aggregators
 */
export const SOLAR_VENDORS: string[] = [
  // Tier 1: Fetchable, no Cloudflare
  'renogy.com', 'signature-solar.com', 'shopsolarkits.com', 'unboundsolar.com',
  'wholesalesolar.com', 'solaris.com', 'bousol.com', 'goalzero.com',
  // Tier 2: Need Playwright
  'homedepot.com', 'lowes.com', 'amazon.com', 'costco.com',
  // Tier 3: EU
  'autosolar.es', 'alma-solarshop.de', 'photovoltaik4all.de',
  'krannich-solar.com', 'europe-solarstore.com',
  // Tier 4: AU
  'solarchoice.net.au', 'solaronline.com.au', 'solargain.com.au',
  // Tier 5: Aggregators
  'energysage.com', 'pvxchange.com',
];

/**
 * Solar deal aggregator sites that track prices, comparisons, and deals
 */
export const SOLAR_DEAL_AGGREGATORS: string[] = [
  'energysage.com', 'pvxchange.com', 'solaris.com', 'slickdeals.net',
];

/**
 * Generate search queries for solar panel price crawling.
 * Produces ~15-20 queries per country targeting vendor pages, shopping intent,
 * wattage-specific searches, and deal/clearance pages.
 */
export function generateSolarSearchQueries(country: Country): string[] {
  const queries: string[] = [];
  const config = COUNTRY_CONFIG[country];
  const tld = config.domains[0]; // e.g. ".com", ".co.uk", ".de"

  // === 1. SITE-SPECIFIC: Top vendor domains ===
  const tier1Vendors = SOLAR_VENDORS.slice(0, 8); // Fetchable vendors
  for (let i = 0; i < tier1Vendors.length; i += 2) {
    const pair = tier1Vendors.slice(i, i + 2);
    const siteQuery = pair.map(v => `site:${v}`).join(' OR ');
    queries.push(`"solar panel" (${siteQuery})`);
  }

  // === 2. SHOPPING INTENT (product pages only) ===
  queries.push(`solar panel "add to cart" -blog -article -guide -review -reddit`);
  queries.push(`solar panel "in stock" buy -review -blog -reddit -cost-guide`);
  queries.push(`solar panel shop online "add to cart" -best -review`);

  // === 3. WATTAGE-SPECIFIC PRODUCT QUERIES ===
  queries.push(`400W solar panel "add to cart" buy`);
  queries.push(`500W monocrystalline solar panel buy -review`);
  queries.push(`200W portable solar panel buy "add to cart"`);
  queries.push(`600W bifacial solar panel buy shop`);
  queries.push(`300W solar panel buy online -blog -review`);

  // === 4. COUNTRY-SPECIFIC TLD ===
  if (country !== 'US') {
    queries.push(`solar panel buy site:*${tld} -blog -review`);
    queries.push(`solar panel shop ${config.searchSuffix} "add to cart"`);
  }

  // === 5. SPECIFIC PRODUCT PAGE QUERIES ===
  queries.push(`solar panel /product/ OR /shop/ buy`);
  queries.push(`solar panel watt price "add to cart" -guide -article`);

  // === 6. DEAL / DISCOUNT / CLEARANCE ===
  queries.push(`solar panel deal clearance "add to cart" -blog`);
  queries.push(`solar panel sale "free shipping" buy`);

  // === 7. AGGREGATOR/DEAL SITES ===
  const aggSiteQuery = SOLAR_DEAL_AGGREGATORS.slice(0, 3).map(s => `site:${s}`).join(' OR ');
  queries.push(`solar panel price (${aggSiteQuery})`);

  // === 8. BRAND-SPECIFIC PRODUCT PAGES ===
  queries.push(`Renogy solar panel buy "add to cart"`);
  queries.push(`LONGi solar panel buy shop`);
  queries.push(`Canadian Solar panel buy online`);
  queries.push(`Trina solar panel buy shop`);

  return queries;
}

/**
 * Extract wattage from text.
 * Handles: "400W", "400 W", "400w", "400 Watt", "400 Watts", "400-Watt",
 * "0.4kW", "0.4 kW" (converts to W).
 * Returns the number in watts or null.
 */
export function parseSolarWattage(text: string): number | null {
  if (!text) return null;

  // Try kW first (e.g. "0.4kW", "0.4 kW", "1.2kw")
  const kwMatch = text.match(/(\d+(?:\.\d+)?)\s*kw/i);
  if (kwMatch) {
    const kw = parseFloat(kwMatch[1]);
    if (!isNaN(kw) && kw > 0 && kw < 100) {
      return Math.round(kw * 1000);
    }
  }

  // Try W patterns (e.g. "400W", "400 W", "400w", "400 Watt", "400 Watts", "400-Watt")
  const wMatch = text.match(/(\d+(?:\.\d+)?)\s*[-]?\s*(?:watt(?:s)?|w)\b/i);
  if (wMatch) {
    const w = parseFloat(wMatch[1]);
    if (!isNaN(w) && w > 0 && w < 100000) {
      return Math.round(w);
    }
  }

  return null;
}

/**
 * Detect solar panel type from text.
 * Keywords: mono/monocrystalline, poly/polycrystalline, thin-film/thin film/amorphous, bifacial.
 * Defaults to 'unknown'.
 */
export function parseSolarPanelType(text: string): SolarPanelType {
  if (!text) return 'unknown';
  const lower = text.toLowerCase();

  if (/bifacial/i.test(lower)) return 'bifacial';
  if (/mono(?:crystalline)?/i.test(lower)) return 'monocrystalline';
  if (/poly(?:crystalline)?/i.test(lower)) return 'polycrystalline';
  if (/thin[\s-]?film|amorphous/i.test(lower)) return 'thin-film';

  return 'unknown';
}

/**
 * Extract efficiency percentage from text.
 * Handles: "22.8%", "22.8% efficiency", "efficiency: 22.8%", "22.8 percent".
 * Must be between 5% and 50% to be valid.
 * Returns the number or null.
 */
export function parseSolarEfficiency(text: string): number | null {
  if (!text) return null;

  // Pattern: efficiency followed by number%, or number% followed by efficiency
  const patterns = [
    /efficiency\s*[:=]?\s*(\d+(?:\.\d+)?)\s*%/i,
    /(\d+(?:\.\d+)?)\s*%\s*efficiency/i,
    /(\d+(?:\.\d+)?)\s*percent\s*efficiency/i,
    /efficiency\s*[:=]?\s*(\d+(?:\.\d+)?)\s*percent/i,
    // Generic percentage (less reliable, checked last)
    /(\d+(?:\.\d+)?)\s*%/,
    /(\d+(?:\.\d+)?)\s+percent/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const value = parseFloat(match[1]);
      if (!isNaN(value) && value >= 5 && value <= 50) {
        return value;
      }
    }
  }

  return null;
}

/**
 * Extract panel dimensions from text.
 * Handles: "1722 x 1134 x 30 mm", "67.7 x 44.6 x 1.18 in" (converts inches to mm).
 * Returns null if not found.
 */
export function parseSolarDimensions(text: string): {
  lengthMm: number | null;
  widthMm: number | null;
  depthMm: number | null;
} | null {
  if (!text) return null;

  // Pattern: L x W x D mm (3 dimensions)
  const mmMatch3 = text.match(
    /(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*mm/i
  );
  if (mmMatch3) {
    return {
      lengthMm: parseFloat(mmMatch3[1]),
      widthMm: parseFloat(mmMatch3[2]),
      depthMm: parseFloat(mmMatch3[3]),
    };
  }

  // Pattern: L x W x D in/inches (3 dimensions, convert to mm)
  const inMatch3 = text.match(
    /(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(?:in(?:ch(?:es)?)?|")\b/i
  );
  if (inMatch3) {
    const toMm = (inches: number) => Math.round(inches * 25.4 * 10) / 10;
    return {
      lengthMm: toMm(parseFloat(inMatch3[1])),
      widthMm: toMm(parseFloat(inMatch3[2])),
      depthMm: toMm(parseFloat(inMatch3[3])),
    };
  }

  // Pattern: L x W mm (2 dimensions, no depth)
  const mmMatch2 = text.match(
    /(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*mm/i
  );
  if (mmMatch2) {
    return {
      lengthMm: parseFloat(mmMatch2[1]),
      widthMm: parseFloat(mmMatch2[2]),
      depthMm: null,
    };
  }

  // Pattern: L x W in/inches (2 dimensions, convert to mm)
  const inMatch2 = text.match(
    /(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(?:in(?:ch(?:es)?)?|")\b/i
  );
  if (inMatch2) {
    const toMm = (inches: number) => Math.round(inches * 25.4 * 10) / 10;
    return {
      lengthMm: toMm(parseFloat(inMatch2[1])),
      widthMm: toMm(parseFloat(inMatch2[2])),
      depthMm: null,
    };
  }

  return null;
}

/**
 * Extract weight in kg from text.
 * Handles: "21.5 kg", "47.4 lbs" (converts to kg), "21.5kg".
 * Returns null if not found.
 */
export function parseSolarWeight(text: string): number | null {
  if (!text) return null;

  // kg pattern
  const kgMatch = text.match(/(\d+(?:\.\d+)?)\s*kg/i);
  if (kgMatch) {
    const value = parseFloat(kgMatch[1]);
    if (!isNaN(value) && value > 0 && value < 500) {
      return value;
    }
  }

  // lbs pattern (convert to kg)
  const lbsMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:lbs?|pounds?)/i);
  if (lbsMatch) {
    const lbs = parseFloat(lbsMatch[1]);
    if (!isNaN(lbs) && lbs > 0 && lbs < 1000) {
      return Math.round(lbs * 0.453592 * 100) / 100;
    }
  }

  return null;
}
