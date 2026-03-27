import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseHTML } from 'linkedom';

const FIXTURES_DIR = join(__dirname, '../fixtures/search-results');

function loadFixture(name: string): string {
  return readFileSync(join(FIXTURES_DIR, name), 'utf-8');
}

// ─── Brave ───────────────────────────────────────────────────────────────────

describe('Brave search parser', () => {
  test('extracts URLs from data-url and snippet links', () => {
    const html = loadFixture('brave-results.html');
    const { document } = parseHTML(html);
    const urls: string[] = [];
    const selectors = ['a[data-url]', '.snippet a', '.result a', 'a.result-header', '.fdb a[href^="http"]'];
    for (const selector of selectors) {
      const links = document.querySelectorAll(selector);
      for (const link of links) {
        const href = link.getAttribute('data-url') || link.getAttribute('href');
        if (href && href.startsWith('http') && !href.includes('brave.com')) {
          urls.push(href);
        }
      }
    }
    expect(urls.length).toBeGreaterThanOrEqual(3);
    expect(urls).toContain('https://iherb.com/product/123');
    expect(urls).toContain('https://vitacost.com/creatine');
    expect(urls).toContain('https://amazon.com/dp/B123');
  });

  test('filters out brave.com internal URLs', () => {
    const html = loadFixture('brave-results.html');
    const { document } = parseHTML(html);
    const urls: string[] = [];
    const selectors = ['a[data-url]', '.snippet a', '.result a', 'a.result-header', '.fdb a[href^="http"]'];
    for (const selector of selectors) {
      const links = document.querySelectorAll(selector);
      for (const link of links) {
        const href = link.getAttribute('data-url') || link.getAttribute('href');
        if (href && href.startsWith('http') && !href.includes('brave.com')) {
          urls.push(href);
        }
      }
    }
    for (const url of urls) {
      expect(url).not.toContain('brave.com');
    }
  });

  test('returns empty array for empty HTML', () => {
    const { document } = parseHTML('<html><body></body></html>');
    const urls: string[] = [];
    const selectors = ['a[data-url]', '.snippet a', '.result a', 'a.result-header', '.fdb a[href^="http"]'];
    for (const selector of selectors) {
      const links = document.querySelectorAll(selector);
      for (const link of links) {
        const href = link.getAttribute('data-url') || link.getAttribute('href');
        if (href && href.startsWith('http') && !href.includes('brave.com')) {
          urls.push(href);
        }
      }
    }
    expect(urls).toEqual([]);
  });

  test('extracts data-url attribute when present', () => {
    const html = loadFixture('brave-results.html');
    const { document } = parseHTML(html);
    const dataUrlLinks = document.querySelectorAll('a[data-url]');
    const urls: string[] = [];
    for (const link of dataUrlLinks) {
      const href = link.getAttribute('data-url');
      if (href && href.startsWith('http')) {
        urls.push(href);
      }
    }
    expect(urls).toContain('https://amazon.com/dp/B123');
  });
});

// ─── DuckDuckGo Lite ─────────────────────────────────────────────────────────

describe('DuckDuckGo Lite search parser', () => {
  test('extracts URLs from result-link and table links', () => {
    const html = loadFixture('ddg-results.html');
    const { document } = parseHTML(html);
    const urls: string[] = [];
    const links = document.querySelectorAll('a.result-link, td a[href^="http"]');
    for (const link of links) {
      const href = link.getAttribute('href');
      if (href && href.startsWith('http') && !href.includes('duckduckgo.com')) {
        urls.push(href);
      }
    }
    expect(urls.length).toBeGreaterThanOrEqual(2);
    expect(urls).toContain('https://iherb.com/product');
    expect(urls).toContain('https://amazon.com/product');
  });

  test('filters out duckduckgo.com internal URLs', () => {
    const html = loadFixture('ddg-results.html');
    const { document } = parseHTML(html);
    const urls: string[] = [];
    const links = document.querySelectorAll('a.result-link, td a[href^="http"]');
    for (const link of links) {
      const href = link.getAttribute('href');
      if (href && href.startsWith('http') && !href.includes('duckduckgo.com')) {
        urls.push(href);
      }
    }
    for (const url of urls) {
      expect(url).not.toContain('duckduckgo.com');
    }
  });

  test('returns empty array for empty HTML', () => {
    const { document } = parseHTML('<html><body></body></html>');
    const urls: string[] = [];
    const links = document.querySelectorAll('a.result-link, td a[href^="http"]');
    for (const link of links) {
      const href = link.getAttribute('href');
      if (href && href.startsWith('http') && !href.includes('duckduckgo.com')) {
        urls.push(href);
      }
    }
    expect(urls).toEqual([]);
  });

  test('fallback: extracts from any http links when primary selectors match nothing', () => {
    const { document } = parseHTML('<html><body><a href="https://example.com/product">Example</a><a href="https://duckduckgo.com/about">DDG</a></body></html>');
    // Primary selectors
    let urls: string[] = [];
    const links = document.querySelectorAll('a.result-link, td a[href^="http"]');
    for (const link of links) {
      const href = link.getAttribute('href');
      if (href && href.startsWith('http') && !href.includes('duckduckgo.com')) {
        urls.push(href);
      }
    }
    // Fallback (as the scraper does)
    if (urls.length === 0) {
      const allLinks = document.querySelectorAll('a[href^="http"]');
      for (const link of allLinks) {
        const href = link.getAttribute('href');
        if (href && !href.includes('duckduckgo.com')) {
          urls.push(href);
        }
      }
    }
    expect(urls).toContain('https://example.com/product');
    expect(urls).not.toContain(expect.stringContaining('duckduckgo.com'));
  });
});

// ─── Google ──────────────────────────────────────────────────────────────────

describe('Google search parser', () => {
  test('unwraps /url?q= encoded URLs', () => {
    const html = loadFixture('google-results.html');
    const { document } = parseHTML(html);
    const urls: string[] = [];
    const links = document.querySelectorAll('a[href^="/url?"], a[href^="http"]');
    for (const link of links) {
      let href = link.getAttribute('href');
      if (!href) continue;
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
    expect(urls).toContain('https://iherb.com/product');
    expect(urls).toContain('https://amazon.com/dp/B123');
  });

  test('includes direct http links', () => {
    const html = loadFixture('google-results.html');
    const { document } = parseHTML(html);
    const urls: string[] = [];
    const links = document.querySelectorAll('a[href^="/url?"], a[href^="http"]');
    for (const link of links) {
      let href = link.getAttribute('href');
      if (!href) continue;
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
    expect(urls).toContain('https://direct-link.com/product');
  });

  test('filters out google.com and youtube.com URLs', () => {
    const html = loadFixture('google-results.html');
    const { document } = parseHTML(html);
    const urls: string[] = [];
    const links = document.querySelectorAll('a[href^="/url?"], a[href^="http"]');
    for (const link of links) {
      let href = link.getAttribute('href');
      if (!href) continue;
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
    for (const url of urls) {
      expect(url).not.toContain('google.com');
      expect(url).not.toContain('youtube.com');
    }
  });

  test('returns empty array for empty HTML', () => {
    const { document } = parseHTML('<html><body></body></html>');
    const urls: string[] = [];
    const links = document.querySelectorAll('a[href^="/url?"], a[href^="http"]');
    for (const link of links) {
      let href = link.getAttribute('href');
      if (!href) continue;
      if (href.startsWith('/url?')) {
        const match = href.match(/[?&]q=([^&]+)/);
        if (match) {
          try { href = decodeURIComponent(match[1]); } catch { continue; }
        }
      }
      if (href.startsWith('http') &&
          !href.includes('google.com') &&
          !href.includes('youtube.com') &&
          !href.includes('maps.google')) {
        urls.push(href);
      }
    }
    expect(urls).toEqual([]);
  });
});

// ─── Bing ────────────────────────────────────────────────────────────────────

describe('Bing search parser', () => {
  test('extracts URLs from b_algo result links', () => {
    const html = loadFixture('bing-results.html');
    const { document } = parseHTML(html);
    const urls: string[] = [];
    const selectors = ['.b_algo h2 a', '.b_algo a[href^="http"]', 'li.b_algo a'];
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
    }
    expect(urls.length).toBeGreaterThanOrEqual(2);
    expect(urls).toContain('https://iherb.com/product');
    expect(urls).toContain('https://amazon.com/product');
  });

  test('filters out bing.com, microsoft.com, and msn.com URLs', () => {
    const html = loadFixture('bing-results.html');
    const { document } = parseHTML(html);
    const urls: string[] = [];
    const selectors = ['.b_algo h2 a', '.b_algo a[href^="http"]', 'li.b_algo a'];
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
    }
    for (const url of urls) {
      expect(url).not.toContain('bing.com');
      expect(url).not.toContain('microsoft.com');
      expect(url).not.toContain('msn.com');
    }
  });

  test('returns empty array for empty HTML', () => {
    const { document } = parseHTML('<html><body></body></html>');
    const urls: string[] = [];
    const selectors = ['.b_algo h2 a', '.b_algo a[href^="http"]', 'li.b_algo a'];
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
    }
    expect(urls).toEqual([]);
  });

  test('uses broad fallback selector for non-bing links', () => {
    const html = loadFixture('bing-results.html');
    const { document } = parseHTML(html);
    // The scraper also uses: a[href^="http"]:not([href*="bing.com"]):not([href*="microsoft.com"])
    const fallbackLinks = document.querySelectorAll('a[href^="http"]');
    const allHrefs: string[] = [];
    for (const link of fallbackLinks) {
      const href = link.getAttribute('href');
      if (href) allHrefs.push(href);
    }
    // Should include bing.com link in raw hrefs (before filtering)
    expect(allHrefs.some(u => u.includes('bing.com'))).toBe(true);
    // But filtered result should not
    const filtered = allHrefs.filter(u =>
      !u.includes('bing.com') && !u.includes('microsoft.com') && !u.includes('msn.com')
    );
    expect(filtered.length).toBeGreaterThanOrEqual(2);
  });
});

// ─── Ecosia ──────────────────────────────────────────────────────────────────

describe('Ecosia search parser', () => {
  test('extracts URLs from result__link elements', () => {
    const html = loadFixture('ecosia-results.html');
    const { document } = parseHTML(html);
    const urls: string[] = [];
    const links = document.querySelectorAll('a.result__link, .result a[href^="http"]');
    for (const link of links) {
      const href = link.getAttribute('href');
      if (href && href.startsWith('http') && !href.includes('ecosia.org')) {
        urls.push(href);
      }
    }
    expect(urls.length).toBeGreaterThanOrEqual(2);
    expect(urls).toContain('https://iherb.com/product');
    expect(urls).toContain('https://amazon.com/product');
  });

  test('filters out ecosia.org internal URLs', () => {
    const html = loadFixture('ecosia-results.html');
    const { document } = parseHTML(html);
    const urls: string[] = [];
    const links = document.querySelectorAll('a.result__link, .result a[href^="http"]');
    for (const link of links) {
      const href = link.getAttribute('href');
      if (href && href.startsWith('http') && !href.includes('ecosia.org')) {
        urls.push(href);
      }
    }
    for (const url of urls) {
      expect(url).not.toContain('ecosia.org');
    }
  });

  test('returns empty array for empty HTML', () => {
    const { document } = parseHTML('<html><body></body></html>');
    const urls: string[] = [];
    const links = document.querySelectorAll('a.result__link, .result a[href^="http"]');
    for (const link of links) {
      const href = link.getAttribute('href');
      if (href && href.startsWith('http') && !href.includes('ecosia.org')) {
        urls.push(href);
      }
    }
    expect(urls).toEqual([]);
  });

  test('fallback: extracts from all http links when primary selectors match nothing', () => {
    const { document } = parseHTML('<html><body><a href="https://shop.com/item">Shop</a><a href="https://ecosia.org/about">About</a></body></html>');
    let urls: string[] = [];
    const links = document.querySelectorAll('a.result__link, .result a[href^="http"]');
    for (const link of links) {
      const href = link.getAttribute('href');
      if (href && href.startsWith('http') && !href.includes('ecosia.org')) {
        urls.push(href);
      }
    }
    if (urls.length === 0) {
      const allLinks = document.querySelectorAll('a[href^="http"]');
      for (const link of allLinks) {
        const href = link.getAttribute('href');
        if (href && !href.includes('ecosia.org')) {
          urls.push(href);
        }
      }
    }
    expect(urls).toContain('https://shop.com/item');
    expect(urls).not.toContain(expect.stringContaining('ecosia.org'));
  });
});

// ─── Yahoo ───────────────────────────────────────────────────────────────────

describe('Yahoo search parser', () => {
  test('extracts and decodes URLs from RU= redirect pattern', () => {
    const html = loadFixture('yahoo-results.html');
    const { document } = parseHTML(html);
    const urls: string[] = [];
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
            // skip
          }
        }
      }
    }
    expect(urls.length).toBe(2);
    expect(urls).toContain('https://iherb.com/product');
    expect(urls).toContain('https://amazon.com/dp/B123');
  });

  test('properly decodes percent-encoded URLs', () => {
    const html = loadFixture('yahoo-results.html');
    const { document } = parseHTML(html);
    const urls: string[] = [];
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
            // skip
          }
        }
      }
    }
    // Verify that the URLs are decoded (no %3A, %2F etc.)
    for (const url of urls) {
      expect(url).not.toContain('%3A');
      expect(url).not.toContain('%2F');
    }
  });

  test('returns empty array for empty HTML', () => {
    const { document } = parseHTML('<html><body></body></html>');
    const urls: string[] = [];
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
            // skip
          }
        }
      }
    }
    expect(urls).toEqual([]);
  });

  test('skips malformed encoded URLs gracefully', () => {
    const { document } = parseHTML('<html><body><a href="https://r.search.yahoo.com/RU=%E0%A4%A/RK=0">Bad</a></body></html>');
    const urls: string[] = [];
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
            // skip malformed URLs
          }
        }
      }
    }
    expect(urls).toEqual([]);
  });
});

// ─── Startpage ───────────────────────────────────────────────────────────────

describe('Startpage search parser', () => {
  test('extracts URLs from w-gl__result-url elements', () => {
    const html = loadFixture('startpage-results.html');
    const { document } = parseHTML(html);
    const urls: string[] = [];
    const links = document.querySelectorAll('.w-gl__result-url, .result a[href^="http"]');
    for (const link of links) {
      const href = link.getAttribute('href');
      if (href && href.startsWith('http') && !href.includes('startpage.com')) {
        urls.push(href);
      }
    }
    expect(urls.length).toBe(2);
    expect(urls).toContain('https://iherb.com/product');
    expect(urls).toContain('https://amazon.com/product');
  });

  test('filters out startpage.com internal URLs', () => {
    const html = loadFixture('startpage-results.html');
    const { document } = parseHTML(html);
    const urls: string[] = [];
    const links = document.querySelectorAll('.w-gl__result-url, .result a[href^="http"]');
    for (const link of links) {
      const href = link.getAttribute('href');
      if (href && href.startsWith('http') && !href.includes('startpage.com')) {
        urls.push(href);
      }
    }
    for (const url of urls) {
      expect(url).not.toContain('startpage.com');
    }
  });

  test('returns empty array for empty HTML', () => {
    const { document } = parseHTML('<html><body></body></html>');
    const urls: string[] = [];
    const links = document.querySelectorAll('.w-gl__result-url, .result a[href^="http"]');
    for (const link of links) {
      const href = link.getAttribute('href');
      if (href && href.startsWith('http') && !href.includes('startpage.com')) {
        urls.push(href);
      }
    }
    expect(urls).toEqual([]);
  });
});

// ─── Mojeek ──────────────────────────────────────────────────────────────────

describe('Mojeek search parser', () => {
  test('extracts URLs from results-standard .ob links', () => {
    const html = loadFixture('mojeek-results.html');
    const { document } = parseHTML(html);
    const urls: string[] = [];
    const links = document.querySelectorAll('.results-standard a.ob, a.title[href^="http"]');
    for (const link of links) {
      const href = link.getAttribute('href');
      if (href && href.startsWith('http') && !href.includes('mojeek.com')) {
        urls.push(href);
      }
    }
    expect(urls.length).toBe(2);
    expect(urls).toContain('https://iherb.com/product');
    expect(urls).toContain('https://amazon.com/product');
  });

  test('filters out mojeek.com internal URLs', () => {
    const { document } = parseHTML('<html><body><div class="results-standard"><a class="ob" href="https://mojeek.com/about">Mojeek</a></div></body></html>');
    const urls: string[] = [];
    const links = document.querySelectorAll('.results-standard a.ob, a.title[href^="http"]');
    for (const link of links) {
      const href = link.getAttribute('href');
      if (href && href.startsWith('http') && !href.includes('mojeek.com')) {
        urls.push(href);
      }
    }
    expect(urls).toEqual([]);
  });

  test('returns empty array for empty HTML', () => {
    const { document } = parseHTML('<html><body></body></html>');
    const urls: string[] = [];
    const links = document.querySelectorAll('.results-standard a.ob, a.title[href^="http"]');
    for (const link of links) {
      const href = link.getAttribute('href');
      if (href && href.startsWith('http') && !href.includes('mojeek.com')) {
        urls.push(href);
      }
    }
    expect(urls).toEqual([]);
  });

  test('fallback: extracts from all http links when primary selectors match nothing', () => {
    const { document } = parseHTML('<html><body><a href="https://supplement-store.com/product">Store</a><a href="https://mojeek.com/help">Help</a></body></html>');
    let urls: string[] = [];
    const links = document.querySelectorAll('.results-standard a.ob, a.title[href^="http"]');
    for (const link of links) {
      const href = link.getAttribute('href');
      if (href && href.startsWith('http') && !href.includes('mojeek.com')) {
        urls.push(href);
      }
    }
    if (urls.length === 0) {
      const allLinks = document.querySelectorAll('a[href^="http"]');
      for (const link of allLinks) {
        const href = link.getAttribute('href');
        if (href && !href.includes('mojeek.com')) {
          urls.push(href);
        }
      }
    }
    expect(urls).toContain('https://supplement-store.com/product');
    expect(urls).not.toContain(expect.stringContaining('mojeek.com'));
  });
});

// ─── Qwant ───────────────────────────────────────────────────────────────────

describe('Qwant search parser', () => {
  test('extracts URLs from data-testid="serp-url" links', () => {
    const html = loadFixture('qwant-results.html');
    const { document } = parseHTML(html);
    const urls: string[] = [];
    const selectors = ['a[data-testid="serp-url"]', '.result__url a', 'a.external[href^="http"]'];
    for (const selector of selectors) {
      const links = document.querySelectorAll(selector);
      for (const link of links) {
        const href = link.getAttribute('href');
        if (href && href.startsWith('http') && !href.includes('qwant.com')) {
          urls.push(href);
        }
      }
    }
    expect(urls.length).toBe(2);
    expect(urls).toContain('https://iherb.com/product');
    expect(urls).toContain('https://amazon.com/product');
  });

  test('filters out qwant.com internal URLs', () => {
    const { document } = parseHTML('<html><body><a data-testid="serp-url" href="https://qwant.com/maps">Maps</a></body></html>');
    const urls: string[] = [];
    const selectors = ['a[data-testid="serp-url"]', '.result__url a', 'a.external[href^="http"]'];
    for (const selector of selectors) {
      const links = document.querySelectorAll(selector);
      for (const link of links) {
        const href = link.getAttribute('href');
        if (href && href.startsWith('http') && !href.includes('qwant.com')) {
          urls.push(href);
        }
      }
    }
    expect(urls).toEqual([]);
  });

  test('returns empty array for empty HTML', () => {
    const { document } = parseHTML('<html><body></body></html>');
    const urls: string[] = [];
    const selectors = ['a[data-testid="serp-url"]', '.result__url a', 'a.external[href^="http"]'];
    for (const selector of selectors) {
      const links = document.querySelectorAll(selector);
      for (const link of links) {
        const href = link.getAttribute('href');
        if (href && href.startsWith('http') && !href.includes('qwant.com')) {
          urls.push(href);
        }
      }
    }
    expect(urls).toEqual([]);
  });

  test('fallback: extracts from all http links when primary selectors match nothing', () => {
    const { document } = parseHTML('<html><body><a href="https://vendor.com/product">Vendor</a><a href="https://qwant.com/privacy">Privacy</a></body></html>');
    let urls: string[] = [];
    const selectors = ['a[data-testid="serp-url"]', '.result__url a', 'a.external[href^="http"]'];
    for (const selector of selectors) {
      const links = document.querySelectorAll(selector);
      for (const link of links) {
        const href = link.getAttribute('href');
        if (href && href.startsWith('http') && !href.includes('qwant.com')) {
          urls.push(href);
        }
      }
    }
    if (urls.length === 0) {
      const allLinks = document.querySelectorAll('a[href^="http"]');
      for (const link of allLinks) {
        const href = link.getAttribute('href');
        if (href && !href.includes('qwant.com')) {
          urls.push(href);
        }
      }
    }
    expect(urls).toContain('https://vendor.com/product');
    expect(urls).not.toContain(expect.stringContaining('qwant.com'));
  });
});

// ─── Google Shopping ────────────────────────────────────────────────────────

describe('Google Shopping search parser', () => {
  test('extracts URLs from shopping content selectors', () => {
    const html = loadFixture('google-shopping-results.html');
    const { document } = parseHTML(html);
    const urls: string[] = [];
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
          urls.push(href);
        }
      }
    }
    expect(urls.length).toBeGreaterThanOrEqual(5);
    expect(urls).toContain('https://iherb.com/pr/optimum-nutrition-creatine/12345');
    expect(urls).toContain('https://vitacost.com/creatine-monohydrate-powder-500g');
    expect(urls).toContain('https://amazon.com/dp/B00E9M4XFI/creatine-micronized');
  });

  test('filters out google.com and gstatic.com URLs', () => {
    const html = loadFixture('google-shopping-results.html');
    const { document } = parseHTML(html);
    const urls: string[] = [];
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
          urls.push(href);
        }
      }
    }
    for (const url of urls) {
      expect(url).not.toContain('google.com');
      expect(url).not.toContain('gstatic.com');
    }
  });

  test('returns empty array for empty HTML', () => {
    const { document } = parseHTML('<html><body></body></html>');
    const urls: string[] = [];
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
          urls.push(href);
        }
      }
    }
    expect(urls).toEqual([]);
  });

  test('fallback: extracts from all http links excluding google.com and gstatic.com', () => {
    const { document } = parseHTML('<html><body><a href="https://shop.com/supplement">Shop</a><a href="https://google.com/maps">Google</a><a href="https://gstatic.com/img.png">Static</a></body></html>');
    let urls: string[] = [];
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
          urls.push(href);
        }
      }
    }
    if (urls.length === 0) {
      const allLinks = document.querySelectorAll('a[href^="http"]');
      for (const link of allLinks) {
        const href = link.getAttribute('href');
        if (href && !href.includes('google.com') && !href.includes('gstatic.com')) {
          urls.push(href);
        }
      }
    }
    expect(urls).toContain('https://shop.com/supplement');
    expect(urls).not.toContain(expect.stringContaining('google.com'));
    expect(urls).not.toContain(expect.stringContaining('gstatic.com'));
  });
});

// ─── Yandex ─────────────────────────────────────────────────────────────────

describe('Yandex search parser', () => {
  test('extracts URLs from serp-item and Organic selectors', () => {
    const html = loadFixture('yandex-results.html');
    const { document } = parseHTML(html);
    const urls: string[] = [];
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
    expect(urls.length).toBeGreaterThanOrEqual(5);
    expect(urls).toContain('https://iherb.com/pr/creatine-monohydrate/67890');
    expect(urls).toContain('https://vitacost.com/creatine-powder-1kg');
    expect(urls).toContain('https://amazon.com/dp/B001ECHGAW/creatine-powder');
  });

  test('filters out yandex.* and ya.ru URLs', () => {
    const html = loadFixture('yandex-results.html');
    const { document } = parseHTML(html);
    const urls: string[] = [];
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
    for (const url of urls) {
      expect(url).not.toContain('yandex.');
      expect(url).not.toContain('ya.ru');
    }
  });

  test('returns empty array for empty HTML', () => {
    const { document } = parseHTML('<html><body></body></html>');
    const urls: string[] = [];
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
    expect(urls).toEqual([]);
  });

  test('fallback: extracts from all http links excluding yandex and ya.ru', () => {
    const { document } = parseHTML('<html><body><a href="https://vitamin-shop.ru/product">Shop</a><a href="https://yandex.ru/maps">Yandex</a><a href="https://ya.ru/redirect">Ya</a></body></html>');
    let urls: string[] = [];
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
    if (urls.length === 0) {
      const allLinks = document.querySelectorAll('a[href^="http"]');
      for (const link of allLinks) {
        const href = link.getAttribute('href');
        if (href && !href.includes('yandex.') && !href.includes('ya.ru')) {
          urls.push(href);
        }
      }
    }
    expect(urls).toContain('https://vitamin-shop.ru/product');
    expect(urls).not.toContain(expect.stringContaining('yandex.'));
    expect(urls).not.toContain(expect.stringContaining('ya.ru'));
  });
});
