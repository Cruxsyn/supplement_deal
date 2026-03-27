/**
 * Deep Deal Finder - Frontend
 *
 * A calm, minimal interface for searching product prices across categories.
 * Supports supplements, building products, and robotics parts.
 * Communicates with the Bun backend for search functionality.
 */

import { formatCurrency, formatPricePerUnit, formatQuantity, truncate, formatElapsedTime, getStageIcon } from './utils';

// Types
type ProductCategory = 'supplements' | 'building' | 'robotics' | 'solar';
type Country = 'US' | 'CA' | 'UK' | 'DE' | 'FR' | 'ES' | 'IT' | 'NL' | 'SE' | 'AU' | 'NZ' | 'IE' | 'JP' | 'SG';
type SearchDepth = 'quick' | 'normal' | 'deep' | 'exhaustive';
type BarcodeType = 'upc-a' | 'ean-13' | 'gtin-14' | 'sku' | 'mpn' | 'unknown';
type IdentifierSource = 'json-ld' | 'meta-tag' | 'microdata' | 'data-attribute' | 'text-pattern';

interface ShippingInfo {
  cost: number | null;
  freeThreshold?: number;
  isFree: boolean;
}

interface PromotionInfo {
  hasCoupon: boolean;
  couponCode?: string;
  couponDiscount?: string;
  subscribeDiscount?: string;
}

interface ProductIdentifier {
  type: BarcodeType;
  value: string;
  isValidCheckDigit: boolean;
  source: IdentifierSource;
}

interface QualityVerification {
  hasValidUpc: boolean;
  crossVendorMatches: number;
  verificationScore: number;
}

interface ProductResult {
  title: string;
  price: number;
  currency: string;
  quantity: number;
  unit: string;
  price_per_unit: number;
  price_per_unit_usd?: number;
  vendor: string;
  url: string;
  confidence: number;
  // UPC/barcode fields (optional)
  upc?: string;
  identifiers?: ProductIdentifier[];
  verification?: QualityVerification;
  // Enhanced fields (Phase 2)
  original_price?: number;
  discount_percent?: number;
  shipping?: ShippingInfo;
  promotion?: PromotionInfo;
  deal_score?: number;
}

interface SearchResponse {
  query: string;
  category: ProductCategory;
  countries: Country[];
  results: ProductResult[];
  best_deal: ProductResult | null;
  timestamp: string;
  search_time_ms: number;
}

interface SearchProgress {
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

// Solar Panel types
interface SolarPanelSpecs {
  wattage: number;
  panelType: string;
  efficiency: number | null;
  dimensions: { lengthMm: number | null; widthMm: number | null; depthMm: number | null } | null;
  weightKg: number | null;
  warranty: string | null;
  cellCount: number | null;
  brand: string | null;
  model: string | null;
}

interface SolarPanelResult {
  title: string;
  price: number;
  currency: string;
  priceUsd: number;
  pricePerWatt: number;
  pricePerWattUsd: number;
  specs: SolarPanelSpecs;
  vendor: string;
  url: string;
  country: string;
  shipping: { cost: number | null; isFree: boolean; freeThreshold?: number };
  stockStatus?: 'in-stock' | 'out-of-stock' | 'unknown';
  confidence: number;
  lastCrawled: string;
}

interface SolarLeaderboard {
  results: SolarPanelResult[];
  metadata: {
    totalCrawled: number;
    totalExtracted: number;
    totalAfterFiltering: number;
    crawlStarted: string;
    crawlCompleted: string;
    crawlDurationMs: number;
    countriesCrawled: string[];
    vendorsCrawled: string[];
    version: number;
  };
}

// API Configuration
const API_BASE = '/api';

// DOM Elements
const searchForm = document.getElementById('search-form') as HTMLFormElement;
const searchInput = document.getElementById('search-input') as HTMLInputElement;
const searchButton = document.getElementById('search-button') as HTMLButtonElement;
const loadingSection = document.getElementById('loading-section') as HTMLElement;
const progressStage = document.getElementById('progress-stage') as HTMLElement;
const progressMessage = document.getElementById('progress-message') as HTMLElement;
const progressDetail = document.getElementById('progress-detail') as HTMLElement;
const progressBar = document.getElementById('progress-bar') as HTMLElement;
const progressStats = document.getElementById('progress-stats') as HTMLElement;
const errorSection = document.getElementById('error-section') as HTMLElement;
const errorMessage = document.getElementById('error-message') as HTMLElement;
const retryButton = document.getElementById('retry-button') as HTMLButtonElement;
const resultsSection = document.getElementById('results-section') as HTMLElement;
const bestDealContainer = document.getElementById('best-deal-container') as HTMLElement;
const resultsContainer = document.getElementById('results-container') as HTMLElement;
const resultsMeta = document.getElementById('results-meta') as HTMLElement;

// State
let lastQuery = '';
let abortController: AbortController | null = null;
let savedProducts: ProductResult[] = [];
let currentCategory: ProductCategory = 'supplements';
let selectedCountries: Country[] = ['US'];
let selectedDepth: SearchDepth = 'normal';

// Solar state
let solarData: SolarLeaderboard | null = null;
let solarLoaded = false;
let solarPage = 0;
const SOLAR_PAGE_SIZE = 50;
let solarActiveCountries: string[] = [];
let currentFilteredSolarResults: SolarPanelResult[] = [];

// Category tab elements
const categoryTabs = document.getElementById('category-tabs') as HTMLElement;
const searchLabel = document.getElementById('search-label') as HTMLElement;
const searchHint = document.getElementById('search-hint') as HTMLElement;

// Country selector elements
const countryChips = document.getElementById('country-chips') as HTMLElement;

// Depth selector elements
const depthChips = document.getElementById('depth-chips') as HTMLElement;

// Common searches per category
const commonSearchesSupplements = document.getElementById('common-searches-supplements') as HTMLElement;
const commonSearchesBuilding = document.getElementById('common-searches-building') as HTMLElement;
const commonSearchesRobotics = document.getElementById('common-searches-robotics') as HTMLElement;

// Saved products elements
const savedCount = document.getElementById('saved-count') as HTMLElement;
const savedList = document.getElementById('saved-list') as HTMLElement;
const savedActions = document.getElementById('saved-actions') as HTMLElement;
const clearSavedButton = document.getElementById('clear-saved') as HTMLButtonElement;

// LocalStorage key
const SAVED_PRODUCTS_KEY = 'supplement-finder-saved';

/**
 * Load saved products from localStorage
 */
function loadSavedProducts(): void {
  try {
    const saved = localStorage.getItem(SAVED_PRODUCTS_KEY);
    if (saved) {
      savedProducts = JSON.parse(saved);
    }
  } catch {
    savedProducts = [];
  }
  renderSavedProducts();
}

/**
 * Save products to localStorage
 */
function saveSavedProducts(): void {
  try {
    localStorage.setItem(SAVED_PRODUCTS_KEY, JSON.stringify(savedProducts));
  } catch {
    console.error('Failed to save to localStorage');
  }
}

/**
 * Check if a product is saved
 */
function isProductSaved(product: ProductResult): boolean {
  return savedProducts.some((p) => p.url === product.url);
}

/**
 * Add a product to saved list
 */
function saveProduct(product: ProductResult): void {
  if (!isProductSaved(product)) {
    savedProducts.unshift(product); // Add to beginning
    saveSavedProducts();
    renderSavedProducts();
  }
}

/**
 * Remove a product from saved list
 */
function removeProduct(url: string): void {
  savedProducts = savedProducts.filter((p) => p.url !== url);
  saveSavedProducts();
  renderSavedProducts();
  // Update any save buttons in the results
  updateSaveButtons();
}

/**
 * Clear all saved products
 */
function clearAllSaved(): void {
  savedProducts = [];
  saveSavedProducts();
  renderSavedProducts();
  updateSaveButtons();
}

/**
 * Update save button states in results
 */
function updateSaveButtons(): void {
  const buttons = document.querySelectorAll('.save-button');
  buttons.forEach((button) => {
    const url = (button as HTMLElement).dataset.url;
    if (url && savedProducts.some((p) => p.url === url)) {
      button.classList.add('saved');
      button.textContent = 'Saved';
    } else {
      button.classList.remove('saved');
      button.textContent = 'Save';
    }
  });
}

/**
 * Render saved products sidebar
 */
function renderSavedProducts(): void {
  if (savedCount) {
    savedCount.textContent = String(savedProducts.length);
  }

  if (savedActions) {
    if (savedProducts.length > 0) {
      savedActions.classList.remove('hidden');
    } else {
      savedActions.classList.add('hidden');
    }
  }

  if (!savedList) return;

  if (savedProducts.length === 0) {
    savedList.innerHTML = `
      <p class="saved-empty">No saved products yet. Click the save button on any product to add it here.</p>
    `;
    return;
  }

  savedList.innerHTML = savedProducts.map((product) => `
    <div class="saved-item" data-url="${product.url}">
      <div class="saved-item-title">${truncate(product.title, 60)}</div>
      <div>
        <span class="saved-item-price">${formatCurrency(product.price, product.currency)}</span>
        <span class="saved-item-per-unit">${formatPricePerUnit(product.price_per_unit, product.unit)}</span>
      </div>
      <div class="saved-item-meta">
        <span>${product.vendor}</span>
        <span>${formatQuantity(product.quantity, product.unit)}</span>
      </div>
      <div class="saved-item-actions">
        <a href="${product.url}" target="_blank" rel="noopener noreferrer" class="saved-item-link">View</a>
        <button class="saved-item-remove" data-url="${product.url}">Remove</button>
      </div>
    </div>
  `).join('');
}

// formatCurrency, formatPricePerUnit, formatQuantity, truncate imported from ./utils

/**
 * Create best deal card HTML with savings badges
 */
function createBestDealCard(product: ProductResult, allResults: ProductResult[] = []): string {
  const isSaved = isProductSaved(product);
  const verificationBadge = product.verification?.hasValidUpc
    ? `<span class="verification-badge verified" title="UPC Verified">Verified</span>`
    : '';
  const crossVendorInfo = product.verification?.crossVendorMatches
    ? `<span class="cross-vendor-badge" title="Found at ${product.verification.crossVendorMatches + 1} vendors">${product.verification.crossVendorMatches + 1} vendors</span>`
    : '';
  const upcDisplay = product.upc
    ? `<span class="product-upc" title="UPC: ${product.upc}">UPC: ...${product.upc.slice(-4)}</span>`
    : '';

  // Savings badges (Phase 2 enhancements)
  let savingsBadge = '';
  if (allResults.length > 1) {
    const avgPrice = allResults.reduce((sum, r) => sum + r.price_per_unit, 0) / allResults.length;
    const savingsPercent = Math.round(((avgPrice - product.price_per_unit) / avgPrice) * 100);
    if (savingsPercent > 10) {
      savingsBadge = `<span class="savings-badge" title="${savingsPercent}% below average price">${savingsPercent}% below avg!</span>`;
    }
  }

  const shippingBadge = product.shipping?.isFree
    ? `<span class="shipping-badge free" title="Free shipping">Free Shipping</span>`
    : '';

  const couponBadge = product.promotion?.hasCoupon
    ? `<span class="coupon-badge" title="Coupon available: ${product.promotion.couponCode || 'Check site'}">Coupon Available</span>`
    : '';

  const discountBadge = product.discount_percent && product.discount_percent > 5
    ? `<span class="discount-badge" title="On sale - ${product.discount_percent}% off">${product.discount_percent}% OFF</span>`
    : '';

  // Original price display
  const originalPriceDisplay = product.original_price && product.original_price > product.price
    ? `<span class="original-price">${formatCurrency(product.original_price, product.currency)}</span>`
    : '';

  return `
    <article class="best-deal-card">
      <header class="best-deal-header">
        <span class="best-deal-badge">Best Value</span>
        ${savingsBadge}
        ${discountBadge}
        ${shippingBadge}
        ${couponBadge}
        ${verificationBadge}
        ${crossVendorInfo}
        <button class="save-button ${isSaved ? 'saved' : ''}" data-url="${product.url}" data-product='${JSON.stringify(product).replace(/'/g, "&#39;")}'>${isSaved ? 'Saved' : 'Save'}</button>
      </header>
      <h2 class="best-deal-title">${truncate(product.title, 100)}</h2>
      <div class="best-deal-price-row">
        ${originalPriceDisplay}
        <span class="best-deal-price">${formatCurrency(product.price, product.currency)}</span>
        <span class="best-deal-per-unit">${formatPricePerUnit(product.price_per_unit, product.unit)}</span>
      </div>
      <div class="best-deal-meta">
        <span class="best-deal-quantity">${formatQuantity(product.quantity, product.unit)}</span>
        <span class="best-deal-vendor">${product.vendor}</span>
        ${upcDisplay}
        <a href="${product.url}" target="_blank" rel="noopener noreferrer" class="best-deal-link">View Product</a>
      </div>
    </article>
  `;
}

/**
 * Create result card HTML with savings indicators
 */
function createResultCard(product: ProductResult): string {
  const isSaved = isProductSaved(product);
  const verificationBadge = product.verification?.hasValidUpc
    ? `<span class="verification-badge verified" title="UPC Verified">Verified</span>`
    : '';
  const crossVendorInfo = product.verification?.crossVendorMatches
    ? `<span class="cross-vendor-badge" title="Found at ${product.verification.crossVendorMatches + 1} vendors">${product.verification.crossVendorMatches + 1} vendors</span>`
    : '';

  // Compact badges for result cards
  const shippingBadge = product.shipping?.isFree
    ? `<span class="shipping-badge-small free" title="Free shipping">Free Ship</span>`
    : '';
  const couponBadge = product.promotion?.hasCoupon
    ? `<span class="coupon-badge-small" title="Coupon available">Coupon</span>`
    : '';
  const discountBadge = product.discount_percent && product.discount_percent > 5
    ? `<span class="discount-badge-small">${product.discount_percent}% OFF</span>`
    : '';

  return `
    <article class="result-card">
      <div class="result-header">
        <h3 class="result-title">${truncate(product.title, 80)}</h3>
        ${discountBadge}
        ${shippingBadge}
        ${couponBadge}
        ${verificationBadge}
        ${crossVendorInfo}
      </div>
      <div class="result-price-row">
        <span class="result-price">${formatCurrency(product.price, product.currency)}</span>
        <span class="result-per-unit">${formatPricePerUnit(product.price_per_unit, product.unit)}</span>
      </div>
      <div class="result-meta">
        <span class="result-quantity">${formatQuantity(product.quantity, product.unit)}</span>
        <span class="result-vendor">${product.vendor}</span>
        <button class="save-button ${isSaved ? 'saved' : ''}" data-url="${product.url}" data-product='${JSON.stringify(product).replace(/'/g, "&#39;")}'>${isSaved ? 'Saved' : 'Save'}</button>
        <a href="${product.url}" target="_blank" rel="noopener noreferrer" class="result-link">View</a>
      </div>
    </article>
  `;
}

// formatElapsedTime, getStageIcon imported from ./utils

/**
 * Show loading state with progress
 */
function showLoading(): void {
  loadingSection.classList.remove('hidden');
  errorSection.classList.add('hidden');
  resultsSection.classList.add('hidden');
  searchButton.disabled = true;
  searchButton.textContent = 'Searching...';

  // Reset progress display
  if (progressStage) progressStage.textContent = 'Initializing...';
  if (progressMessage) progressMessage.textContent = 'Starting deep search...';
  if (progressDetail) progressDetail.textContent = '';
  if (progressBar) progressBar.style.width = '0%';
  if (progressStats) progressStats.innerHTML = '';
}

/**
 * Update progress display
 */
function updateProgress(progress: SearchProgress): void {
  if (progressStage) {
    const stageNames: Record<string, string> = {
      starting: 'Initializing',
      searching: 'Searching Web',
      crawling: 'Crawling Pages',
      extracting: 'Extracting Data',
      ranking: 'Ranking Results',
      complete: 'Complete',
    };
    progressStage.textContent = `${getStageIcon(progress.stage)} ${stageNames[progress.stage] || progress.stage}`;
  }

  if (progressMessage) {
    progressMessage.textContent = progress.message;
  }

  if (progressDetail && progress.detail) {
    progressDetail.textContent = progress.detail;
  }

  // Calculate and update progress bar
  if (progressBar) {
    let percent = 0;
    switch (progress.stage) {
      case 'starting':
        percent = 2;
        break;
      case 'searching':
        if (progress.searchEnginesQueried && progress.totalSearchEngines) {
          percent = 5 + (progress.searchEnginesQueried / progress.totalSearchEngines) * 35;
        } else {
          percent = 10;
        }
        break;
      case 'crawling':
        if (progress.urlsCrawled !== undefined && progress.totalUrlsToCrawl) {
          percent = 40 + (progress.urlsCrawled / progress.totalUrlsToCrawl) * 40;
        } else {
          percent = 50;
        }
        break;
      case 'extracting':
        percent = 85;
        break;
      case 'ranking':
        percent = 95;
        break;
      case 'complete':
        percent = 100;
        break;
    }
    progressBar.style.width = `${percent}%`;
  }

  // Update stats display
  if (progressStats) {
    const stats: string[] = [];

    if (progress.elapsedMs !== undefined) {
      stats.push(`Time: ${formatElapsedTime(progress.elapsedMs)}`);
    }
    if (progress.urlsFound !== undefined) {
      stats.push(`URLs found: ${progress.urlsFound}`);
    }
    if (progress.urlsCrawled !== undefined && progress.totalUrlsToCrawl !== undefined) {
      stats.push(`Pages crawled: ${progress.urlsCrawled}/${progress.totalUrlsToCrawl}`);
    }
    if (progress.productsExtracted !== undefined) {
      stats.push(`Products found: ${progress.productsExtracted}`);
    }
    if (progress.resultsCount !== undefined) {
      stats.push(`Final results: ${progress.resultsCount}`);
    }

    progressStats.innerHTML = stats.map(s => `<span class="stat-item">${s}</span>`).join('');
  }
}

/**
 * Hide loading state
 */
function hideLoading(): void {
  loadingSection.classList.add('hidden');
  searchButton.disabled = false;
  searchButton.textContent = 'Search';
}

/**
 * Show error state
 */
function showError(message: string): void {
  hideLoading();
  errorSection.classList.remove('hidden');
  resultsSection.classList.add('hidden');
  errorMessage.textContent = message;
}

/**
 * Show results
 */
function showResults(response: SearchResponse): void {
  hideLoading();
  errorSection.classList.add('hidden');
  resultsSection.classList.remove('hidden');

  // Best deal (pass all results for savings calculation)
  if (response.best_deal) {
    bestDealContainer.innerHTML = createBestDealCard(response.best_deal, response.results);
  } else {
    bestDealContainer.innerHTML = '';
  }

  // Other results (exclude best deal)
  const otherResults = response.results.filter(
    (r) => !response.best_deal || r.url !== response.best_deal.url
  );

  if (otherResults.length > 0) {
    resultsContainer.innerHTML = `
      <h2 class="results-heading">Other Results</h2>
      <div class="results-list">
        ${otherResults.map(createResultCard).join('')}
      </div>
    `;
  } else {
    resultsContainer.innerHTML = '';
  }

  // Meta information
  const resultCount = response.results.length;
  const timeSeconds = (response.search_time_ms / 1000).toFixed(1);
  resultsMeta.textContent = `Found ${resultCount} result${resultCount !== 1 ? 's' : ''} in ${timeSeconds}s`;
}

/**
 * Show empty results
 */
function showEmpty(query: string): void {
  hideLoading();
  errorSection.classList.add('hidden');
  resultsSection.classList.remove('hidden');
  bestDealContainer.innerHTML = '';
  resultsContainer.innerHTML = `
    <div class="empty-results">
      <p>No results found for "${query}"</p>
      <p>Try a different search term or include more details like quantity.</p>
    </div>
  `;
  resultsMeta.textContent = '';
}

/**
 * Perform streaming search with progress updates
 */
async function performSearch(query: string): Promise<void> {
  lastQuery = query;
  showLoading();

  // Abort any existing search
  if (abortController) {
    abortController.abort();
  }
  abortController = new AbortController();

  try {
    const response = await fetch(`${API_BASE}/search/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query,
        category: currentCategory,
        countries: selectedCountries,
        depth: selectedDepth,
      }),
      signal: abortController.signal,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Search failed (${response.status})`);
    }

    // Read the SSE stream
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response stream');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Parse SSE events from buffer
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer

      let eventType = '';
      let eventData = '';

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          eventType = line.slice(7);
        } else if (line.startsWith('data: ')) {
          eventData = line.slice(6);

          if (eventType && eventData) {
            try {
              const data = JSON.parse(eventData);

              if (eventType === 'progress') {
                updateProgress(data as SearchProgress);
              } else if (eventType === 'complete') {
                const searchResponse = data as SearchResponse;
                if (searchResponse.results.length === 0) {
                  showEmpty(query);
                } else {
                  showResults(searchResponse);
                }
              } else if (eventType === 'error') {
                throw new Error(data.message || 'Search failed');
              }
            } catch (parseError) {
              console.error('Failed to parse SSE data:', parseError);
            }
          }

          eventType = '';
          eventData = '';
        }
      }
    }
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      console.log('Search aborted');
      return;
    }
    console.error('Search error:', error);
    const message =
      error instanceof Error
        ? error.message
        : 'Search failed. Please try again.';
    showError(message);
  } finally {
    abortController = null;
  }
}

/**
 * Category-specific UI configuration
 */
const categoryConfig: Record<ProductCategory, {
  label: string;
  placeholder: string;
  hint: string;
}> = {
  supplements: {
    label: 'What supplement are you looking for?',
    placeholder: 'e.g., Creatine Monohydrate 500g',
    hint: 'Enter a supplement name with quantity for best results',
  },
  building: {
    label: 'What building product are you looking for?',
    placeholder: 'e.g., Festool TS 55 Track Saw',
    hint: 'Enter a tool, material, or hardware product name',
  },
  robotics: {
    label: 'What robotics part are you looking for?',
    placeholder: 'e.g., NEMA 17 Stepper Motor',
    hint: 'Enter a sensor, motor, controller, or component name',
  },
  solar: {
    label: '',
    placeholder: '',
    hint: '',
  },
};

/**
 * Update UI for selected category
 */
function updateCategoryUI(category: ProductCategory): void {
  const solarSection = document.getElementById('solar-section');
  const searchSection = document.querySelector('.search-section') as HTMLElement | null;

  // Update tab buttons
  const tabButtons = categoryTabs?.querySelectorAll('.tab-button');
  tabButtons?.forEach((btn) => {
    const btnCategory = (btn as HTMLElement).dataset.category;
    btn.classList.toggle('active', btnCategory === category);
  });

  if (category === 'solar') {
    // Hide search-related UI
    searchSection?.classList.add('hidden');
    loadingSection.classList.add('hidden');
    errorSection.classList.add('hidden');
    resultsSection.classList.add('hidden');
    // Show solar section
    solarSection?.classList.remove('hidden');
    // Load data if not already loaded
    loadSolarLeaderboard();
    return;
  }

  // Switching away from solar: show search UI, hide solar section
  searchSection?.classList.remove('hidden');
  solarSection?.classList.add('hidden');

  const config = categoryConfig[category];

  // Update search form
  if (searchLabel) searchLabel.textContent = config.label;
  if (searchInput) searchInput.placeholder = config.placeholder;
  if (searchHint) searchHint.textContent = config.hint;

  // Show/hide common searches
  if (commonSearchesSupplements) {
    commonSearchesSupplements.classList.toggle('hidden', category !== 'supplements');
  }
  if (commonSearchesBuilding) {
    commonSearchesBuilding.classList.toggle('hidden', category !== 'building');
  }
  if (commonSearchesRobotics) {
    commonSearchesRobotics.classList.toggle('hidden', category !== 'robotics');
  }

  // Clear search input when switching categories
  if (searchInput) searchInput.value = '';

  // Hide results when switching
  resultsSection.classList.add('hidden');
  errorSection.classList.add('hidden');
}

/**
 * Load solar leaderboard data from the API
 */
async function loadSolarLeaderboard(): Promise<void> {
  if (solarLoaded && solarData) {
    renderSolarLeaderboard();
    return;
  }

  const loadingEl = document.getElementById('solar-loading');
  const emptyEl = document.getElementById('solar-empty');
  const tableWrapper = document.getElementById('solar-table-wrapper');

  loadingEl?.classList.remove('hidden');
  emptyEl?.classList.add('hidden');
  tableWrapper?.classList.add('hidden');

  try {
    // Try API first (dev), fall back to static JSON (Cloudflare Pages)
    let response = await fetch('/api/solar/leaderboard').catch(() => null);
    if (!response || !response.ok) {
      response = await fetch('/solar-leaderboard.json');
    }
    if (!response.ok) {
      throw new Error('Leaderboard not available');
    }
    const data = await response.json() as SolarLeaderboard;
    solarData = data;
    solarLoaded = true;
    // Initialize country filter from available data
    const countries = Array.from(new Set(data.results.map((r) => r.country))).sort();
    solarActiveCountries = [...countries];
    populateSolarCountryChips(countries);
    renderSolarLeaderboard();
  } catch {
    loadingEl?.classList.add('hidden');
    emptyEl?.classList.remove('hidden');
  }
}

/**
 * Populate solar country filter chips from available data
 */
function populateSolarCountryChips(countries: string[]): void {
  const container = document.getElementById('solar-country-filter');
  if (!container) return;

  container.innerHTML = countries.map((country) => `
    <button type="button" class="solar-country-chip active" data-country="${country}">${country}</button>
  `).join('');

  container.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target.classList.contains('solar-country-chip')) {
      const country = target.dataset.country;
      if (!country) return;
      if (solarActiveCountries.includes(country)) {
        // Keep at least one country selected
        if (solarActiveCountries.length > 1) {
          solarActiveCountries = solarActiveCountries.filter((c) => c !== country);
          target.classList.remove('active');
        }
      } else {
        solarActiveCountries.push(country);
        target.classList.add('active');
      }
      solarPage = 0;
      renderSolarLeaderboard();
    }
  });
}

/**
 * Apply filters and sort to solar data, then render the table
 */
function renderSolarLeaderboard(): void {
  if (!solarData) return;

  const loadingEl = document.getElementById('solar-loading');
  const emptyEl = document.getElementById('solar-empty');
  const tableWrapper = document.getElementById('solar-table-wrapper');
  const tbody = document.getElementById('solar-tbody');
  const metaEl = document.getElementById('solar-meta');

  const typeFilter = (document.getElementById('solar-type-filter') as HTMLSelectElement)?.value ?? 'all';
  const minWatt = parseFloat((document.getElementById('solar-min-watt') as HTMLInputElement)?.value ?? '');
  const maxWatt = parseFloat((document.getElementById('solar-max-watt') as HTMLInputElement)?.value ?? '');
  const stockFilter = (document.getElementById('solar-stock-filter') as HTMLSelectElement)?.value ?? 'all';
  const sortBy = (document.getElementById('solar-sort') as HTMLSelectElement)?.value ?? 'pricePerWatt';

  let filtered = solarData.results.filter((r) => {
    if (solarActiveCountries.length > 0 && !solarActiveCountries.includes(r.country)) return false;
    if (typeFilter !== 'all' && r.specs.panelType !== typeFilter) return false;
    if (!isNaN(minWatt) && r.specs.wattage < minWatt) return false;
    if (!isNaN(maxWatt) && r.specs.wattage > maxWatt) return false;
    if (stockFilter === 'in-stock' && r.stockStatus !== 'in-stock') return false;
    if (stockFilter === 'out-of-stock' && r.stockStatus !== 'out-of-stock') return false;
    return true;
  });

  filtered.sort((a, b) => {
    switch (sortBy) {
      case 'pricePerWatt':
        return a.pricePerWattUsd - b.pricePerWattUsd;
      case 'price':
        return a.priceUsd - b.priceUsd;
      case 'wattage':
        return b.specs.wattage - a.specs.wattage;
      case 'efficiency':
        return (b.specs.efficiency ?? 0) - (a.specs.efficiency ?? 0);
      default:
        return a.pricePerWattUsd - b.pricePerWattUsd;
    }
  });

  loadingEl?.classList.add('hidden');

  if (filtered.length === 0) {
    tableWrapper?.classList.add('hidden');
    emptyEl?.classList.remove('hidden');
    renderSolarPagination(0);
    return;
  }

  emptyEl?.classList.add('hidden');
  tableWrapper?.classList.remove('hidden');

  const start = solarPage * SOLAR_PAGE_SIZE;
  const pageItems = filtered.slice(start, start + SOLAR_PAGE_SIZE);

  // Store for detail panel access (page-relative indices)
  currentFilteredSolarResults = pageItems;

  if (tbody) {
    tbody.innerHTML = pageItems.map((result, idx) => createSolarRow(result, start + idx + 1, idx)).join('');
  }

  // Update metadata
  if (metaEl && solarData.metadata) {
    const m = solarData.metadata;
    const crawledDate = new Date(m.crawlCompleted).toLocaleDateString();
    metaEl.textContent = `${filtered.length} results — last updated ${crawledDate} — ${m.totalCrawled} pages crawled`;
  }

  renderSolarPagination(filtered.length);
}

/**
 * Create a solar table row HTML string
 */
function createSolarRow(result: SolarPanelResult, rank: number, index: number): string {
  const currencySymbol = result.currency === 'USD' ? '$' : result.currency === 'EUR' ? '€' : result.currency === 'GBP' ? '£' : result.currency === 'AUD' ? 'A$' : '$';
  const ppw = result.pricePerWattUsd.toFixed(3);
  const typeLabel = result.specs.panelType === 'unknown' ? '-' : result.specs.panelType.charAt(0).toUpperCase() + result.specs.panelType.slice(1, 4);
  const eff = result.specs.efficiency ? result.specs.efficiency.toFixed(1) + '%' : '-';
  const brand = result.specs.brand || '-';
  const isTop10 = rank <= 10;
  let stockBadge: string;
  if (result.stockStatus === 'in-stock') {
    stockBadge = `<span class="stock-badge stock-in">In Stock</span>`;
  } else if (result.stockStatus === 'out-of-stock') {
    stockBadge = `<span class="stock-badge stock-out">Out</span>`;
  } else {
    stockBadge = `<span class="stock-badge stock-unknown">?</span>`;
  }

  return `<tr class="solar-row ${isTop10 ? 'solar-top10' : ''}" data-index="${index}" style="cursor: pointer">
    <td class="solar-col-rank">${rank}</td>
    <td class="solar-col-ppw"><strong>$${ppw}</strong></td>
    <td class="solar-col-price">${currencySymbol}${result.price.toFixed(2)}</td>
    <td class="solar-col-watt">${result.specs.wattage}W</td>
    <td class="solar-col-type"><span class="solar-type-badge solar-type-${result.specs.panelType}">${typeLabel}</span></td>
    <td class="solar-col-eff">${eff}</td>
    <td class="solar-col-brand">${brand}</td>
    <td class="solar-col-vendor">${result.vendor}</td>
    <td class="solar-col-country">${result.country}</td>
    <td class="solar-col-ship">${stockBadge}</td>
    <td class="solar-col-link"><a href="${result.url}" target="_blank" rel="noopener">View</a></td>
  </tr>`;
}

/**
 * Build the HTML content for a solar detail panel
 */
function createSolarDetailContent(result: SolarPanelResult): string {
  const currencySymbol = result.currency === 'USD' ? '$' : result.currency === 'EUR' ? '€' : result.currency === 'GBP' ? '£' : result.currency === 'AUD' ? 'A$' : '$';
  const ppw = `$${result.pricePerWattUsd.toFixed(3)}`;
  const eff = result.specs.efficiency !== null ? `${result.specs.efficiency.toFixed(1)}%` : 'N/A';
  const dims = result.specs.dimensions
    ? `${result.specs.dimensions.lengthMm ?? '?'} x ${result.specs.dimensions.widthMm ?? '?'} x ${result.specs.dimensions.depthMm ?? '?'} mm`
    : 'N/A';
  const weight = result.specs.weightKg !== null ? `${result.specs.weightKg} kg` : 'N/A';
  const brand = result.specs.brand || 'N/A';
  const warranty = result.specs.warranty || 'N/A';
  const shipText = result.shipping.isFree ? 'Free shipping' : result.shipping.cost !== null ? `${currencySymbol}${result.shipping.cost.toFixed(2)}` : 'Unknown';
  let stockText: string;
  let stockColor: string;
  if (result.stockStatus === 'in-stock') {
    stockText = 'In Stock';
    stockColor = '#155724';
  } else if (result.stockStatus === 'out-of-stock') {
    stockText = 'Out of Stock';
    stockColor = '#721c24';
  } else {
    stockText = 'Stock Unknown';
    stockColor = 'var(--color-text-light)';
  }
  const confidence = Math.round(result.confidence * 100);
  const lastCrawled = new Date(result.lastCrawled).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

  return `
    <div class="solar-detail">
      <div class="solar-detail-grid">
        <div class="solar-detail-main">
          <h3 class="solar-detail-title">${result.title}</h3>
          <div class="solar-detail-price-block">
            <span class="solar-detail-price">${currencySymbol}${result.price.toFixed(2)}</span>
            <span class="solar-detail-ppw">${ppw} per watt</span>
          </div>
          <div class="solar-detail-vendor">
            Sold by <strong>${result.vendor}</strong> (${result.country})
          </div>
          <a href="${result.url}" target="_blank" rel="noopener" class="solar-detail-link">View Product Page &rarr;</a>
        </div>
        <div class="solar-detail-specs">
          <h4>Technical Specifications</h4>
          <table class="solar-spec-table">
            <tr><td>Wattage</td><td>${result.specs.wattage}W</td></tr>
            <tr><td>Panel Type</td><td>${result.specs.panelType.charAt(0).toUpperCase() + result.specs.panelType.slice(1)}</td></tr>
            <tr><td>Efficiency</td><td>${eff}</td></tr>
            <tr><td>Dimensions</td><td>${dims}</td></tr>
            <tr><td>Weight</td><td>${weight}</td></tr>
            <tr><td>Brand</td><td>${brand}</td></tr>
            <tr><td>Warranty</td><td>${warranty}</td></tr>
          </table>
        </div>
        <div class="solar-detail-shipping">
          <h4>Shipping</h4>
          <p>${shipText}</p>
          <p style="color: ${stockColor}; font-weight: 600; font-size: 0.85rem; margin-top: 4px;">${stockText}</p>
          <p class="solar-detail-confidence">Data confidence: ${confidence}%</p>
          <p class="solar-detail-crawled">Last checked: ${lastCrawled}</p>
        </div>
      </div>
    </div>
  `;
}

/**
 * Toggle the expandable detail panel for a solar row
 */
function toggleSolarDetail(index: number, rowElement: Element): void {
  const nextSibling = rowElement.nextElementSibling;
  const isAlreadyOpen = nextSibling && nextSibling.classList.contains('solar-detail-row');

  // Close any open detail panel first
  const tbody = document.getElementById('solar-tbody');
  const openDetail = tbody?.querySelector('tr.solar-detail-row');
  if (openDetail) {
    const associatedRow = openDetail.previousElementSibling as HTMLElement | null;
    if (associatedRow) associatedRow.classList.remove('expanded');
    openDetail.remove();
  }

  // If this row was already open, we are done (toggle closed)
  if (isAlreadyOpen) return;

  // Build and insert the detail row
  const result = currentFilteredSolarResults[index];
  if (!result) return;

  const detailTr = document.createElement('tr');
  detailTr.className = 'solar-detail-row';
  detailTr.innerHTML = `<td colspan="11">${createSolarDetailContent(result)}</td>`;

  rowElement.classList.add('expanded');
  rowElement.after(detailTr);
}

/**
 * Render solar pagination controls
 */
function renderSolarPagination(totalFiltered: number): void {
  const container = document.getElementById('solar-pagination');
  if (!container) return;

  const totalPages = Math.ceil(totalFiltered / SOLAR_PAGE_SIZE);

  if (totalPages <= 1) {
    container.innerHTML = '';
    return;
  }

  const currentPage = solarPage + 1;

  container.innerHTML = `
    <button class="solar-page-btn" id="solar-prev-btn" ${solarPage === 0 ? 'disabled' : ''}>Prev</button>
    <span class="solar-page-info">Page ${currentPage} of ${totalPages}</span>
    <button class="solar-page-btn" id="solar-next-btn" ${solarPage >= totalPages - 1 ? 'disabled' : ''}>Next</button>
  `;

  document.getElementById('solar-prev-btn')?.addEventListener('click', () => {
    if (solarPage > 0) {
      solarPage--;
      renderSolarLeaderboard();
    }
  });

  document.getElementById('solar-next-btn')?.addEventListener('click', () => {
    if (solarPage < totalPages - 1) {
      solarPage++;
      renderSolarLeaderboard();
    }
  });
}

/**
 * Update country selection UI
 */
function updateCountryUI(): void {
  const chips = countryChips?.querySelectorAll('.country-chip');
  chips?.forEach((chip) => {
    const country = (chip as HTMLElement).dataset.country as Country;
    chip.classList.toggle('active', selectedCountries.includes(country));
  });
}

/**
 * Update depth selection UI
 */
function updateDepthUI(): void {
  const chips = depthChips?.querySelectorAll('.depth-chip');
  chips?.forEach((chip) => {
    const depth = (chip as HTMLElement).dataset.depth as SearchDepth;
    chip.classList.toggle('active', depth === selectedDepth);
  });
}

/**
 * Initialize event listeners
 */
function init(): void {
  // Load saved products from localStorage
  loadSavedProducts();

  // Category tab switching
  if (categoryTabs) {
    categoryTabs.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const tabButton = target.closest('.tab-button') as HTMLElement;
      if (tabButton) {
        const category = tabButton.dataset.category as ProductCategory;
        if (category && category !== currentCategory) {
          currentCategory = category;
          updateCategoryUI(category);
        }
      }
    });
  }

  // Solar filter event listeners
  const solarTypeFilter = document.getElementById('solar-type-filter');
  const solarMinWatt = document.getElementById('solar-min-watt');
  const solarMaxWatt = document.getElementById('solar-max-watt');
  const solarStockFilter = document.getElementById('solar-stock-filter');
  const solarSort = document.getElementById('solar-sort');

  solarTypeFilter?.addEventListener('change', () => { solarPage = 0; renderSolarLeaderboard(); });
  solarMinWatt?.addEventListener('input', () => { solarPage = 0; renderSolarLeaderboard(); });
  solarMaxWatt?.addEventListener('input', () => { solarPage = 0; renderSolarLeaderboard(); });
  solarStockFilter?.addEventListener('change', () => { solarPage = 0; renderSolarLeaderboard(); });
  solarSort?.addEventListener('change', () => { solarPage = 0; renderSolarLeaderboard(); });

  // Solar row click-to-expand detail panel
  const solarTbody = document.getElementById('solar-tbody');
  solarTbody?.addEventListener('click', (e) => {
    const row = (e.target as HTMLElement).closest('tr.solar-row');
    if (!row) return;
    // Don't toggle when clicking the View link
    if ((e.target as HTMLElement).closest('a')) return;
    const index = parseInt(row.getAttribute('data-index') || '0');
    toggleSolarDetail(index, row);
  });

  // Country selection
  if (countryChips) {
    countryChips.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains('country-chip')) {
        const country = target.dataset.country as Country;
        if (country) {
          if (selectedCountries.includes(country)) {
            // Don't allow deselecting the last country
            if (selectedCountries.length > 1) {
              selectedCountries = selectedCountries.filter((c) => c !== country);
            }
          } else {
            selectedCountries.push(country);
          }
          updateCountryUI();
        }
      }
    });
  }

  // Depth selection
  if (depthChips) {
    depthChips.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains('depth-chip')) {
        const depth = target.dataset.depth as SearchDepth;
        if (depth && depth !== selectedDepth) {
          selectedDepth = depth;
          updateDepthUI();
        }
      }
    });
  }

  // Search form submission
  searchForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const query = searchInput.value.trim();
    if (query) {
      performSearch(query);
    }
  });

  // Retry button
  retryButton.addEventListener('click', () => {
    if (lastQuery) {
      performSearch(lastQuery);
    }
  });

  // Common searches - click to search (handle all category common searches)
  document.querySelectorAll('.common-searches-list').forEach((list) => {
    list.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains('search-chip')) {
        const query = target.dataset.query;
        if (query) {
          searchInput.value = query;
          performSearch(query);
        }
      }
    });
  });

  // Save button clicks (using event delegation on results section)
  resultsSection.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target.classList.contains('save-button')) {
      const productData = target.dataset.product;
      if (productData) {
        try {
          const product = JSON.parse(productData) as ProductResult;
          if (isProductSaved(product)) {
            removeProduct(product.url);
            target.classList.remove('saved');
            target.textContent = 'Save';
          } else {
            saveProduct(product);
            target.classList.add('saved');
            target.textContent = 'Saved';
          }
        } catch {
          console.error('Failed to parse product data');
        }
      }
    }
  });

  // Remove button clicks in saved sidebar
  if (savedList) {
    savedList.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains('saved-item-remove')) {
        const url = target.dataset.url;
        if (url) {
          removeProduct(url);
        }
      }
    });
  }

  // Clear all saved products
  if (clearSavedButton) {
    clearSavedButton.addEventListener('click', () => {
      if (confirm('Remove all saved products?')) {
        clearAllSaved();
      }
    });
  }

  // Focus search input on load
  searchInput.focus();
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
