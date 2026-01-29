// Shared utilities for Supplement Deal Finder

/**
 * Normalize quantity to grams for comparison
 * Returns null if conversion not possible
 */
export function normalizeToGrams(value: number, unit: string): number | null {
  const lowerUnit = unit.toLowerCase().trim();

  // Weight conversions to grams
  const conversions: Record<string, number> = {
    'g': 1,
    'gram': 1,
    'grams': 1,
    'kg': 1000,
    'kilogram': 1000,
    'kilograms': 1000,
    'mg': 0.001,
    'milligram': 0.001,
    'milligrams': 0.001,
    'lb': 453.592,
    'lbs': 453.592,
    'pound': 453.592,
    'pounds': 453.592,
    'oz': 28.3495,
    'ounce': 28.3495,
    'ounces': 28.3495,
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
    // "500g", "500 g", "500grams"
    /(\d+(?:\.\d+)?)\s*(g|gram|grams|kg|kilogram|kilograms|mg|milligram|milligrams|lb|lbs|pound|pounds|oz|ounce|ounces|ml|l|litre|liter)\b/i,
    // "500 capsules", "60 tablets", "30 servings"
    /(\d+(?:\.\d+)?)\s*(capsules?|tablets?|caps?|tabs?|softgels?|servings?|scoops?|doses?)/i,
    // Handle "x 500mg" format (like "120 x 500mg")
    /(\d+)\s*x\s*(\d+(?:\.\d+)?)\s*(mg|g)/i,
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
      if (unit === 'gram') unit = 'g';
      if (unit === 'grams') unit = 'g';
      if (unit === 'kilogram' || unit === 'kilograms') unit = 'kg';
      if (unit === 'milligram' || unit === 'milligrams') unit = 'mg';
      if (unit === 'pound' || unit === 'pounds') unit = 'lb';
      if (unit === 'ounce' || unit === 'ounces') unit = 'oz';
      if (unit === 'capsule' || unit === 'caps' || unit === 'cap') unit = 'capsules';
      if (unit === 'tablet' || unit === 'tabs' || unit === 'tab') unit = 'tablets';
      if (unit === 'softgel') unit = 'softgels';
      if (unit === 'serving' || unit === 'scoop' || unit === 'dose') unit = 'servings';
      if (unit === 'scoops' || unit === 'doses') unit = 'servings';
      if (unit === 'litre' || unit === 'liter') unit = 'l';

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
