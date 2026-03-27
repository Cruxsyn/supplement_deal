/**
 * Stealth Fetch Module for Deep Deal Finder
 *
 * Implements anti-detection techniques inspired by apigen:
 * 1. Consistent browser profiles (UA + headers must match)
 * 2. Modern Chrome headers (sec-ch-ua, Sec-Fetch-*)
 * 3. Request randomization with natural timing
 * 4. Proxy support with rotation
 * 5. Cookie persistence per domain
 * 6. Playwright-based rendering for protected domains
 *
 * This module replaces the basic fetch() with a hardened version
 * that mimics real browser behavior.
 */

import { renderPage, renderPages, isPlaywrightAvailable } from './playwrightRenderer';

// ============================================================================
// RANDOMIZATION UTILITIES
// ============================================================================

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomChoice<T>(arr: T[]): T {
  return arr[randomInt(0, arr.length - 1)];
}

// Gaussian random for more natural distributions
function gaussianRandom(mean: number, stdDev: number): number {
  const u = 1 - Math.random();
  const v = Math.random();
  const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return z * stdDev + mean;
}

export function randomDelay(min: number, max: number): Promise<void> {
  // Use gaussian distribution centered between min and max
  const mean = (min + max) / 2;
  const stdDev = (max - min) / 4;
  const delay = Math.max(min, Math.min(max, Math.round(gaussianRandom(mean, stdDev))));
  return new Promise((resolve) => setTimeout(resolve, delay));
}

// ============================================================================
// BROWSER PROFILES - Realistic, consistent combinations
// ============================================================================

interface BrowserProfile {
  userAgent: string;
  platform: string;
  mobile: boolean;
  // sec-ch-ua header value
  secChUa: string;
  secChUaPlatform: string;
  // Accept-Language based on locale
  acceptLanguage: string;
  // Chrome version for header matching
  chromeVersion: string;
}

// Updated to Chrome 133/134 (current as of early 2026).
// Outdated versions are a strong bot signal since WAFs track browser release dates.
// The sec-ch-ua "Not A(Brand" token rotates each Chrome milestone.
const BROWSER_PROFILES: BrowserProfile[] = [
  // Windows Chrome 134 (current stable)
  {
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
    platform: 'Win32',
    mobile: false,
    secChUa: '"Chromium";v="134", "Google Chrome";v="134", "Not:A-Brand";v="24"',
    secChUaPlatform: '"Windows"',
    acceptLanguage: 'en-US,en;q=0.9',
    chromeVersion: '134',
  },
  // Windows Chrome 133
  {
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
    platform: 'Win32',
    mobile: false,
    secChUa: '"Not(A:Brand";v="99", "Google Chrome";v="133", "Chromium";v="133"',
    secChUaPlatform: '"Windows"',
    acceptLanguage: 'en-US,en;q=0.9',
    chromeVersion: '133',
  },
  // Mac Chrome 134
  {
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
    platform: 'MacIntel',
    mobile: false,
    secChUa: '"Chromium";v="134", "Google Chrome";v="134", "Not:A-Brand";v="24"',
    secChUaPlatform: '"macOS"',
    acceptLanguage: 'en-US,en;q=0.9',
    chromeVersion: '134',
  },
  // Mac Chrome 133
  {
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
    platform: 'MacIntel',
    mobile: false,
    secChUa: '"Not(A:Brand";v="99", "Google Chrome";v="133", "Chromium";v="133"',
    secChUaPlatform: '"macOS"',
    acceptLanguage: 'en-US,en;q=0.9',
    chromeVersion: '133',
  },
  // Windows Edge 134 (Chromium-based)
  {
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36 Edg/134.0.0.0',
    platform: 'Win32',
    mobile: false,
    secChUa: '"Chromium";v="134", "Microsoft Edge";v="134", "Not:A-Brand";v="24"',
    secChUaPlatform: '"Windows"',
    acceptLanguage: 'en-US,en;q=0.9',
    chromeVersion: '134',
  },
  // Linux Chrome 134
  {
    userAgent:
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
    platform: 'Linux x86_64',
    mobile: false,
    secChUa: '"Chromium";v="134", "Google Chrome";v="134", "Not:A-Brand";v="24"',
    secChUaPlatform: '"Linux"',
    acceptLanguage: 'en-US,en;q=0.9',
    chromeVersion: '134',
  },
];

// Session profile - maintains consistency within a session
let sessionProfile: BrowserProfile | null = null;
let profileRotationCounter = 0;
const PROFILE_ROTATION_INTERVAL = 50; // Rotate profile every N requests

function getSessionProfile(): BrowserProfile {
  // Rotate profile periodically to avoid fingerprinting
  if (!sessionProfile || profileRotationCounter >= PROFILE_ROTATION_INTERVAL) {
    sessionProfile = randomChoice(BROWSER_PROFILES);
    profileRotationCounter = 0;
  }
  profileRotationCounter++;
  return sessionProfile;
}

// Force profile rotation (useful after rate limiting)
export function rotateProfile(): void {
  sessionProfile = randomChoice(BROWSER_PROFILES);
  profileRotationCounter = 0;
}

// ============================================================================
// PROXY CONFIGURATION
// ============================================================================

export interface ProxyConfig {
  server: string;
  username?: string;
  password?: string;
}

interface ProxyStats {
  successCount: number;
  failureCount: number;
  lastUsed: number;
  blocked: boolean;
}

class ProxyManager {
  private proxies: ProxyConfig[] = [];
  private stats = new Map<string, ProxyStats>();
  private currentIndex = 0;

  addProxy(proxy: ProxyConfig): void {
    this.proxies.push(proxy);
  }

  addProxies(proxies: ProxyConfig[]): void {
    this.proxies.push(...proxies);
  }

  loadFromEnv(): void {
    // Single proxy URL
    const singleProxy = process.env.PROXY_URL;
    if (singleProxy) {
      this.addProxyFromUrl(singleProxy);
    }

    // Comma-separated list
    const proxyList = process.env.PROXY_LIST;
    if (proxyList) {
      proxyList.split(',').forEach((p) => this.addProxyFromUrl(p.trim()));
    }

    // BrightData style
    if (process.env.BRIGHTDATA_HOST && process.env.BRIGHTDATA_USER && process.env.BRIGHTDATA_PASS) {
      this.addProxy({
        server: process.env.BRIGHTDATA_HOST,
        username: process.env.BRIGHTDATA_USER,
        password: process.env.BRIGHTDATA_PASS,
      });
    }

    if (this.proxies.length > 0) {
      console.log(`[ProxyManager] Loaded ${this.proxies.length} proxies`);
    }
  }

  private addProxyFromUrl(url: string): void {
    try {
      let server: string;
      let username: string | undefined;
      let password: string | undefined;

      if (url.includes('@')) {
        const match = url.match(/^(?:https?:\/\/)?([^:]+):([^@]+)@(.+)$/);
        if (match) {
          username = match[1];
          password = match[2];
          server = `http://${match[3]}`;
        } else {
          server = url;
        }
      } else {
        server = url.startsWith('http') ? url : `http://${url}`;
      }

      this.addProxy({ server, username, password });
    } catch (e) {
      console.warn(`[ProxyManager] Failed to parse proxy: ${url}`);
    }
  }

  getNext(): ProxyConfig | null {
    if (this.proxies.length === 0) return null;

    // Skip blocked proxies
    let attempts = 0;
    while (attempts < this.proxies.length) {
      const proxy = this.proxies[this.currentIndex];
      this.currentIndex = (this.currentIndex + 1) % this.proxies.length;

      const key = this.getKey(proxy);
      const stats = this.stats.get(key);

      if (!stats?.blocked) {
        return proxy;
      }
      attempts++;
    }

    return null; // All proxies blocked
  }

  recordSuccess(proxy: ProxyConfig): void {
    const key = this.getKey(proxy);
    const stats = this.stats.get(key) || this.createStats();
    stats.successCount++;
    stats.lastUsed = Date.now();
    stats.blocked = false;
    this.stats.set(key, stats);
  }

  recordFailure(proxy: ProxyConfig): void {
    const key = this.getKey(proxy);
    const stats = this.stats.get(key) || this.createStats();
    stats.failureCount++;
    stats.lastUsed = Date.now();

    // Block after 3 consecutive failures
    if (stats.failureCount > 3 && stats.failureCount > stats.successCount * 2) {
      stats.blocked = true;
      console.log(`[ProxyManager] Blocking proxy: ${proxy.server}`);
    }

    this.stats.set(key, stats);
  }

  hasProxies(): boolean {
    return this.proxies.length > 0;
  }

  private getKey(proxy: ProxyConfig): string {
    return `${proxy.server}:${proxy.username || 'anon'}`;
  }

  private createStats(): ProxyStats {
    return { successCount: 0, failureCount: 0, lastUsed: 0, blocked: false };
  }
}

export const proxyManager = new ProxyManager();

// Initialize from environment
proxyManager.loadFromEnv();

// ============================================================================
// COOKIE PERSISTENCE
// ============================================================================

const cookieStore = new Map<string, Map<string, string>>();

function getDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function getCookiesForUrl(url: string): string {
  const domain = getDomain(url);
  const cookies = cookieStore.get(domain);
  if (!cookies || cookies.size === 0) return '';

  return Array.from(cookies.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

function saveCookiesFromResponse(url: string, response: Response): void {
  const domain = getDomain(url);
  const setCookieHeader = response.headers.get('set-cookie');

  if (!setCookieHeader) return;

  let cookies = cookieStore.get(domain);
  if (!cookies) {
    cookies = new Map();
    cookieStore.set(domain, cookies);
  }

  // Parse set-cookie header (simplified)
  const cookieParts = setCookieHeader.split(',');
  for (const part of cookieParts) {
    const match = part.match(/^([^=]+)=([^;]*)/);
    if (match) {
      cookies.set(match[1].trim(), match[2].trim());
    }
  }
}

// ============================================================================
// STEALTH FETCH IMPLEMENTATION
// ============================================================================

export interface StealthFetchOptions {
  timeout?: number;
  retries?: number;
  useProxy?: boolean;
  preserveCookies?: boolean;
  // Override profile for specific requests
  forceProfile?: BrowserProfile;
}

/**
 * Custom error for rate limiting
 */
export class RateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RateLimitError';
  }
}

/**
 * Build stealth headers for a request
 * All headers are consistent with the browser profile
 */
function buildStealthHeaders(url: string, profile: BrowserProfile): Record<string, string> {
  const headers: Record<string, string> = {
    // Core headers - order matters for some WAFs that check header ordering
    'User-Agent': profile.userAgent,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'Accept-Language': profile.acceptLanguage,
    'Accept-Encoding': 'gzip, deflate, br, zstd',

    // Modern Chrome Client Hints (critical for detection bypass)
    'sec-ch-ua': profile.secChUa,
    'sec-ch-ua-mobile': profile.mobile ? '?1' : '?0',
    'sec-ch-ua-platform': profile.secChUaPlatform,

    // Fetch metadata headers (what real browsers send)
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',

    // Connection headers
    'Upgrade-Insecure-Requests': '1',
    'Cache-Control': 'max-age=0',

    // Modern Chrome sends DNT and Priority headers; absence is a bot signal
    'DNT': '1',
    'Priority': 'u=0, i',
  };

  // Add cookies if available
  const cookies = getCookiesForUrl(url);
  if (cookies) {
    headers['Cookie'] = cookies;
  }

  return headers;
}

/**
 * Detect if a response body is a captcha/block page rather than real content.
 * Many search engines and retail sites return 200 OK but with a captcha page.
 * Detecting this early prevents wasted extraction work and enables fast fallback.
 */
export function isBlockedResponse(html: string): boolean {
  const lower = html.toLowerCase();
  const blockSignals = [
    // Captcha services
    'captcha', 'recaptcha', 'hcaptcha', 'g-recaptcha',
    // Cloudflare
    'checking your browser', 'cf-browser-verification', 'cf_chl_opt',
    'just a moment', 'enable javascript and cookies',
    // DataDome
    'datadome', 'dd.js',
    // PerimeterX / HUMAN
    'perimeterx', 'px-captcha', '_pxhd',
    // Akamai Bot Manager
    'akamai', 'akam/13',
    // DuckDuckGo bot detection (uses "anomaly" language, not "captcha")
    'anomaly-modal', 'bots use duckduckgo',
    'confirm this search was made by a human', 'challenge-form',
    // Google bot detection
    'unusual traffic from your computer', 'our systems have detected',
    // Generic block pages
    'access denied', 'request blocked', 'bot detected',
    'automated access', 'unusual traffic',
    'sorry, you have been blocked',
    'your request looks automated',
    'are you a robot', 'verify you are human',
    'please complete the security check',
  ];
  const matchCount = blockSignals.filter(s => lower.includes(s)).length;
  // Require at least 2 signals to avoid false positives on pages that
  // legitimately mention "captcha" in their content
  return matchCount >= 2;
}

/**
 * Stealth fetch with anti-detection measures
 * Replaces the basic fetch() with comprehensive browser emulation
 */
export async function stealthFetch(
  url: string,
  options: StealthFetchOptions = {}
): Promise<string | null> {
  const { timeout = 15000, retries = 2, useProxy = true, preserveCookies = true, forceProfile } = options;

  const profile = forceProfile || getSessionProfile();
  const headers = buildStealthHeaders(url, profile);

  // Get proxy if enabled
  const proxy = useProxy ? proxyManager.getNext() : null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      // Exponential backoff with jitter on retries.
      // Uniform delays are a strong bot signal; real users have variable wait times.
      if (attempt > 0) {
        const baseDelay = 1000 * Math.pow(2, attempt - 1); // 1s, 2s, 4s...
        const jitter = Math.random() * baseDelay * 0.5;    // up to 50% jitter
        await randomDelay(baseDelay, baseDelay + jitter);
        // Rotate profile on retry to present a fresh fingerprint
        rotateProfile();
      } else {
        await randomDelay(100, 400);
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      // Build fetch options
      const fetchOptions: RequestInit = {
        method: 'GET',
        headers,
        signal: controller.signal,
        redirect: 'follow',
      };

      const response = await fetch(url, fetchOptions);
      clearTimeout(timeoutId);

      // Save cookies for future requests
      if (preserveCookies) {
        saveCookiesFromResponse(url, response);
      }

      // Handle rate limiting - includes 403 which many WAFs use instead of 429
      if (response.status === 429 || response.status === 403) {
        rotateProfile();
        throw new RateLimitError(`HTTP ${response.status} blocked: ${url}`);
      }

      // Record proxy stats
      if (proxy) {
        if (response.ok) {
          proxyManager.recordSuccess(proxy);
        } else {
          proxyManager.recordFailure(proxy);
        }
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const html = await response.text();

      // Check for soft-blocks: 200 OK but body is a captcha/challenge page.
      // This is very common with Cloudflare, DataDome, and Google.
      if (isBlockedResponse(html)) {
        console.warn(`[StealthFetch] Soft-block detected on ${url} (attempt ${attempt + 1})`);
        rotateProfile();
        if (attempt < retries) continue;
        return null;
      }

      return html;
    } catch (error) {
      // Always propagate rate limit errors
      if (error instanceof RateLimitError) {
        throw error;
      }

      if (proxy) {
        proxyManager.recordFailure(proxy);
      }

      if (attempt < retries) {
        continue;
      }

      console.error(`[StealthFetch] Failed to fetch ${url}:`, error);
      return null;
    }
  }

  return null;
}

/**
 * Fetch multiple URLs in parallel with stealth measures
 * Includes natural timing variations between requests
 */
export async function stealthFetchParallel(
  urls: string[],
  options: StealthFetchOptions & {
    maxConcurrent?: number;
    onProgress?: (completed: number, total: number, currentUrl: string) => void;
  } = {}
): Promise<Map<string, string>> {
  const { maxConcurrent = 8, onProgress, ...fetchOptions } = options;
  const results = new Map<string, string>();

  // Track domains that fail so we can skip subsequent URLs from the same domain
  const failedDomains = new Set<string>();
  const getDomain = (url: string): string => {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
  };

  // Filter out URLs from already-failed domains before creating chunks
  const filteredUrls = urls.filter(url => {
    const domain = getDomain(url);
    if (failedDomains.has(domain)) {
      return false;
    }
    return true;
  });

  const chunks: string[][] = [];
  for (let i = 0; i < filteredUrls.length; i += maxConcurrent) {
    chunks.push(filteredUrls.slice(i, i + maxConcurrent));
  }

  let completed = 0;
  const total = urls.length;

  for (const chunk of chunks) {
    // Filter chunk again (domains may have failed in previous chunks)
    const activeUrls = chunk.filter(url => !failedDomains.has(getDomain(url)));

    const promises = activeUrls.map(async (url) => {
      if (onProgress) {
        onProgress(completed, total, url);
      }

      try {
        const html = await stealthFetch(url, fetchOptions);
        completed++;

        if (html) {
          results.set(url, html);
        } else {
          // null result = blocked (Cloudflare/captcha detected). Mark domain as failed.
          const domain = getDomain(url);
          failedDomains.add(domain);
          console.log(`[StealthFetchParallel] Domain blocked: ${domain} (skipping remaining URLs)`);
        }
      } catch (error) {
        completed++;
        // Mark domain as failed on error (403, rate limit, etc.)
        const domain = getDomain(url);
        failedDomains.add(domain);
        console.warn(`[StealthFetchParallel] Failed ${domain}:`, error instanceof Error ? error.message : error);
      }
    });

    await Promise.all(promises);

    // Skip remaining URLs from failed domains in the total count
    const skipped = chunk.length - activeUrls.length;
    completed += skipped;

    // Natural delay between chunks (varies by chunk size)
    const baseDelay = 300 + activeUrls.length * 50;
    if (activeUrls.length > 0) {
      await randomDelay(baseDelay, baseDelay + 300);
    }
  }

  if (failedDomains.size > 0) {
    console.log(`[StealthFetchParallel] Blocked domains: ${[...failedDomains].join(', ')}`);
  }

  return results;
}

// ============================================================================
// SEARCH ENGINE SPECIFIC CONFIGURATIONS
// ============================================================================

/**
 * Get headers optimized for search engine requests
 * Search engines have stricter bot detection
 */
export function getSearchEngineHeaders(searchEngine: string, profile: BrowserProfile): Record<string, string> {
  const baseHeaders = buildStealthHeaders('https://example.com', profile);

  // Search engines check referer patterns.
  // Each engine expects its own origin as the referer for subsequent page requests.
  const referers: Record<string, string> = {
    google: 'https://www.google.com/',
    bing: 'https://www.bing.com/',
    duckduckgo: 'https://duckduckgo.com/',
    brave: 'https://search.brave.com/',
    yahoo: 'https://search.yahoo.com/',
    ecosia: 'https://www.ecosia.org/',
    startpage: 'https://www.startpage.com/',
    qwant: 'https://www.qwant.com/',
    mojeek: 'https://www.mojeek.com/',
    searxng: '',  // SearXNG instances vary, omit referer
  };

  const engineKey = searchEngine.toLowerCase();
  if (referers[engineKey]) {
    baseHeaders['Referer'] = referers[engineKey];
    // When navigating within the same site, Sec-Fetch-Site should be 'same-origin'.
    // Using 'none' for a search engine with a referer is inconsistent and flagged by WAFs.
    baseHeaders['Sec-Fetch-Site'] = 'same-origin';
  }

  return baseHeaders;
}

/**
 * Domains that require extra stealth measures (proxy recommended)
 */
const PROTECTED_DOMAINS = [
  'google.com',
  'bing.com',
  'brave.com',
  'amazon.com',
  'walmart.com',
  'target.com',
  'ebay.com',
];

/**
 * Domains that REQUIRE Playwright (browser automation)
 * These sites use Cloudflare, DataDome, or other advanced bot detection
 * that cannot be bypassed with fetch() alone
 */
const BROWSER_REQUIRED_DOMAINS = [
  // Major retailers with advanced bot detection
  'amazon.com',
  'walmart.com',
  'target.com',
  'costco.com',
  'ebay.com',
  // Supplement stores with Cloudflare/DataDome/403 blocking
  'vitaminshoppe.com',
  'iherb.com',
  'gnc.com',
  'bodybuilding.com',
  'bulksupplements.com',
  'myprotein.com',
  'bulkpowders.com',
  'vitacost.com',
  'swansonvitamins.com',
  'puritan.com',
  'pipingrock.com',
  'herbspro.com',
  'luckyvitamin.com',
  'pureformulas.com',
  'nootropicsdepot.com',
  'nutricost.com',
  'transparentlabs.com',
  'bareperformancenutrition.com',
  'nowfoods.com',
  'chemistwarehouse.com.au',
  'supersmart.com',
  'life-extension.com',
  'optimumnutrition.com',
  // Price tracking/comparison sites
  'camelcamelcamel.com',
  // News/media with paywall detection
  'forbes.com',
  // Sports retailers
  'dickssportinggoods.com',
  // Shop.app (Shopify)
  'shop.app',
];

export function isProtectedDomain(url: string): boolean {
  try {
    const hostname = new URL(url).hostname;
    return PROTECTED_DOMAINS.some(
      (domain) => hostname === domain || hostname.endsWith('.' + domain)
    );
  } catch {
    return false;
  }
}

/**
 * Check if a URL requires Playwright (browser automation)
 */
export function requiresBrowser(url: string): boolean {
  try {
    const hostname = new URL(url).hostname;
    return BROWSER_REQUIRED_DOMAINS.some(
      (domain) => hostname === domain || hostname.endsWith('.' + domain)
    );
  } catch {
    return false;
  }
}

/**
 * Fetch a URL using Playwright if required, otherwise use stealth fetch
 */
export async function smartFetch(
  url: string,
  options: StealthFetchOptions = {}
): Promise<string | null> {
  if (requiresBrowser(url) && isPlaywrightAvailable()) {
    // Try Playwright for protected sites, fall back to stealth fetch
    try {
      const result = await renderPage(url, {
        timeout: options.timeout || 30000,
        simulateBehavior: true,
        preserveCookies: true,
      });
      if (result?.html) return result.html;
    } catch (error) {
      console.warn(`[SmartFetch] Playwright failed for ${url}, falling back to stealth fetch`);
    }
  }

  // Use stealth fetch (for all URLs when Playwright unavailable, or non-browser-required URLs)
  return stealthFetch(url, options);
}

/**
 * Fetch multiple URLs, using Playwright for browser-required domains
 */
export async function smartFetchParallel(
  urls: string[],
  options: StealthFetchOptions & {
    maxConcurrent?: number;
    onProgress?: (completed: number, total: number, currentUrl: string) => void;
  } = {}
): Promise<Map<string, string>> {
  const { onProgress, ...fetchOptions } = options;
  const results = new Map<string, string>();

  // Split URLs into browser-required and regular
  // When Playwright is unavailable, treat all URLs as regular (stealth fetch)
  const playwrightReady = isPlaywrightAvailable();
  const browserUrls = playwrightReady ? urls.filter(requiresBrowser) : [];
  const regularUrls = playwrightReady ? urls.filter((url) => !requiresBrowser(url)) : urls;

  let completed = 0;
  const total = urls.length;

  // Process browser-required URLs with Playwright (lower concurrency)
  // Falls back to stealth fetch if Playwright fails entirely (e.g. browser launch timeout)
  let playwrightFailed = false;
  if (browserUrls.length > 0) {
    try {
      const browserResults = await renderPages(browserUrls, {
        maxConcurrent: 3, // Playwright is heavier, use lower concurrency
        timeout: fetchOptions.timeout || 30000,
        onProgress: (_, __, currentUrl) => {
          if (onProgress) {
            onProgress(completed, total, currentUrl);
          }
          completed++;
        },
      });

      for (const [url, html] of browserResults) {
        results.set(url, html);
      }
    } catch (error) {
      console.warn(`[SmartFetch] Playwright failed for ${browserUrls.length} URLs, falling back to stealth fetch:`, error instanceof Error ? error.message : error);
      playwrightFailed = true;
    }
  }

  // If Playwright failed, retry browser-required URLs with stealth fetch as fallback
  if (playwrightFailed && browserUrls.length > 0) {
    const fallbackResults = await stealthFetchParallel(browserUrls, {
      ...fetchOptions,
      onProgress: (_, __, currentUrl) => {
        if (onProgress) {
          onProgress(completed, total, currentUrl);
        }
        completed++;
      },
    });

    for (const [url, html] of fallbackResults) {
      results.set(url, html);
    }
  }

  // Process regular URLs with stealth fetch (higher concurrency)
  if (regularUrls.length > 0) {
    const regularResults = await stealthFetchParallel(regularUrls, {
      ...fetchOptions,
      onProgress: (_, __, currentUrl) => {
        if (onProgress) {
          onProgress(completed, total, currentUrl);
        }
        completed++;
      },
    });

    for (const [url, html] of regularResults) {
      results.set(url, html);
    }
  }

  return results;
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
  BROWSER_PROFILES,
  getSessionProfile,
  type BrowserProfile,
};
