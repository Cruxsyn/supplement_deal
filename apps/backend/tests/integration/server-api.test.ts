import { describe, test, expect, mock, beforeAll, afterAll } from 'bun:test';

// Mock scraper before importing server to avoid real HTTP requests
mock.module('../../src/scraper', () => ({
  searchSupplementsDeep: async (query: string, onProgress?: Function, category?: string, countries?: string[], depth?: string) => {
    if (onProgress) {
      onProgress({ stage: 'searching', message: 'Mock search' });
    }
    return [{
      title: 'Mock Product 100g',
      price: 19.99,
      currency: 'USD',
      quantity: 100,
      unit: 'g',
      price_per_unit: 0.1999,
      vendor: 'mock.com',
      url: 'https://mock.com/product',
      confidence: 0.85,
    }];
  },
  SEARCH_DEPTHS: {
    quick: { maxUrls: 30, maxQueries: 6 },
    normal: { maxUrls: 75, maxQueries: 12 },
    deep: { maxUrls: 150, maxQueries: 18 },
    exhaustive: { maxUrls: 300, maxQueries: 25 },
  },
}));

import server from '../../src/server';

const BASE_URL = 'http://localhost';

function req(path: string, options?: RequestInit): Request {
  return new Request(`${BASE_URL}${path}`, options);
}

afterAll(() => {
  server.stop();
});

// ---------- GET /health ----------

describe('GET /health', () => {
  test('returns 200 with healthy status', async () => {
    const res = await server.fetch(req('/health'));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe('healthy');
    expect(body.version).toBe('1.0.0');
    expect(typeof body.timestamp).toBe('string');
  });
});

// ---------- GET / (root) ----------

describe('GET / (root)', () => {
  test('returns 200 with API info', async () => {
    const res = await server.fetch(req('/'));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.name).toBe('Deep Deal Finder API');
    expect(body.version).toBe('2.0.0');
    expect(body.endpoints).toBeDefined();
    expect(body.categories).toContain('supplements');
    expect(body.categories).toContain('building');
    expect(body.categories).toContain('robotics');
    expect(body.countries).toBeArray();
    expect(body.countries.length).toBeGreaterThan(0);
    expect(body.depths).toEqual(['quick', 'normal', 'deep', 'exhaustive']);
    expect(body.depthConfig).toBeDefined();
  });
});

// ---------- POST /search (valid) ----------

describe('POST /search', () => {
  test('returns 200 with SearchResponse for valid query', async () => {
    const res = await server.fetch(req('/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'creatine monohydrate', category: 'supplements', countries: ['US'] }),
    }));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.query).toBe('creatine monohydrate');
    expect(body.category).toBe('supplements');
    expect(body.countries).toEqual(['US']);
    expect(body.results).toBeArray();
    expect(body.results.length).toBeGreaterThan(0);
    expect(body.best_deal).toBeDefined();
    expect(body.best_deal.title).toBe('Mock Product 100g');
    expect(typeof body.timestamp).toBe('string');
    expect(typeof body.search_time_ms).toBe('number');
  });

  test('defaults category to supplements when omitted', async () => {
    const res = await server.fetch(req('/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'whey protein' }),
    }));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.category).toBe('supplements');
    expect(body.countries).toEqual(['US']);
  });
});

// ---------- POST /search (invalid) ----------

describe('POST /search validation errors', () => {
  test('returns 400 for empty body', async () => {
    const res = await server.fetch(req('/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }));
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  test('returns 400 when query is missing', async () => {
    const res = await server.fetch(req('/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: 'supplements' }),
    }));
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toContain('Query');
  });

  test('returns 400 when query is too short', async () => {
    const res = await server.fetch(req('/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'a' }),
    }));
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toContain('at least 2');
  });
});

// ---------- POST /search/stream ----------

describe('POST /search/stream', () => {
  test('returns text/event-stream content type', async () => {
    const res = await server.fetch(req('/search/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'creatine monohydrate' }),
    }));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/event-stream');
  });

  test('returns CORS headers on stream response', async () => {
    const res = await server.fetch(req('/search/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'fish oil' }),
    }));
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  test('streams progress and complete events', async () => {
    const res = await server.fetch(req('/search/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'vitamin d3' }),
    }));
    expect(res.status).toBe(200);

    const text = await res.text();
    // Should contain progress events and a complete event
    expect(text).toContain('event: progress');
    expect(text).toContain('event: complete');
  });

  test('returns 400 for invalid stream request', async () => {
    const res = await server.fetch(req('/search/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'a' }),
    }));
    expect(res.status).toBe(400);
  });
});

// ---------- Method not allowed ----------

describe('Method not allowed', () => {
  test('GET /search returns 405', async () => {
    const res = await server.fetch(req('/search'));
    expect(res.status).toBe(405);

    const body = await res.json();
    expect(body.error).toContain('Method not allowed');
  });

  test('GET /search/stream returns 405', async () => {
    const res = await server.fetch(req('/search/stream'));
    expect(res.status).toBe(405);

    const body = await res.json();
    expect(body.error).toContain('Method not allowed');
  });
});

// ---------- Not found ----------

describe('Not found', () => {
  test('GET /nonexistent returns 404', async () => {
    const res = await server.fetch(req('/nonexistent'));
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error).toContain('Not found');
  });

  test('POST /nonexistent returns 404', async () => {
    const res = await server.fetch(req('/nonexistent', { method: 'POST' }));
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error).toContain('Not found');
  });
});

// ---------- CORS ----------

describe('CORS', () => {
  test('OPTIONS /search returns 204 with CORS headers', async () => {
    const res = await server.fetch(req('/search', { method: 'OPTIONS' }));
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
  });

  test('OPTIONS /search/stream returns 204', async () => {
    const res = await server.fetch(req('/search/stream', { method: 'OPTIONS' }));
    expect(res.status).toBe(204);
  });

  test('JSON responses include CORS header', async () => {
    const res = await server.fetch(req('/health'));
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });
});
