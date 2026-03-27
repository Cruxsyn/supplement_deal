import { describe, test, expect, mock } from 'bun:test';

// Mock scraper before importing server
mock.module('../../src/scraper', () => ({
  searchSupplementsDeep: async (query: string, onProgress?: Function, category?: string, countries?: string[], depth?: string) => {
    if (onProgress) {
      onProgress({ stage: 'searching', message: 'Searching engines...', searchEnginesQueried: 1, totalSearchEngines: 3 });
      onProgress({ stage: 'crawling', message: 'Crawling pages...', urlsCrawled: 5, totalUrlsToCrawl: 10 });
      onProgress({ stage: 'extracting', message: 'Extracting data...', productsExtracted: 3 });
      onProgress({ stage: 'ranking', message: 'Ranking results...' });
    }
    return [{
      title: 'Test Product 500g',
      price: 24.99,
      currency: 'USD',
      quantity: 500,
      unit: 'g',
      price_per_unit: 0.0498,
      vendor: 'testvendor.com',
      url: 'https://testvendor.com/product',
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

async function parseSSEEvents(response: Response): Promise<Array<{ event: string; data: any }>> {
  const text = await response.text();
  const events: Array<{ event: string; data: any }> = [];
  const rawEvents = text.split('\n\n').filter(Boolean);
  for (const raw of rawEvents) {
    const eventMatch = raw.match(/^event: (.+)$/m);
    const dataMatch = raw.match(/^data: (.+)$/m);
    if (eventMatch && dataMatch) {
      events.push({ event: eventMatch[1], data: JSON.parse(dataMatch[1]) });
    }
  }
  return events;
}

function makeStreamRequest(body: Record<string, unknown>): Request {
  return new Request('http://localhost:3001/search/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('SSE Streaming Endpoint (POST /search/stream)', () => {
  const validBody = { query: 'creatine', category: 'supplements', countries: ['US'], depth: 'normal' };

  test('returns Content-Type text/event-stream', async () => {
    const response = await server.fetch(makeStreamRequest(validBody));
    expect(response.headers.get('Content-Type')).toBe('text/event-stream');
    await response.text(); // consume body
  });

  test('returns Cache-Control no-cache', async () => {
    const response = await server.fetch(makeStreamRequest(validBody));
    expect(response.headers.get('Cache-Control')).toBe('no-cache');
    await response.text();
  });

  test('returns Connection keep-alive', async () => {
    const response = await server.fetch(makeStreamRequest(validBody));
    expect(response.headers.get('Connection')).toBe('keep-alive');
    await response.text();
  });

  test('includes CORS headers', async () => {
    const response = await server.fetch(makeStreamRequest(validBody));
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    await response.text();
  });

  test('first event is progress with stage starting', async () => {
    const response = await server.fetch(makeStreamRequest(validBody));
    const events = await parseSSEEvents(response);
    expect(events.length).toBeGreaterThan(0);
    expect(events[0].event).toBe('progress');
    expect(events[0].data.stage).toBe('starting');
  });

  test('sends multiple progress events during search', async () => {
    const response = await server.fetch(makeStreamRequest(validBody));
    const events = await parseSSEEvents(response);
    const progressEvents = events.filter(e => e.event === 'progress');
    // At least the initial 'starting' event plus the 4 mock progress callbacks
    expect(progressEvents.length).toBeGreaterThanOrEqual(5);
  });

  test('last event is complete with full SearchResponse shape', async () => {
    const response = await server.fetch(makeStreamRequest(validBody));
    const events = await parseSSEEvents(response);
    const lastEvent = events[events.length - 1];
    expect(lastEvent.event).toBe('complete');
    expect(lastEvent.data).toHaveProperty('query');
    expect(lastEvent.data).toHaveProperty('category');
    expect(lastEvent.data).toHaveProperty('countries');
    expect(lastEvent.data).toHaveProperty('results');
    expect(lastEvent.data).toHaveProperty('best_deal');
    expect(lastEvent.data).toHaveProperty('timestamp');
    expect(lastEvent.data).toHaveProperty('search_time_ms');
  });

  test('complete event results array is not empty', async () => {
    const response = await server.fetch(makeStreamRequest(validBody));
    const events = await parseSSEEvents(response);
    const completeEvent = events.find(e => e.event === 'complete');
    expect(completeEvent).toBeDefined();
    expect(completeEvent!.data.results.length).toBeGreaterThan(0);
  });

  test('complete event has best_deal when results exist', async () => {
    const response = await server.fetch(makeStreamRequest(validBody));
    const events = await parseSSEEvents(response);
    const completeEvent = events.find(e => e.event === 'complete');
    expect(completeEvent).toBeDefined();
    expect(completeEvent!.data.best_deal).not.toBeNull();
    expect(completeEvent!.data.best_deal).toHaveProperty('title');
    expect(completeEvent!.data.best_deal).toHaveProperty('price');
  });

  test('returns 400 JSON for missing query', async () => {
    const response = await server.fetch(makeStreamRequest({ category: 'supplements' }));
    expect(response.status).toBe(400);
    const contentType = response.headers.get('Content-Type');
    expect(contentType).toContain('application/json');
    const body = await response.json();
    expect(body).toHaveProperty('error');
  });

  test('returns 400 for empty query', async () => {
    const response = await server.fetch(makeStreamRequest({ query: '' }));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toHaveProperty('error');
  });

  test('progress events include stage field', async () => {
    const response = await server.fetch(makeStreamRequest(validBody));
    const events = await parseSSEEvents(response);
    const progressEvents = events.filter(e => e.event === 'progress');
    for (const event of progressEvents) {
      expect(event.data).toHaveProperty('stage');
      expect(typeof event.data.stage).toBe('string');
    }
  });
});
