import { describe, test, expect, mock } from 'bun:test';

// Mock playwright renderer to avoid browser launch
mock.module('../../src/playwrightRenderer', () => ({
  renderPage: async () => null,
  renderPages: async () => [],
}));

import {
  isBlockedResponse,
  isProtectedDomain,
  requiresBrowser,
  RateLimitError,
  BROWSER_PROFILES,
  getSessionProfile,
  rotateProfile,
  getSearchEngineHeaders,
  randomDelay,
  proxyManager,
} from '../../src/stealthFetch';
import type { BrowserProfile } from '../../src/stealthFetch';

// ============================================================================
// isBlockedResponse
// ============================================================================

describe('isBlockedResponse', () => {
  test('returns true for Cloudflare challenge HTML', () => {
    const html = `
      <html><head><title>Just a moment...</title></head>
      <body>
        <div id="cf-browser-verification">Checking your browser before accessing</div>
        <script>window._cf_chl_opt={}</script>
      </body></html>
    `;
    expect(isBlockedResponse(html)).toBe(true);
  });

  test('returns true for reCAPTCHA HTML', () => {
    const html = `
      <html><body>
        <div class="g-recaptcha" data-sitekey="abc123"></div>
        <script src="https://www.google.com/recaptcha/api.js"></script>
        <p>Please verify you are not a robot</p>
      </body></html>
    `;
    expect(isBlockedResponse(html)).toBe(true);
  });

  test('returns true for DataDome block page', () => {
    const html = `
      <html><body>
        <script src="https://ct.datadome.co/dd.js"></script>
        <p>DataDome has detected unusual activity</p>
      </body></html>
    `;
    expect(isBlockedResponse(html)).toBe(true);
  });

  test('returns true for PerimeterX block page', () => {
    const html = `
      <html><body>
        <div id="px-captcha"></div>
        <script>window._pxhd = "abc123";</script>
        <p>Press and hold to confirm you are not a robot</p>
      </body></html>
    `;
    expect(isBlockedResponse(html)).toBe(true);
  });

  test('returns true for access denied bot detection', () => {
    const html = `
      <html><body>
        <h1>Access Denied</h1>
        <p>Your request looks automated. Bot detected.</p>
      </body></html>
    `;
    expect(isBlockedResponse(html)).toBe(true);
  });

  test('returns false for normal product page HTML', () => {
    const html = `
      <html><head><title>Great Protein Powder - Buy Now</title></head>
      <body>
        <h1>Whey Protein Isolate</h1>
        <p class="price">$29.99</p>
        <p>High quality protein supplement for athletes</p>
        <button>Add to Cart</button>
      </body></html>
    `;
    expect(isBlockedResponse(html)).toBe(false);
  });

  test('returns false for empty string', () => {
    expect(isBlockedResponse('')).toBe(false);
  });

  test('returns false for HTML that mentions captcha casually (single signal)', () => {
    const html = `
      <html><body>
        <h1>How to solve captcha challenges</h1>
        <p>This article discusses various captcha solving techniques used in web development.</p>
      </body></html>
    `;
    // "captcha" appears but no second signal like g-recaptcha, recaptcha, etc.
    // The word "captcha" alone counts as one signal; needs >= 2
    expect(isBlockedResponse(html)).toBe(false);
  });
});

// ============================================================================
// isProtectedDomain
// ============================================================================

describe('isProtectedDomain', () => {
  test('returns true for google.com', () => {
    expect(isProtectedDomain('https://www.google.com/search?q=test')).toBe(true);
  });

  test('returns true for amazon.com', () => {
    expect(isProtectedDomain('https://amazon.com/dp/B123')).toBe(true);
  });

  test('returns true for amazon.co.uk subdomain via .amazon.com check', () => {
    // amazon.co.uk does NOT end with '.amazon.com', so this should be false
    // The PROTECTED_DOMAINS list has 'amazon.com' - amazon.co.uk won't match
    expect(isProtectedDomain('https://www.amazon.co.uk/product')).toBe(false);
  });

  test('returns true for www.amazon.com subdomain', () => {
    expect(isProtectedDomain('https://www.amazon.com/dp/B123')).toBe(true);
  });

  test('returns false for example.com', () => {
    expect(isProtectedDomain('https://example.com')).toBe(false);
  });

  test('returns false for iherb.com (not in protected list)', () => {
    expect(isProtectedDomain('https://iherb.com/product')).toBe(false);
  });

  test('handles invalid URLs gracefully', () => {
    expect(isProtectedDomain('not-a-valid-url')).toBe(false);
  });
});

// ============================================================================
// requiresBrowser
// ============================================================================

describe('requiresBrowser', () => {
  test('returns true for amazon.com', () => {
    expect(requiresBrowser('https://www.amazon.com/dp/B123')).toBe(true);
  });

  test('returns true for walmart.com', () => {
    expect(requiresBrowser('https://www.walmart.com/ip/123')).toBe(true);
  });

  test('returns true for iherb.com', () => {
    expect(requiresBrowser('https://www.iherb.com/pr/product/123')).toBe(true);
  });

  test('returns true for costco.com', () => {
    expect(requiresBrowser('https://www.costco.com/product.html')).toBe(true);
  });

  test('returns false for example.com', () => {
    expect(requiresBrowser('https://example.com')).toBe(false);
  });

  test('returns false for sparkfun.com (not in browser-required list)', () => {
    expect(requiresBrowser('https://sparkfun.com/products/123')).toBe(false);
  });

  test('handles invalid URLs gracefully', () => {
    expect(requiresBrowser('not-a-valid-url')).toBe(false);
  });
});

// ============================================================================
// RateLimitError
// ============================================================================

describe('RateLimitError', () => {
  test('is an instance of Error', () => {
    const err = new RateLimitError('rate limited');
    expect(err).toBeInstanceOf(Error);
  });

  test('has name RateLimitError', () => {
    const err = new RateLimitError('rate limited');
    expect(err.name).toBe('RateLimitError');
  });

  test('preserves the message', () => {
    const err = new RateLimitError('HTTP 429 blocked: https://example.com');
    expect(err.message).toBe('HTTP 429 blocked: https://example.com');
  });

  test('can be caught as Error', () => {
    let caught = false;
    try {
      throw new RateLimitError('test');
    } catch (e) {
      if (e instanceof Error) {
        caught = true;
      }
    }
    expect(caught).toBe(true);
  });
});

// ============================================================================
// BROWSER_PROFILES
// ============================================================================

describe('BROWSER_PROFILES', () => {
  test('has at least 4 profiles', () => {
    expect(BROWSER_PROFILES.length).toBeGreaterThanOrEqual(4);
  });

  test('each profile has all required fields', () => {
    for (const profile of BROWSER_PROFILES) {
      expect(profile.userAgent).toBeDefined();
      expect(typeof profile.userAgent).toBe('string');
      expect(profile.platform).toBeDefined();
      expect(typeof profile.platform).toBe('string');
      expect(typeof profile.mobile).toBe('boolean');
      expect(profile.secChUa).toBeDefined();
      expect(typeof profile.secChUa).toBe('string');
      expect(profile.secChUaPlatform).toBeDefined();
      expect(typeof profile.secChUaPlatform).toBe('string');
      expect(profile.acceptLanguage).toBeDefined();
      expect(typeof profile.acceptLanguage).toBe('string');
      expect(profile.chromeVersion).toBeDefined();
      expect(typeof profile.chromeVersion).toBe('string');
    }
  });

  test('all userAgents contain Chrome/13 (version 133 or 134)', () => {
    for (const profile of BROWSER_PROFILES) {
      expect(profile.userAgent).toMatch(/Chrome\/13[34]/);
    }
  });

  test('no profiles have mobile set to true', () => {
    for (const profile of BROWSER_PROFILES) {
      expect(profile.mobile).toBe(false);
    }
  });
});

// ============================================================================
// getSessionProfile and rotateProfile
// ============================================================================

describe('getSessionProfile and rotateProfile', () => {
  test('getSessionProfile returns a BrowserProfile', () => {
    const profile = getSessionProfile();
    expect(profile).toBeDefined();
    expect(profile.userAgent).toBeDefined();
    expect(profile.platform).toBeDefined();
    expect(typeof profile.mobile).toBe('boolean');
    expect(profile.secChUa).toBeDefined();
    expect(profile.secChUaPlatform).toBeDefined();
    expect(profile.acceptLanguage).toBeDefined();
    expect(profile.chromeVersion).toBeDefined();
  });

  test('returns the same profile on consecutive calls', () => {
    const profile1 = getSessionProfile();
    const profile2 = getSessionProfile();
    expect(profile1.userAgent).toBe(profile2.userAgent);
    expect(profile1.platform).toBe(profile2.platform);
    expect(profile1.secChUa).toBe(profile2.secChUa);
  });

  test('rotateProfile changes the current profile (eventually)', () => {
    const originalProfile = getSessionProfile();
    // Since rotateProfile uses randomChoice, it might pick the same profile.
    // Try multiple rotations to confirm it can change.
    let changed = false;
    for (let i = 0; i < 20; i++) {
      rotateProfile();
      const newProfile = getSessionProfile();
      if (newProfile.userAgent !== originalProfile.userAgent) {
        changed = true;
        break;
      }
    }
    // With 6 profiles and 20 attempts, the chance of never changing is (1/6)^20 ~ 0
    expect(changed).toBe(true);
  });
});

// ============================================================================
// getSearchEngineHeaders
// ============================================================================

describe('getSearchEngineHeaders', () => {
  const profile = getSessionProfile();

  test('returns an object with headers', () => {
    const headers = getSearchEngineHeaders('google', profile);
    expect(headers).toBeDefined();
    expect(typeof headers).toBe('object');
  });

  test('includes User-Agent matching the profile', () => {
    const headers = getSearchEngineHeaders('google', profile);
    expect(headers['User-Agent']).toBe(profile.userAgent);
  });

  test('includes sec-ch-ua header', () => {
    const headers = getSearchEngineHeaders('google', profile);
    expect(headers['sec-ch-ua']).toBe(profile.secChUa);
  });

  test('includes Accept and Accept-Language headers', () => {
    const headers = getSearchEngineHeaders('google', profile);
    expect(headers['Accept']).toBeDefined();
    expect(headers['Accept']).toContain('text/html');
    expect(headers['Accept-Language']).toBe(profile.acceptLanguage);
  });

  test('sets Google referer for google engine', () => {
    const headers = getSearchEngineHeaders('google', profile);
    expect(headers['Referer']).toBe('https://www.google.com/');
    expect(headers['Sec-Fetch-Site']).toBe('same-origin');
  });

  test('sets Bing referer for bing engine', () => {
    const headers = getSearchEngineHeaders('bing', profile);
    expect(headers['Referer']).toBe('https://www.bing.com/');
    expect(headers['Sec-Fetch-Site']).toBe('same-origin');
  });

  test('sets DuckDuckGo referer for duckduckgo engine', () => {
    const headers = getSearchEngineHeaders('duckduckgo', profile);
    expect(headers['Referer']).toBe('https://duckduckgo.com/');
    expect(headers['Sec-Fetch-Site']).toBe('same-origin');
  });

  test('does not set Referer for searxng (empty string in config)', () => {
    const headers = getSearchEngineHeaders('searxng', profile);
    // Empty string is falsy, so the if block won't execute
    expect(headers['Referer']).toBeUndefined();
  });
});

// ============================================================================
// proxyManager
// ============================================================================

describe('proxyManager', () => {
  test('hasProxies returns false initially (no env vars set)', () => {
    expect(proxyManager.hasProxies()).toBe(false);
  });

  test('getNext returns null when no proxies are configured', () => {
    expect(proxyManager.getNext()).toBeNull();
  });
});

// ============================================================================
// randomDelay
// ============================================================================

describe('randomDelay', () => {
  test('resolves without error', async () => {
    // Use very small delays so test runs fast
    await expect(randomDelay(1, 5)).resolves.toBeUndefined();
  });

  test('returns a promise', () => {
    const result = randomDelay(1, 2);
    expect(result).toBeInstanceOf(Promise);
  });
});
