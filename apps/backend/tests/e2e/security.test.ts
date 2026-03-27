import { describe, test, expect, mock } from 'bun:test';

mock.module('../../src/scraper', () => ({
  searchSupplementsDeep: async () => [],
  SEARCH_DEPTHS: {
    quick: { maxUrls: 30, maxQueries: 6 },
    normal: { maxUrls: 75, maxQueries: 12 },
    deep: { maxUrls: 150, maxQueries: 18 },
    exhaustive: { maxUrls: 300, maxQueries: 25 },
  },
}));

import server from '../../src/server';

async function postSearch(body: any): Promise<Response> {
  return server.fetch(new Request('http://localhost:3001/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));
}

// --- Input Validation Security ---

describe('Input Validation Security', () => {
  test('rejects query longer than 200 characters', async () => {
    const longQuery = 'a'.repeat(201);
    const res = await postSearch({ query: longQuery });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBeString();
  });

  test('handles XSS script tag without server error', async () => {
    const res = await postSearch({ query: '<script>alert(1)</script>' });
    expect([200, 400]).toContain(res.status);
    const data = await res.json();
    expect(data).toBeDefined();
  });

  test('handles SQL injection pattern safely', async () => {
    const res = await postSearch({ query: "'; DROP TABLE--" });
    expect([200, 400]).toContain(res.status);
    const data = await res.json();
    expect(data).toBeDefined();
  });

  test('handles null byte in query safely', async () => {
    const res = await postSearch({ query: 'creatine\x00monohydrate' });
    expect([200, 400]).toContain(res.status);
    const data = await res.json();
    expect(data).toBeDefined();
  });

  test('handles very large JSON body without crashing', async () => {
    const largeBody = { query: 'creatine', padding: 'x'.repeat(1_000_000) };
    const res = await postSearch(largeBody);
    expect([200, 400, 413]).toContain(res.status);
  });

  test('handles unicode overflow (emoji and CJK characters)', async () => {
    const res = await postSearch({ query: '\u{1F4AA}\u{1F4AA} \u4E2D\u6587\u67E5\u8BE2' });
    expect([200, 400]).toContain(res.status);
    const data = await res.json();
    expect(data).toBeDefined();
  });
});

// --- CORS Headers ---

describe('CORS Headers', () => {
  test('OPTIONS preflight returns proper CORS headers', async () => {
    const res = await server.fetch(new Request('http://localhost:3001/search', {
      method: 'OPTIONS',
    }));
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Access-Control-Allow-Methods')).toInclude('POST');
  });

  test('POST /search response includes CORS header', async () => {
    const res = await postSearch({ query: 'creatine monohydrate' });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  test('GET /health response includes CORS header', async () => {
    const res = await server.fetch(new Request('http://localhost:3001/health'));
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });
});

// --- Error Information Disclosure ---

describe('Error Information Disclosure', () => {
  test('400 errors include safe message with no stack traces', async () => {
    const res = await postSearch({ query: '' });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBeString();
    expect(data.error).not.toInclude('at ');
    expect(data.error).not.toInclude('stack');
    expect(JSON.stringify(data)).not.toInclude('node_modules');
  });

  test('404 errors do not leak internal paths', async () => {
    const res = await server.fetch(new Request('http://localhost:3001/nonexistent'));
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data).toEqual({ error: 'Not found' });
    expect(JSON.stringify(data)).not.toMatch(/[A-Z]:\\/);
    expect(JSON.stringify(data)).not.toInclude('/home/');
  });

  test('error responses have consistent { error: string } structure', async () => {
    const res = await postSearch({ query: 'x' }); // too short
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data).toHaveProperty('error');
    expect(typeof data.error).toBe('string');
  });
});

// --- Method Enforcement ---

describe('Method Enforcement', () => {
  test('PUT /search returns 405', async () => {
    const res = await server.fetch(new Request('http://localhost:3001/search', { method: 'PUT' }));
    expect(res.status).toBe(405);
  });

  test('DELETE /search returns 405', async () => {
    const res = await server.fetch(new Request('http://localhost:3001/search', { method: 'DELETE' }));
    expect(res.status).toBe(405);
  });

  test('PATCH /search returns 405', async () => {
    const res = await server.fetch(new Request('http://localhost:3001/search', { method: 'PATCH' }));
    expect(res.status).toBe(405);
  });
});
