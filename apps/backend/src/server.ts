/**
 * Supplement Deal Finder - Backend Server
 *
 * A Bun-native server that handles supplement price searching
 * through web scraping (no external APIs).
 *
 * Endpoints:
 * - POST /search - Search for supplement deals
 * - GET /health - Health check
 */

import { searchSupplementsDeep, type SearchProgress } from './scraper';
import type { SearchRequest, SearchResponse, ProductResult } from '../../../shared/types';

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3001;

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
function validateSearchRequest(body: unknown): { valid: true; query: string } | { valid: false; error: string } {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: 'Request body must be a JSON object' };
  }

  const { query } = body as SearchRequest;

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

  return { valid: true, query: trimmed };
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

    console.log(`[Server] Starting streaming search: "${validation.query}"`);

    // Create a ReadableStream for SSE
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();

        // Helper to send SSE events
        const sendEvent = (event: string, data: unknown) => {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        };

        try {
          // Send initial event
          sendEvent('progress', {
            stage: 'starting',
            message: 'Starting deep search...',
            elapsedMs: 0,
          });

          // Perform the deep search with progress callback
          const results = await searchSupplementsDeep(validation.query, (progress) => {
            sendEvent('progress', progress);
          });

          // Find best deal
          let bestDeal: ProductResult | null = null;
          if (results.length > 0) {
            const highConfidence = results.filter((r) => r.confidence >= 0.7);
            bestDeal = highConfidence.length > 0 ? highConfidence[0] : results[0];
          }

          // Send final results
          const response: SearchResponse = {
            query: validation.query,
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
          controller.close();
        }
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

    console.log(`[Server] Processing search: "${validation.query}"`);

    // Perform the search
    const results = await searchSupplementsDeep(validation.query);

    // Find best deal (lowest price per unit with good confidence)
    let bestDeal: ProductResult | null = null;
    if (results.length > 0) {
      // Filter high-confidence results for best deal
      const highConfidence = results.filter((r) => r.confidence >= 0.7);
      bestDeal = highConfidence.length > 0 ? highConfidence[0] : results[0];
    }

    const response: SearchResponse = {
      query: validation.query,
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

    case '/health':
      return jsonResponse({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: '1.0.0',
      });

    case '/':
      return jsonResponse({
        name: 'Supplement Deal Finder API',
        version: '1.0.0',
        endpoints: {
          'POST /search': 'Search for supplement deals',
          'GET /health': 'Health check',
        },
      });

    default:
      return jsonResponse({ error: 'Not found' }, 404);
  }
}

// Start the server
const server = Bun.serve({
  port: PORT,
  fetch: handleRequest,
});

console.log(`
╔════════════════════════════════════════════════╗
║   Supplement Deal Finder API                   ║
║   Running on http://localhost:${PORT}            ║
╚════════════════════════════════════════════════╝
`);

export default server;
