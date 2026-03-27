/**
 * Playwright-Based Stealth Renderer for Deep Deal Finder
 *
 * Uses real browser automation to bypass advanced bot detection:
 * - Cloudflare, DataDome, PerimeterX
 * - Amazon, Walmart, Target bot detection
 *
 * Ported from apigen's stealthRenderer.ts with:
 * - Consistent browser profiles (fingerprint matching)
 * - Stealth scripts injected via addInitScript()
 * - Human behavior simulation
 * - Cookie persistence
 */

import { chromium, Browser, BrowserContext } from 'playwright';

// ============================================================================
// RANDOMIZATION UTILITIES
// ============================================================================

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomChoice<T>(arr: T[]): T {
  return arr[randomInt(0, arr.length - 1)];
}

function gaussianRandom(mean: number, stdDev: number): number {
  const u = 1 - Math.random();
  const v = Math.random();
  const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return z * stdDev + mean;
}

function randomDelay(min: number, max: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, randomInt(min, max)));
}

// ============================================================================
// BROWSER PROFILES - Realistic, consistent combinations
// ============================================================================

interface BrowserProfile {
  userAgent: string;
  viewport: { width: number; height: number };
  platform: string;
  deviceMemory: number;
  hardwareConcurrency: number;
  maxTouchPoints: number;
  colorDepth: number;
  pixelRatio: number;
  timezone: string;
  languages: string[];
  webglVendor: string;
  webglRenderer: string;
}

// Updated to Chrome 133/134 (current as of early 2026).
// Playwright profiles must match the stealthFetch profiles to maintain consistency.
const BROWSER_PROFILES: BrowserProfile[] = [
  // Windows Chrome 134
  {
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    platform: 'Win32',
    deviceMemory: 8,
    hardwareConcurrency: 8,
    maxTouchPoints: 0,
    colorDepth: 24,
    pixelRatio: 1,
    timezone: 'America/New_York',
    languages: ['en-US', 'en'],
    webglVendor: 'Google Inc. (NVIDIA)',
    webglRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Direct3D11 vs_5_0 ps_5_0, D3D11)',
  },
  // Windows Chrome 133 with AMD
  {
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 768 },
    platform: 'Win32',
    deviceMemory: 16,
    hardwareConcurrency: 12,
    maxTouchPoints: 0,
    colorDepth: 24,
    pixelRatio: 1,
    timezone: 'America/Chicago',
    languages: ['en-US', 'en'],
    webglVendor: 'Google Inc. (AMD)',
    webglRenderer: 'ANGLE (AMD, AMD Radeon RX 7600 Direct3D11 vs_5_0 ps_5_0, D3D11)',
  },
  // Mac Chrome 134
  {
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
    platform: 'MacIntel',
    deviceMemory: 8,
    hardwareConcurrency: 8,
    maxTouchPoints: 0,
    colorDepth: 30,
    pixelRatio: 2,
    timezone: 'America/Los_Angeles',
    languages: ['en-US', 'en'],
    webglVendor: 'Google Inc. (Apple)',
    webglRenderer: 'ANGLE (Apple, Apple M1 Pro, OpenGL 4.1)',
  },
  // Mac Chrome 133
  {
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
    viewport: { width: 1680, height: 1050 },
    platform: 'MacIntel',
    deviceMemory: 16,
    hardwareConcurrency: 10,
    maxTouchPoints: 0,
    colorDepth: 30,
    pixelRatio: 2,
    timezone: 'America/New_York',
    languages: ['en-US', 'en'],
    webglVendor: 'Google Inc. (Apple)',
    webglRenderer: 'ANGLE (Apple, Apple M3 Pro, OpenGL 4.1)',
  },
];

// ============================================================================
// COOKIE PERSISTENCE
// ============================================================================

const cookieStore = new Map<string, any[]>();

function getCookiesForDomain(domain: string): any[] {
  return cookieStore.get(domain) || [];
}

function saveCookiesForDomain(domain: string, cookies: any[]): void {
  const existing = cookieStore.get(domain) || [];
  const merged = [...existing];

  for (const cookie of cookies) {
    const index = merged.findIndex((c) => c.name === cookie.name);
    if (index >= 0) {
      merged[index] = cookie;
    } else {
      merged.push(cookie);
    }
  }

  cookieStore.set(domain, merged);
}

// ============================================================================
// STEALTH SCRIPTS - Comprehensive fingerprint protection
// ============================================================================

function getStealthScripts(profile: BrowserProfile): string {
  return `
    // ========================================
    // WEBDRIVER DETECTION
    // ========================================
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
      configurable: true
    });
    delete Navigator.prototype.webdriver;

    // ========================================
    // PLUGINS - Realistic browser plugins
    // ========================================
    const makePluginArray = () => {
      const plugins = [
        { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
        { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
        { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
      ];

      const pluginArray = Object.create(PluginArray.prototype);
      plugins.forEach((p, i) => {
        const plugin = Object.create(Plugin.prototype);
        Object.defineProperties(plugin, {
          name: { value: p.name, enumerable: true },
          filename: { value: p.filename, enumerable: true },
          description: { value: p.description, enumerable: true },
          length: { value: 0, enumerable: true },
        });
        pluginArray[i] = plugin;
      });

      Object.defineProperties(pluginArray, {
        length: { value: plugins.length, enumerable: true },
        item: { value: (i) => pluginArray[i] || null },
        namedItem: { value: (n) => plugins.find(p => p.name === n) || null },
        refresh: { value: () => {} },
      });

      return pluginArray;
    };

    Object.defineProperty(navigator, 'plugins', {
      get: () => makePluginArray(),
      configurable: true
    });

    // ========================================
    // LANGUAGES
    // ========================================
    Object.defineProperty(navigator, 'languages', {
      get: () => ${JSON.stringify(profile.languages)},
      configurable: true
    });

    Object.defineProperty(navigator, 'language', {
      get: () => '${profile.languages[0]}',
      configurable: true
    });

    // ========================================
    // PLATFORM
    // ========================================
    Object.defineProperty(navigator, 'platform', {
      get: () => '${profile.platform}',
      configurable: true
    });

    // ========================================
    // HARDWARE SPECS
    // ========================================
    Object.defineProperty(navigator, 'hardwareConcurrency', {
      get: () => ${profile.hardwareConcurrency},
      configurable: true
    });

    Object.defineProperty(navigator, 'deviceMemory', {
      get: () => ${profile.deviceMemory},
      configurable: true
    });

    Object.defineProperty(navigator, 'maxTouchPoints', {
      get: () => ${profile.maxTouchPoints},
      configurable: true
    });

    // ========================================
    // SCREEN PROPERTIES
    // ========================================
    Object.defineProperty(screen, 'colorDepth', {
      get: () => ${profile.colorDepth},
      configurable: true
    });

    Object.defineProperty(window, 'devicePixelRatio', {
      get: () => ${profile.pixelRatio},
      configurable: true
    });

    // ========================================
    // PERMISSIONS API
    // ========================================
    const originalQuery = window.navigator.permissions?.query?.bind(window.navigator.permissions);
    if (originalQuery) {
      window.navigator.permissions.query = (parameters) => {
        if (parameters.name === 'notifications') {
          return Promise.resolve({ state: Notification.permission, onchange: null });
        }
        return originalQuery(parameters);
      };
    }

    // ========================================
    // CHROME OBJECT
    // ========================================
    if (!window.chrome) {
      window.chrome = {};
    }
    window.chrome.runtime = {
      OnInstalledReason: { CHROME_UPDATE: 'chrome_update', INSTALL: 'install', SHARED_MODULE_UPDATE: 'shared_module_update', UPDATE: 'update' },
      OnRestartRequiredReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic' },
      PlatformArch: { ARM: 'arm', ARM64: 'arm64', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
      PlatformNaclArch: { ARM: 'arm', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
      PlatformOs: { ANDROID: 'android', CROS: 'cros', LINUX: 'linux', MAC: 'mac', OPENBSD: 'openbsd', WIN: 'win' },
      RequestUpdateCheckStatus: { NO_UPDATE: 'no_update', THROTTLED: 'throttled', UPDATE_AVAILABLE: 'update_available' },
      connect: () => {},
      sendMessage: () => {},
    };
    window.chrome.loadTimes = () => ({
      requestTime: Date.now() / 1000,
      startLoadTime: Date.now() / 1000,
      commitLoadTime: Date.now() / 1000,
      finishDocumentLoadTime: Date.now() / 1000,
      finishLoadTime: Date.now() / 1000,
      firstPaintTime: Date.now() / 1000,
      firstPaintAfterLoadTime: 0,
      navigationType: 'Other',
      wasFetchedViaSpdy: false,
      wasNpnNegotiated: true,
      npnNegotiatedProtocol: 'h2',
      wasAlternateProtocolAvailable: false,
      connectionInfo: 'h2',
    });
    window.chrome.csi = () => ({
      startE: Date.now(),
      onloadT: Date.now(),
      pageT: Date.now() - performance.timing.navigationStart,
      tran: 15,
    });

    // ========================================
    // CANVAS FINGERPRINT PROTECTION
    // ========================================
    const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
    const originalGetImageData = CanvasRenderingContext2D.prototype.getImageData;

    const addNoise = (imageData) => {
      const data = imageData.data;
      for (let i = 0; i < data.length; i += 4) {
        data[i] = Math.max(0, Math.min(255, data[i] + (Math.random() < 0.1 ? (Math.random() > 0.5 ? 1 : -1) : 0)));
        data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + (Math.random() < 0.1 ? (Math.random() > 0.5 ? 1 : -1) : 0)));
        data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + (Math.random() < 0.1 ? (Math.random() > 0.5 ? 1 : -1) : 0)));
      }
      return imageData;
    };

    HTMLCanvasElement.prototype.toDataURL = function(...args) {
      const ctx = this.getContext('2d');
      if (ctx) {
        try {
          const imageData = originalGetImageData.call(ctx, 0, 0, this.width, this.height);
          addNoise(imageData);
          ctx.putImageData(imageData, 0, 0);
        } catch (e) {}
      }
      return originalToDataURL.apply(this, args);
    };

    CanvasRenderingContext2D.prototype.getImageData = function(...args) {
      const imageData = originalGetImageData.apply(this, args);
      return addNoise(imageData);
    };

    // ========================================
    // WEBGL FINGERPRINT PROTECTION
    // ========================================
    const getParameterProxyHandler = {
      apply: function(target, thisArg, args) {
        const param = args[0];
        if (param === 37445) return '${profile.webglVendor}';
        if (param === 37446) return '${profile.webglRenderer}';
        return Reflect.apply(target, thisArg, args);
      }
    };

    ['WebGLRenderingContext', 'WebGL2RenderingContext'].forEach(ctxName => {
      const ctx = window[ctxName];
      if (ctx && ctx.prototype.getParameter) {
        ctx.prototype.getParameter = new Proxy(ctx.prototype.getParameter, getParameterProxyHandler);
      }
    });

    // ========================================
    // HEADLESS DETECTION
    // ========================================
    Object.defineProperty(document, 'hidden', {
      get: () => false,
      configurable: true
    });

    Object.defineProperty(document, 'visibilityState', {
      get: () => 'visible',
      configurable: true
    });

    // ========================================
    // AUTOMATION DETECTION STRINGS
    // ========================================
    const originalError = Error;
    window.Error = function(...args) {
      const error = new originalError(...args);
      if (error.stack) {
        error.stack = error.stack.replace(/playwright|puppeteer|webdriver|selenium|headless/gi, 'native');
      }
      return error;
    };
    window.Error.prototype = originalError.prototype;

    if (window.name && window.name.includes('playwright')) {
      window.name = '';
    }

    // ========================================
    // CDP (Chrome DevTools Protocol) DETECTION
    // Modern bot detectors check for CDP artifacts.
    // ========================================

    // Remove Runtime.enable artifact
    delete window.cdc_adoQpoasnfa76pfcZLmcfl_Array;
    delete window.cdc_adoQpoasnfa76pfcZLmcfl_Promise;
    delete window.cdc_adoQpoasnfa76pfcZLmcfl_Symbol;

    // Hide the sourceURL that Playwright injects via CDP evaluate
    const originalGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
    Object.getOwnPropertyDescriptor = function(obj, prop) {
      if (prop === '__playwright_evaluation_script__') return undefined;
      return originalGetOwnPropertyDescriptor.call(this, obj, prop);
    };

    // ========================================
    // chrome.app OBJECT (missing = headless signal)
    // Real Chrome always has chrome.app defined.
    // ========================================
    if (window.chrome && !window.chrome.app) {
      window.chrome.app = {
        isInstalled: false,
        InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
        RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
        getDetails: () => null,
        getIsInstalled: () => false,
        installState: () => 'not_installed',
        runningState: () => 'cannot_run',
      };
    }

    // ========================================
    // Notification PERMISSION (headless defaults differ)
    // ========================================
    if (typeof Notification !== 'undefined') {
      Object.defineProperty(Notification, 'permission', {
        get: () => 'default',
        configurable: true,
      });
    }

    // ========================================
    // Connection type (headless omits this)
    // ========================================
    if (navigator.connection === undefined) {
      Object.defineProperty(navigator, 'connection', {
        get: () => ({
          effectiveType: '4g',
          rtt: 50,
          downlink: 10,
          saveData: false,
        }),
        configurable: true,
      });
    }

    // ========================================
    // Prevent iframe contentWindow detection
    // Some detectors create iframes and check if
    // contentWindow.chrome exists (it does in real Chrome).
    // ========================================
    const originalCreateElement = document.createElement.bind(document);
    document.createElement = function(tag, options) {
      const element = originalCreateElement(tag, options);
      if (tag.toLowerCase() === 'iframe') {
        const origContentWindow = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow');
        Object.defineProperty(element, 'contentWindow', {
          get: function() {
            const win = origContentWindow?.get?.call(this);
            if (win && !win.chrome) {
              win.chrome = window.chrome;
            }
            return win;
          },
          configurable: true,
        });
      }
      return element;
    };

    console.debug('[Stealth] Anti-detection scripts v2 loaded');
  `;
}

// ============================================================================
// HUMAN BEHAVIOR SIMULATION
// ============================================================================

interface Point {
  x: number;
  y: number;
}

function generateMousePath(start: Point, end: Point, steps: number = 20): Point[] {
  const points: Point[] = [];

  const cp1: Point = {
    x: start.x + (end.x - start.x) * 0.25 + (Math.random() - 0.5) * 80,
    y: start.y + (end.y - start.y) * 0.25 + (Math.random() - 0.5) * 80,
  };
  const cp2: Point = {
    x: start.x + (end.x - start.x) * 0.75 + (Math.random() - 0.5) * 80,
    y: start.y + (end.y - start.y) * 0.75 + (Math.random() - 0.5) * 80,
  };

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const t2 = t * t;
    const t3 = t2 * t;
    const mt = 1 - t;
    const mt2 = mt * mt;
    const mt3 = mt2 * mt;

    points.push({
      x: mt3 * start.x + 3 * mt2 * t * cp1.x + 3 * mt * t2 * cp2.x + t3 * end.x,
      y: mt3 * start.y + 3 * mt2 * t * cp1.y + 3 * mt * t2 * cp2.y + t3 * end.y,
    });
  }

  return points;
}

async function simulateHumanBehavior(page: any): Promise<void> {
  const viewport = page.viewportSize();
  if (!viewport) return;

  // Random mouse movements
  for (let i = 0; i < randomInt(1, 3); i++) {
    const start = { x: randomInt(100, viewport.width - 100), y: randomInt(100, viewport.height - 100) };
    const end = { x: randomInt(100, viewport.width - 100), y: randomInt(100, viewport.height - 100) };
    const path = generateMousePath(start, end);

    for (const point of path) {
      await page.mouse.move(point.x, point.y);
      await randomDelay(5, 15);
    }
    await randomDelay(50, 150);
  }

  // Maybe scroll
  if (Math.random() < 0.6) {
    const scrollAmount = randomInt(150, 400);
    const steps = randomInt(3, 8);
    const stepAmount = scrollAmount / steps;

    for (let i = 0; i < steps; i++) {
      await page.mouse.wheel(0, stepAmount);
      await randomDelay(20, 60);
    }

    // Occasionally scroll back
    if (Math.random() < 0.3) {
      await randomDelay(200, 500);
      await page.mouse.wheel(0, -randomInt(30, 100));
    }
  }
}

// ============================================================================
// BROWSER MANAGEMENT
// ============================================================================

let browser: Browser | null = null;
let browserLaunchFailed = false;

async function getBrowser(): Promise<Browser> {
  // If a previous launch attempt failed, don't waste 60s retrying
  if (browserLaunchFailed) {
    throw new Error('Browser launch previously failed, skipping');
  }

  if (!browser) {
    // Launch with anti-detection flags.
    // Use headless: true (Playwright's new headless mode is the default in modern versions).
    try {
      browser = await chromium.launch({
        channel: 'chrome',
        headless: true,
        args: [
          '--disable-blink-features=AutomationControlled',
          '--no-sandbox',
          '--disable-dev-shm-usage',
          '--disable-infobars',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding',
          '--disable-webrtc-hw-encoding',
          '--disable-webrtc-hw-decoding',
          '--enforce-webrtc-ip-permission-check',
          '--use-gl=angle',
          '--use-angle=d3d11',
        ],
        timeout: 60000,
      });
      console.log('[PlaywrightRenderer] Browser launched (system Chrome)');
    } catch (err) {
      browser = null;
      browserLaunchFailed = true;
      throw err;
    }
  }
  return browser;
}

export async function closeBrowser(): Promise<void> {
  if (browser) {
    await browser.close();
    browser = null;
  }
}

/**
 * Check if Playwright browser is available (not failed to launch).
 * Used by smartFetchParallel to decide whether to route URLs to Playwright.
 */
export function isPlaywrightAvailable(): boolean {
  return !browserLaunchFailed;
}

// ============================================================================
// MAIN RENDER FUNCTION
// ============================================================================

export interface RenderOptions {
  timeout?: number;
  waitFor?: string;
  simulateBehavior?: boolean;
  preserveCookies?: boolean;
}

export interface RenderResult {
  html: string;
  url: string;
  title: string;
}

/**
 * Render a page using Playwright with stealth measures
 * Use this for protected domains that block fetch()
 */
export async function renderPage(url: string, options: RenderOptions = {}): Promise<RenderResult | null> {
  const { timeout = 30000, waitFor, simulateBehavior = true, preserveCookies = true } = options;

  // Select a random browser profile
  const profile = randomChoice(BROWSER_PROFILES);

  let browserInstance: Browser;
  try {
    browserInstance = await getBrowser();
  } catch (error) {
    console.error(`[PlaywrightRenderer] Browser launch failed, skipping ${url}:`, error instanceof Error ? error.message : error);
    return null;
  }

  // Extract domain for cookie persistence
  const urlObj = new URL(url);
  const domain = urlObj.hostname;

  // Create context with full profile
  const contextOptions: any = {
    userAgent: profile.userAgent,
    viewport: profile.viewport,
    locale: profile.languages[0],
    timezoneId: profile.timezone,
    deviceScaleFactor: profile.pixelRatio,
    hasTouch: profile.maxTouchPoints > 0,
    isMobile: false,
    javaScriptEnabled: true,
    extraHTTPHeaders: {
      'Accept-Language': profile.languages.join(',') + ';q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      Accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Cache-Control': 'max-age=0',
      // sec-ch-ua token must match the Chrome version in the UA string.
      // The "Not A Brand" token changes each Chrome milestone.
      'sec-ch-ua': `"Chromium";v="${profile.userAgent.match(/Chrome\/(\d+)/)?.[1] || '134'}", "Google Chrome";v="${profile.userAgent.match(/Chrome\/(\d+)/)?.[1] || '134'}", "Not:A-Brand";v="24"`,
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': `"${profile.platform === 'Win32' ? 'Windows' : 'macOS'}"`,
      'DNT': '1',
      'Priority': 'u=0, i',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1',
    },
  };

  let context: BrowserContext | null = null;

  try {
    context = await browserInstance.newContext(contextOptions);

    // Restore cookies if preserved
    if (preserveCookies) {
      const cookies = getCookiesForDomain(domain);
      if (cookies.length > 0) {
        await context.addCookies(cookies);
      }
    }

    const page = await context.newPage();

    // Apply stealth scripts
    await page.addInitScript(getStealthScripts(profile));

    // Human-like delay before navigation
    await randomDelay(200, 500);

    // Navigate
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout,
    });

    // Wait for page stabilization
    await page.waitForLoadState('load', { timeout: 15000 }).catch(() => {});

    // Gaussian-distributed delay
    const delay = Math.max(1000, Math.min(3000, gaussianRandom(2000, 400)));
    await new Promise((resolve) => setTimeout(resolve, delay));

    // Try network idle
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

    // Wait for specific selector if provided
    if (waitFor) {
      await page.waitForSelector(waitFor, { timeout: 10000 }).catch(() => {});
    }

    // Simulate human behavior
    if (simulateBehavior) {
      await simulateHumanBehavior(page);
    }

    // Additional delay
    await randomDelay(200, 500);

    // Get page content
    const html = await page.content();
    const title = await page.title();
    const finalUrl = page.url();

    // Save cookies
    if (preserveCookies) {
      const cookies = await context.cookies();
      saveCookiesForDomain(domain, cookies);
    }

    return { html, url: finalUrl, title };
  } catch (error) {
    console.error(`[PlaywrightRenderer] Failed to render ${url}:`, error);
    return null;
  } finally {
    if (context) {
      await context.close();
    }
  }
}

/**
 * Render multiple pages in parallel (with concurrency limit)
 */
export async function renderPages(
  urls: string[],
  options: RenderOptions & {
    maxConcurrent?: number;
    onProgress?: (completed: number, total: number, currentUrl: string) => void;
  } = {}
): Promise<Map<string, string>> {
  const { maxConcurrent = 3, onProgress, ...renderOptions } = options;
  const results = new Map<string, string>();
  const chunks: string[][] = [];

  // Split into chunks
  for (let i = 0; i < urls.length; i += maxConcurrent) {
    chunks.push(urls.slice(i, i + maxConcurrent));
  }

  let completed = 0;

  for (const chunk of chunks) {
    const promises = chunk.map(async (url) => {
      if (onProgress) {
        onProgress(completed, urls.length, url);
      }

      const result = await renderPage(url, renderOptions);
      completed++;

      if (result) {
        results.set(url, result.html);
      }
    });

    await Promise.all(promises);

    // Delay between chunks
    await randomDelay(500, 1000);
  }

  return results;
}

// Cleanup on process exit
process.on('beforeExit', closeBrowser);
process.on('SIGINT', async () => {
  await closeBrowser();
  process.exit(0);
});
