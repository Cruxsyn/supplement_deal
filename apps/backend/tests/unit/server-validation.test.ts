import { describe, expect, test, mock } from 'bun:test';

// Mock scraper module BEFORE importing server to prevent real HTTP calls
mock.module('../../src/scraper', () => ({
  searchSupplementsDeep: async () => [],
  SEARCH_DEPTHS: {
    quick: { maxUrls: 30, maxQueries: 6 },
    normal: { maxUrls: 75, maxQueries: 12 },
    deep: { maxUrls: 150, maxQueries: 18 },
    exhaustive: { maxUrls: 300, maxQueries: 25 },
  },
}));

import { _testing } from '../../src/server';

const { validateSearchRequest, jsonResponse, handleCors } = _testing;

// ---------------------------------------------------------------------------
// validateSearchRequest
// ---------------------------------------------------------------------------
describe('validateSearchRequest', () => {
  // --- valid cases ---

  test('accepts a fully-specified valid request', () => {
    const result = validateSearchRequest({
      query: 'creatine',
      category: 'supplements',
      countries: ['US'],
      depth: 'normal',
    });
    expect(result).toEqual({
      valid: true,
      query: 'creatine',
      category: 'supplements',
      countries: ['US'],
      depth: 'normal',
    });
  });

  test('accepts minimum-length query (2 chars) and fills defaults', () => {
    const result = validateSearchRequest({ query: 'ab' });
    expect(result).toEqual({
      valid: true,
      query: 'ab',
      category: 'supplements',
      countries: ['US'],
      depth: 'normal',
    });
  });

  test('trims whitespace from query', () => {
    const result = validateSearchRequest({ query: '  creatine  ' });
    expect(result).toMatchObject({ valid: true, query: 'creatine' });
  });

  test('accepts all valid categories', () => {
    for (const category of ['supplements', 'building', 'robotics'] as const) {
      const result = validateSearchRequest({ query: 'test', category });
      expect(result).toMatchObject({ valid: true, category });
    }
  });

  test('accepts all valid depths', () => {
    for (const depth of ['quick', 'normal', 'deep', 'exhaustive'] as const) {
      const result = validateSearchRequest({ query: 'test', depth });
      expect(result).toMatchObject({ valid: true, depth });
    }
  });

  test('filters out invalid countries and keeps valid ones', () => {
    const result = validateSearchRequest({
      query: 'test',
      countries: ['US', 'INVALID', 'UK'],
    });
    expect(result).toMatchObject({ valid: true, countries: ['US', 'UK'] });
  });

  // --- invalid cases ---

  test('rejects null body', () => {
    const result = validateSearchRequest(null);
    expect(result).toEqual({ valid: false, error: 'Request body must be a JSON object' });
  });

  test('rejects undefined body', () => {
    const result = validateSearchRequest(undefined);
    expect(result).toEqual({ valid: false, error: 'Request body must be a JSON object' });
  });

  test('rejects string body', () => {
    const result = validateSearchRequest('string');
    expect(result).toEqual({ valid: false, error: 'Request body must be a JSON object' });
  });

  test('rejects array body', () => {
    const result = validateSearchRequest([]);
    expect(result).toEqual({ valid: false, error: 'Query must be a non-empty string' });
  });

  test('rejects number body', () => {
    const result = validateSearchRequest(42);
    expect(result).toEqual({ valid: false, error: 'Request body must be a JSON object' });
  });

  test('rejects missing query', () => {
    const result = validateSearchRequest({});
    expect(result).toEqual({ valid: false, error: 'Query must be a non-empty string' });
  });

  test('rejects empty query', () => {
    const result = validateSearchRequest({ query: '' });
    expect(result).toEqual({ valid: false, error: 'Query must be a non-empty string' });
  });

  test('rejects query shorter than 2 chars', () => {
    const result = validateSearchRequest({ query: 'a' });
    expect(result).toEqual({ valid: false, error: 'Query must be at least 2 characters' });
  });

  test('rejects query longer than 200 chars', () => {
    const result = validateSearchRequest({ query: 'x'.repeat(201) });
    expect(result).toEqual({ valid: false, error: 'Query must be less than 200 characters' });
  });

  test('rejects non-string query', () => {
    const result = validateSearchRequest({ query: 123 });
    expect(result).toEqual({ valid: false, error: 'Query must be a non-empty string' });
  });

  // --- default behaviour ---

  test('defaults invalid category to supplements', () => {
    const result = validateSearchRequest({ query: 'test', category: 'invalid' });
    expect(result).toMatchObject({ valid: true, category: 'supplements' });
  });

  test('defaults missing countries to [US]', () => {
    const result = validateSearchRequest({ query: 'test' });
    expect(result).toMatchObject({ valid: true, countries: ['US'] });
  });

  test('defaults empty countries array to [US]', () => {
    const result = validateSearchRequest({ query: 'test', countries: [] });
    expect(result).toMatchObject({ valid: true, countries: ['US'] });
  });

  test('defaults all-invalid countries to [US]', () => {
    const result = validateSearchRequest({ query: 'test', countries: ['INVALID', 'NOPE'] });
    expect(result).toMatchObject({ valid: true, countries: ['US'] });
  });

  test('defaults invalid depth to normal', () => {
    const result = validateSearchRequest({ query: 'test', depth: 'turbo' });
    expect(result).toMatchObject({ valid: true, depth: 'normal' });
  });
});

// ---------------------------------------------------------------------------
// jsonResponse
// ---------------------------------------------------------------------------
describe('jsonResponse', () => {
  test('returns status 200 by default', () => {
    const res = jsonResponse({ ok: true });
    expect(res.status).toBe(200);
  });

  test('returns custom status codes', () => {
    expect(jsonResponse({ error: 'bad' }, 400).status).toBe(400);
    expect(jsonResponse({ error: 'not found' }, 404).status).toBe(404);
    expect(jsonResponse({ error: 'fail' }, 500).status).toBe(500);
  });

  test('sets Content-Type to application/json', () => {
    const res = jsonResponse({ ok: true });
    expect(res.headers.get('Content-Type')).toBe('application/json');
  });

  test('includes CORS header Access-Control-Allow-Origin *', () => {
    const res = jsonResponse({ ok: true });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  test('body is JSON-stringified data', async () => {
    const data = { foo: 'bar', num: 42 };
    const res = jsonResponse(data);
    const text = await res.text();
    expect(text).toBe(JSON.stringify(data));
  });
});

// ---------------------------------------------------------------------------
// handleCors
// ---------------------------------------------------------------------------
describe('handleCors', () => {
  test('returns status 204', () => {
    const res = handleCors();
    expect(res.status).toBe(204);
  });

  test('includes all CORS headers', () => {
    const res = handleCors();
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Access-Control-Allow-Methods')).toBe('GET, POST, OPTIONS');
    expect(res.headers.get('Access-Control-Allow-Headers')).toBe('Content-Type');
  });

  test('body is null', async () => {
    const res = handleCors();
    const body = await res.text();
    expect(body).toBe('');
  });
});
