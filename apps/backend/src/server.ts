/**
 * Deep Deal Finder - Backend Server
 *
 * A Bun-native server that handles product price searching
 * through web scraping (no external APIs).
 *
 * Supports multiple product categories:
 * - Supplements
 * - Building products
 * - Robotics parts
 *
 * Endpoints:
 * - POST /search - Search for product deals
 * - GET /solar/leaderboard - Solar panel leaderboard
 * - GET /health - Health check
 */

import { searchSupplementsDeep, type SearchProgress, type SearchDepth, SEARCH_DEPTHS } from './scraper';
import type { SearchRequest, SearchResponse, ProductResult, ProductCategory, Country } from '../../../shared/types';

// Valid categories, countries, and depths for validation
const VALID_CATEGORIES: ProductCategory[] = ['supplements', 'building', 'robotics'];
const VALID_COUNTRIES: Country[] = ['US', 'CA', 'UK', 'DE', 'FR', 'ES', 'IT', 'NL', 'SE', 'AU', 'NZ', 'IE', 'JP', 'SG'];
const VALID_DEPTHS: SearchDepth[] = ['quick', 'normal', 'deep', 'exhaustive'];

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3001;

// In-memory cache for solar leaderboard
let solarLeaderboardCache: { data: any; loadedAt: number } | null = null;
const SOLAR_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Load solar leaderboard data from disk with caching
 */
async function loadSolarLeaderboard(): Promise<any | null> {
  const now = Date.now();
  if (solarLeaderboardCache && (now - solarLeaderboardCache.loadedAt) < SOLAR_CACHE_TTL) {
    return solarLeaderboardCache.data;
  }
  try {
    const dir = import.meta.dir;
    const path = `${dir}/../data/solar-leaderboard.json`;
    const file = Bun.file(path);
    if (!(await file.exists())) return null;
    const data = await file.json();
    solarLeaderboardCache = { data, loadedAt: now };
    return data;
  } catch {
    return null;
  }
}

// CORS headers for frontend access
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

/**
 * Create JSON response with proper headers
 */
function jsonResponse(data: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders,
    },
  });
}

/**
 * Handle CORS preflight requests
 */
function handleCors(): Response {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
}

/**
 * Validate search request
 */
function validateSearchRequest(body: unknown): {
  valid: true;
  query: string;
  category: ProductCategory;
  countries: Country[];
  depth: SearchDepth;
} | { valid: false; error: string } {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: 'Request body must be a JSON object' };
  }

  const { query, category, countries, depth } = body as SearchRequest & { depth?: SearchDepth };

  if (!query || typeof query !== 'string') {
    return { valid: false, error: 'Query must be a non-empty string' };
  }

  const trimmed = query.trim();
  if (trimmed.length < 2) {
    return { valid: false, error: 'Query must be at least 2 characters' };
  }

  if (trimmed.length > 200) {
    return { valid: false, error: 'Query must be less than 200 characters' };
  }

  // Validate category (default to supplements)
  const validatedCategory: ProductCategory = category && VALID_CATEGORIES.includes(category)
    ? category
    : 'supplements';

  // Validate countries (default to US)
  let validatedCountries: Country[] = ['US'];
  if (countries && Array.isArray(countries) && countries.length > 0) {
    validatedCountries = countries.filter((c): c is Country => VALID_COUNTRIES.includes(c as Country));
    if (validatedCountries.length === 0) {
      validatedCountries = ['US'];
    }
  }

  // Validate depth (default to normal)
  const validatedDepth: SearchDepth = depth && VALID_DEPTHS.includes(depth)
    ? depth
    : 'normal';

  return {
    valid: true,
    query: trimmed,
    category: validatedCategory,
    countries: validatedCountries,
    depth: validatedDepth,
  };
}

/**
 * Handle streaming search endpoint with Server-Sent Events (SSE)
 */
async function handleStreamingSearch(request: Request): Promise<Response> {
  const startTime = Date.now();

  try {
    const body = await request.json();
    const validation = validateSearchRequest(body);

    if (!validation.valid) {
      return jsonResponse({ error: validation.error }, 400);
    }

    const { query, category, countries, depth } = validation;
    const depthConfig = SEARCH_DEPTHS[depth];
    console.log(`[Server] Starting ${depth} streaming search: "${query}" (${category}, ${countries.join(',')}) - max ${depthConfig.maxUrls} URLs`);

    // Create a ReadableStream for SSE
    let streamClosed = false;

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();

        // Helper to send SSE events (with guard for closed stream)
        const sendEvent = (event: string, data: unknown) => {
          if (streamClosed) return;
          try {
            controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
          } catch {
            // Stream was closed, ignore
            streamClosed = true;
          }
        };

        try {
          // Send initial event
          sendEvent('progress', {
            stage: 'starting',
            message: `Starting ${depth} search...`,
            elapsedMs: 0,
          });

          // Perform the deep search with progress callback and depth
          const results = await searchSupplementsDeep(query, (progress) => {
            sendEvent('progress', progress);
          }, category, countries, depth);

          // Find best deal
          let bestDeal: ProductResult | null = null;
          if (results.length > 0) {
            const highConfidence = results.filter((r) => r.confidence >= 0.7);
            bestDeal = highConfidence.length > 0 ? highConfidence[0] : results[0];
          }

          // Send final results
          const response: SearchResponse = {
            query,
            category,
            countries,
            results,
            best_deal: bestDeal,
            timestamp: new Date().toISOString(),
            search_time_ms: Date.now() - startTime,
          };

          sendEvent('complete', response);
          console.log(`[Server] Streaming search completed in ${response.search_time_ms}ms with ${results.length} results`);

        } catch (error) {
          console.error('[Server] Streaming search error:', error);
          sendEvent('error', {
            error: 'Search failed',
            message: error instanceof Error ? error.message : 'Unknown error',
          });
        } finally {
          if (!streamClosed) {
            streamClosed = true;
            controller.close();
          }
        }
      },
      cancel() {
        streamClosed = true;
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        ...corsHeaders,
      },
    });
  } catch (error) {
    console.error('[Server] Search error:', error);
    return jsonResponse(
      {
        error: 'Search failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
}

/**
 * Handle search endpoint (non-streaming, kept for backwards compatibility)
 */
async function handleSearch(request: Request): Promise<Response> {
  const startTime = Date.now();

  try {
    const body = await request.json();
    const validation = validateSearchRequest(body);

    if (!validation.valid) {
      return jsonResponse({ error: validation.error }, 400);
    }

    const { query, category, countries, depth } = validation;
    console.log(`[Server] Processing ${depth} search: "${query}" (${category}, ${countries.join(',')})`);

    // Perform the search with depth parameter
    const results = await searchSupplementsDeep(query, undefined, category, countries, depth);

    // Find best deal (lowest price per unit with good confidence)
    let bestDeal: ProductResult | null = null;
    if (results.length > 0) {
      // Filter high-confidence results for best deal
      const highConfidence = results.filter((r) => r.confidence >= 0.7);
      bestDeal = highConfidence.length > 0 ? highConfidence[0] : results[0];
    }

    const response: SearchResponse = {
      query,
      category,
      countries,
      results,
      best_deal: bestDeal,
      timestamp: new Date().toISOString(),
      search_time_ms: Date.now() - startTime,
    };

    console.log(`[Server] Search completed in ${response.search_time_ms}ms with ${results.length} results`);

    return jsonResponse(response);
  } catch (error) {
    console.error('[Server] Search error:', error);
    return jsonResponse(
      {
        error: 'Search failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
}

/**
 * Handle solar panel leaderboard endpoint
 */
async function handleSolarLeaderboard(request: Request): Promise<Response> {
  const leaderboard = await loadSolarLeaderboard();

  if (!leaderboard) {
    return jsonResponse(
      { error: 'Solar leaderboard not yet generated. Run: bun run crawl:solar' },
      404
    );
  }

  const url = new URL(request.url);
  const params = url.searchParams;

  // Parse query parameters
  const countryFilter = params.get('country')?.split(',').map(c => c.trim().toUpperCase()).filter(Boolean) ?? null;
  const minWatt = params.get('minWatt') ? Number(params.get('minWatt')) : null;
  const maxWatt = params.get('maxWatt') ? Number(params.get('maxWatt')) : null;
  const typeFilter = params.get('type') ?? null;
  const sort = params.get('sort') ?? 'pricePerWatt';
  const limit = Math.min(Math.max(1, Number(params.get('limit')) || 50), 200);
  const offset = Math.max(0, Number(params.get('offset')) || 0);

  let results: any[] = Array.isArray(leaderboard.results) ? [...leaderboard.results] : [];

  // Apply filters
  if (countryFilter) {
    results = results.filter((r: any) => countryFilter.includes(r.country?.toUpperCase()));
  }
  if (minWatt !== null && !isNaN(minWatt)) {
    results = results.filter((r: any) => (r.wattage ?? 0) >= minWatt);
  }
  if (maxWatt !== null && !isNaN(maxWatt)) {
    results = results.filter((r: any) => (r.wattage ?? 0) <= maxWatt);
  }
  if (typeFilter) {
    results = results.filter((r: any) =>
      r.type?.toLowerCase() === typeFilter.toLowerCase()
    );
  }

  // Apply sort
  const sortField = ['pricePerWatt', 'price', 'wattage', 'efficiency'].includes(sort) ? sort : 'pricePerWatt';
  results.sort((a: any, b: any) => {
    const aVal = a[sortField] ?? Infinity;
    const bVal = b[sortField] ?? Infinity;
    return aVal - bVal;
  });

  const total = results.length;

  // Apply pagination
  results = results.slice(offset, offset + limit);

  return jsonResponse({
    results,
    metadata: leaderboard.metadata ?? {},
    pagination: {
      total,
      limit,
      offset,
      hasMore: offset + limit < total,
    },
  });
}

/**
 * Main request router
 */
async function handleRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const { pathname } = url;
  const method = request.method;

  // Handle CORS preflight
  if (method === 'OPTIONS') {
    return handleCors();
  }

  // Route requests
  switch (pathname) {
    case '/search':
      if (method === 'POST') {
        return handleSearch(request);
      }
      return jsonResponse({ error: 'Method not allowed' }, 405);

    case '/search/stream':
      if (method === 'POST') {
        return handleStreamingSearch(request);
      }
      return jsonResponse({ error: 'Method not allowed' }, 405);

    case '/solar/leaderboard':
      if (method === 'GET') {
        return handleSolarLeaderboard(request);
      }
      return jsonResponse({ error: 'Method not allowed' }, 405);

    case '/health':
      return jsonResponse({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: '1.0.0',
      });

    case '/':
      return jsonResponse({
        name: 'Deep Deal Finder API',
        version: '2.0.0',
        endpoints: {
          'POST /search': 'Search for product deals',
          'POST /search/stream': 'Search with SSE progress updates',
          'GET /solar/leaderboard': 'Solar panel leaderboard with filtering and pagination',
          'GET /health': 'Health check',
        },
        categories: VALID_CATEGORIES,
        countries: VALID_COUNTRIES,
        depths: VALID_DEPTHS,
        depthConfig: SEARCH_DEPTHS,
      });

    default:
      return jsonResponse({ error: 'Not found' }, 404);
  }
}

// Start the server
const server = Bun.serve({
  port: PORT,
  fetch: handleRequest,
  idleTimeout: 120, // 2 minutes for long-running searches
});

console.log(`
╔════════════════════════════════════════════════╗
║   Deep Deal Finder API                         ║
║   Running on http://localhost:${PORT}            ║
║   Categories: supplements, building, robotics  ║
╚════════════════════════════════════════════════╝
`);

export default server;

// === EXPORTS FOR TESTING ===
export const _testing = { validateSearchRequest, jsonResponse, handleCors, handleSolarLeaderboard, loadSolarLeaderboard, solarLeaderboardCache: () => solarLeaderboardCache, clearSolarCache: () => { solarLeaderboardCache = null; } };
