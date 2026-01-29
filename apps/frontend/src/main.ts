/**
 * Supplement Deal Finder - Frontend
 *
 * A calm, minimal interface for searching supplement prices.
 * Communicates with the Bun backend for search functionality.
 */

// Types
interface ProductResult {
  title: string;
  price: number;
  currency: string;
  quantity: number;
  unit: string;
  price_per_unit: number;
  vendor: string;
  url: string;
  confidence: number;
}

interface SearchResponse {
  query: string;
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

// Saved products elements
const savedSidebar = document.getElementById('saved-sidebar') as HTMLElement;
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

/**
 * Format currency value
 */
function formatCurrency(value: number | null | undefined, currency: string): string {
  if (value == null || isNaN(value)) {
    return '—';
  }
  const symbols: Record<string, string> = {
    USD: '$',
    EUR: '€',
    GBP: '£',
    INR: '₹',
    JPY: '¥',
    AUD: 'A$',
    CAD: 'C$',
  };
  const symbol = symbols[currency] || currency + ' ';
  return `${symbol}${value.toFixed(2)}`;
}

/**
 * Format price per unit
 */
function formatPricePerUnit(value: number | null | undefined, unit: string): string {
  if (value == null || isNaN(value)) {
    return `—/${unit}`;
  }
  // For very small values (per gram), show more decimals
  if (value < 0.01) {
    return `${value.toFixed(4)}/${unit}`;
  }
  return `${value.toFixed(2)}/${unit}`;
}

/**
 * Format quantity with unit
 */
function formatQuantity(quantity: number | null | undefined, unit: string): string {
  if (quantity == null || isNaN(quantity)) {
    return '—';
  }
  return `${quantity} ${unit}`;
}

/**
 * Truncate text to max length
 */
function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}

/**
 * Create best deal card HTML
 */
function createBestDealCard(product: ProductResult): string {
  const isSaved = isProductSaved(product);
  return `
    <article class="best-deal-card">
      <header class="best-deal-header">
        <span class="best-deal-badge">Best Value</span>
        <button class="save-button ${isSaved ? 'saved' : ''}" data-url="${product.url}" data-product='${JSON.stringify(product).replace(/'/g, "&#39;")}'>${isSaved ? 'Saved' : 'Save'}</button>
      </header>
      <h2 class="best-deal-title">${truncate(product.title, 100)}</h2>
      <div class="best-deal-price-row">
        <span class="best-deal-price">${formatCurrency(product.price, product.currency)}</span>
        <span class="best-deal-per-unit">${formatPricePerUnit(product.price_per_unit, product.unit)}</span>
      </div>
      <div class="best-deal-meta">
        <span class="best-deal-quantity">${formatQuantity(product.quantity, product.unit)}</span>
        <span class="best-deal-vendor">${product.vendor}</span>
        <a href="${product.url}" target="_blank" rel="noopener noreferrer" class="best-deal-link">View Product</a>
      </div>
    </article>
  `;
}

/**
 * Create result card HTML
 */
function createResultCard(product: ProductResult): string {
  const isSaved = isProductSaved(product);
  return `
    <article class="result-card">
      <h3 class="result-title">${truncate(product.title, 80)}</h3>
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

/**
 * Format elapsed time
 */
function formatElapsedTime(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

/**
 * Get stage icon
 */
function getStageIcon(stage: string): string {
  switch (stage) {
    case 'starting': return '...';
    case 'searching': return '...';
    case 'crawling': return '...';
    case 'extracting': return '...';
    case 'ranking': return '...';
    case 'complete': return '...';
    default: return '...';
  }
}

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

  // Best deal
  if (response.best_deal) {
    bestDealContainer.innerHTML = createBestDealCard(response.best_deal);
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
      body: JSON.stringify({ query }),
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
 * Initialize event listeners
 */
function init(): void {
  // Load saved products from localStorage
  loadSavedProducts();

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

  // Common searches - click to search
  const commonSearchesList = document.getElementById('common-searches-list');
  if (commonSearchesList) {
    commonSearchesList.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains('search-chip')) {
        const query = target.dataset.query;
        if (query) {
          searchInput.value = query;
          performSearch(query);
        }
      }
    });
  }

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
