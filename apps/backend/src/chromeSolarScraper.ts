/**
 * Chrome DevTools-based Solar Panel Scraper
 *
 * This script is designed to be run manually - it outputs a JSON file
 * with product data extracted by browsing vendor listing pages with
 * a real Chrome browser (bypasses Cloudflare).
 *
 * The data is fed into the solar leaderboard pipeline.
 *
 * Usage: bun run src/chromeSolarScraper.ts
 *
 * NOTE: This script collects URLs and basic data from listing pages.
 * It outputs a JSON file that the main solarCrawler can use to
 * populate the leaderboard.
 */

import type { SolarPanelResult, Country, ShippingInfo } from '../../../shared/types';
import { normalizeToUSD, detectCountryFromUrl, parseSolarWattage, parseSolarPanelType } from '../../../shared/utils';

// Vendor listing pages to scrape - each page shows 16-100 products
const VENDOR_PAGES = [
  // === US VENDORS ===
  // SanTan Solar (budget/used panels)
  'https://www.santansolar.com/product-category/solar-panels/',
  'https://www.santansolar.com/product-category/solar-panels/page/2/',
  'https://www.santansolar.com/product-category/solar-panels/page/3/',
  // Signature Solar
  'https://signaturesolar.com/solar-panels/',
  // Renogy
  'https://www.renogy.com/solar-panels/',
  'https://www.renogy.com/rigid-solar-panels/',
  'https://www.renogy.com/flexible-solar-panels/',
  'https://www.renogy.com/portable-solar-panels/',
  // Shop Solar Kits
  'https://shopsolarkits.com/collections/solar-panels',
  // Unbound Solar
  'https://unboundsolar.com/solar-panels',
  'https://unboundsolar.com/solar-panels/module',
  // Wholesale Solar
  'https://www.wholesalesolar.com/solar-panels',
  // SunWatts
  'https://sunwatts.com/solar-panels/',
  'https://sunwatts.com/400-watt-solar-panels/',
  'https://sunwatts.com/500-watt-solar-panels/',
  'https://sunwatts.com/600-watt-solar-panels/',
  // Goal Zero
  'https://www.goalzero.com/collections/solar-panels',
  // BougeRV
  'https://www.bougerv.com/collections/solar-panels',
  // Rich Solar
  'https://richsolar.com/collections/solar-panels',
  // HQST Solar
  'https://www.hqstsolar.com/collections/solar-panels',
  // Newpowa
  'https://www.newpowa.com/collections/solar-panels',
  // altE Store
  'https://www.altestore.com/store/solar-panels-c541/',
  // A1 Solar Store
  'https://a1solarstore.com/solar-panels.html',
  // Powered Portable Solar
  'https://poweredportablesolar.com/product-category/solar-panels/',
  // Buy Solar Online
  'https://buy-solar.online/installer-shop/solar-panels/',
  // ECO-WORTHY
  'https://www.eco-worthy.com/collections/solar-panels',
  // Grape Solar
  'https://grapesolar.com/collections/solar-panels',

  // === UK VENDORS ===
  'https://www.bimblesolal.com/solar-panels',
  'https://www.windandsun.co.uk/products/solar-panels',
  'https://www.midsummerenergy.co.uk/solar-panels',

  // === EU VENDORS ===
  'https://autosolar.es/paneles-solares',
  'https://www.alma-solarshop.de/solarmodule',
  'https://www.europe-solarstore.com/solar-panels.html',

  // === AU VENDORS ===
  'https://www.solaronline.com.au/solar-panels.html',
];

interface RawProduct {
  title: string;
  price: number;
  currency: string;
  url: string;
  wattage: number | null;
  panelType: string;
  isUsed: boolean;
  vendor: string;
  country: Country;
}

/**
 * The universal extraction script to be injected into each page via Chrome DevTools.
 * Returns structured product data from any e-commerce listing page.
 */
export const EXTRACTION_SCRIPT = `() => {
  const products = [];

  // Try multiple card selectors
  const cardSelectors = [
    'li.product', '.product-card', '[class*="product-item"]',
    '.grid-product', '.product-grid-item', '.collection-product',
    '.product-block', '.product-tile', '.product-cell',
    '[data-product-id]', '.grid__item', '.product-list-item',
  ];

  let cards = [];
  for (const sel of cardSelectors) {
    cards = document.querySelectorAll(sel);
    if (cards.length > 0) break;
  }

  // Fallback: look for repeating price+link patterns
  if (cards.length === 0) {
    cards = document.querySelectorAll('[class*="product"]');
  }

  cards.forEach(card => {
    const titleEl = card.querySelector(
      '.woocommerce-loop-product__title, h2.product-title, h3, h2, ' +
      '.product-name, [class*="title"], .product__title, .grid-product__title'
    );
    const priceEl = card.querySelector(
      '.price bdi, .price .amount, .price, [class*="price"], .amount, ' +
      '.product-price, .money, [data-price]'
    );
    const linkEl = card.querySelector('a[href*="product"], a[href*="shop"], a[href*="collect"], a');
    const classes = card.className || '';

    let title = titleEl?.textContent?.trim() || '';
    let priceText = priceEl?.textContent?.trim() || '';
    let url = linkEl?.href || '';

    // Extract wattage from title or CSS classes
    const wattText = title + ' ' + classes;
    const wattMatch = wattText.match(/(\\d+)\\s*[-]?\\s*(?:watt|w)\\b/i);
    const wattage = wattMatch ? parseInt(wattMatch[1]) : null;

    // Extract price - handle multiple currencies
    const priceMatch = priceText.match(/[\\$€£A-Z]*\\s*([\\d,]+\\.?\\d*)/);
    const price = priceMatch ? parseFloat(priceMatch[1].replace(',', '')) : null;
    const currency = priceText.includes('€') ? 'EUR' : priceText.includes('£') ? 'GBP' :
                     priceText.includes('A$') ? 'AUD' : 'USD';

    // Detect panel type
    let panelType = 'unknown';
    const text = (title + ' ' + classes).toLowerCase();
    if (text.includes('mono') && !text.includes('poly')) panelType = 'monocrystalline';
    else if (text.includes('poly')) panelType = 'polycrystalline';
    else if (text.includes('bifacial')) panelType = 'bifacial';
    else if (text.includes('thin') && text.includes('film')) panelType = 'thin-film';

    const isUsed = text.includes('used') || text.includes('refurbished') || text.includes('blemish');

    if (title && price && price > 5 && url) {
      products.push({ title, price, url, wattage, panelType, isUsed, currency });
    }
  });

  // Pagination
  const pages = document.querySelectorAll('.page-numbers a, .pagination a, .nav-links a, [class*="pagination"] a');
  const pageUrls = [...new Set([...pages].map(a => a.href).filter(h => h && h !== window.location.href))];

  return {
    products,
    count: products.length,
    vendor: window.location.hostname,
    currentUrl: window.location.href,
    nextPages: pageUrls.slice(0, 5),
  };
}`;

/**
 * Convert raw extracted products into SolarPanelResult format
 */
function toSolarResult(raw: RawProduct): SolarPanelResult | null {
  // Must have wattage for $/W calculation
  if (!raw.wattage || raw.wattage < 5 || raw.wattage > 1000) return null;
  if (!raw.price || raw.price <= 0) return null;

  const priceUsd = normalizeToUSD(raw.price, raw.currency);
  const pricePerWatt = raw.price / raw.wattage;
  const pricePerWattUsd = priceUsd / raw.wattage;

  // Reject unrealistic $/W
  if (pricePerWattUsd < 0.05 || pricePerWattUsd > 5.0) return null;

  // For pallet deals, calculate per-panel price
  const isPallet = /pallet|bundle|pack of|set of/i.test(raw.title);
  if (isPallet) return null; // Skip pallets - price is for multiple panels

  return {
    title: raw.title,
    price: raw.price,
    currency: raw.currency,
    priceUsd,
    pricePerWatt: Math.round(pricePerWatt * 1000) / 1000,
    pricePerWattUsd: Math.round(pricePerWattUsd * 1000) / 1000,
    specs: {
      wattage: raw.wattage,
      panelType: raw.panelType as any,
      efficiency: null,
      dimensions: null,
      weightKg: null,
      warranty: null,
      cellCount: null,
      brand: null,
      model: null,
    },
    vendor: raw.vendor,
    url: raw.url,
    country: raw.country,
    shipping: { cost: null, isFree: false },
    confidence: 0.7, // Chrome-extracted data is high confidence
    lastCrawled: new Date().toISOString(),
  };
}

// Export for use by the main pipeline
export { VENDOR_PAGES, toSolarResult };
export type { RawProduct };
