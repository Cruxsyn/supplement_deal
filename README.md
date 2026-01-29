# Supplement Deal Finder

A tool for truth, not marketing. A quiet, ancient ledger of fair prices.

Find the best supplement deals by searching public web pages directly - no APIs, no affiliate links, no tracking.

## Features

- Search for any supplement with quantity (e.g., "Creatine Monohydrate 500g")
- Scrapes search engines (DuckDuckGo, Bing) for product listings
- Extracts prices and quantities using heuristic patterns
- Normalizes cost per unit for fair comparison
- Ranks results by best value
- Clean, calm interface with matte "Warm Ancient" aesthetic

## How It Works

### Search Strategy

The system uses a multi-step approach without relying on any external APIs:

1. **Query Generation**: Your search term is expanded into multiple search queries:
   - `{supplement} buy price -review -blog`
   - `{supplement} supplement shop`
   - `{supplement} "add to cart"`

2. **Search Engine Scraping**: Queries are sent to DuckDuckGo HTML and Bing:
   - Parses HTML responses directly
   - Extracts product URLs from search results
   - Filters out non-product pages (Wikipedia, Reddit, etc.)

3. **Product Page Crawling**: Each URL is fetched and analyzed:
   - Respects rate limits with randomized delays
   - Uses rotating user agents
   - Parallel fetching with concurrency limits

### Data Extraction (Heuristics)

No hardcoded selectors - the system uses pattern matching:

**Price Extraction Priority:**
1. JSON-LD structured data (schema.org Product type)
2. Meta tags (`product:price:amount`, etc.)
3. Elements with price-related classes/attributes
4. Currency pattern matching in visible text

**Quantity Extraction:**
1. Parse from product title (most reliable)
2. Meta description
3. Product detail areas
4. Handles formats: "500g", "1.5 kg", "2 lbs", "100 capsules", "120 x 500mg"

**Normalization:**
- Converts all weights to grams (kg, lb, oz → g)
- Calculates price per gram or per unit (capsules/tablets)
- Rejects results with unclear quantities

### Ranking Algorithm

Results are ranked by **value**, not raw price:

1. **Primary sort**: Lowest price per unit
2. **Confidence scoring** (0-1) based on:
   - Price clarity
   - Quantity parsed successfully
   - Known unit types
   - Title quality

Low-confidence results (< 0.5) are filtered out.

## Project Structure

```
/apps
  /frontend        → Vite + Vanilla TS SPA
  /backend         → Bun server
/shared
  /types          → Shared TypeScript types
  /utils          → Shared utilities (parsing, normalization)
```

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) (v1.0+)
- Node.js (v18+) for frontend tooling

### Installing Bun

**Windows (PowerShell):**
```powershell
irm bun.sh/install.ps1 | iex
```

**macOS/Linux:**
```bash
curl -fsSL https://bun.sh/install | bash
```

After installation, restart your terminal to ensure Bun is in your PATH.

### Installation

```bash
# Install root dependencies
npm install

# Install frontend dependencies
cd apps/frontend && npm install

# Install backend dependencies
cd apps/backend && bun install
```

### Development

```bash
# Run both frontend and backend (from root)
npm run dev

# Or run separately:
# Terminal 1 - Backend (port 3001)
cd apps/backend && bun run dev

# Terminal 2 - Frontend (port 3000)
cd apps/frontend && npm run dev
```

Visit `http://localhost:3000` to use the application.

### Production Build

```bash
# Build frontend
npm run build

# Start backend
npm run start
```

## API Reference

### POST /search

Search for supplement deals.

**Request:**
```json
{
  "query": "creatine monohydrate 500g"
}
```

**Response:**
```json
{
  "query": "creatine monohydrate 500g",
  "results": [
    {
      "title": "Brand Name Creatine Monohydrate",
      "price": 19.99,
      "currency": "USD",
      "quantity": 500,
      "unit": "g",
      "price_per_unit": 0.0399,
      "vendor": "example.com",
      "url": "https://example.com/product",
      "confidence": 0.92
    }
  ],
  "best_deal": { ... },
  "timestamp": "2024-01-15T10:30:00.000Z",
  "search_time_ms": 5432
}
```

### GET /health

Health check endpoint.

```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "version": "1.0.0"
}
```

## Known Limitations

1. **Search Engine Blocks**: Search engines may rate-limit or block scraping after many requests. The system uses delays and user-agent rotation to minimize this.

2. **Dynamic Content**: Pages that require JavaScript to render prices won't be scraped correctly. The system only parses static HTML.

3. **Price Accuracy**: Prices may change between scraping and viewing. Always verify on the actual product page before purchasing.

4. **Regional Pricing**: Results may vary by region. The system doesn't handle geographic price differences.

5. **Quantity Parsing**: Some products have complex quantity formats that may not parse correctly (e.g., "2-pack of 250g" might only capture one value).

6. **Currency Conversion**: The system doesn't convert currencies. Results in different currencies are sorted by their raw price-per-unit values.

## Example Results

**Query**: "Creatine Monohydrate 500g"

```json
{
  "query": "creatine monohydrate 500g",
  "results": [
    {
      "title": "Pure Creatine Monohydrate Powder 500g",
      "price": 14.99,
      "currency": "USD",
      "quantity": 500,
      "unit": "g",
      "price_per_unit": 0.0300,
      "vendor": "bulksupplements.com",
      "url": "https://...",
      "confidence": 0.95
    },
    {
      "title": "Optimum Nutrition Micronized Creatine 600g",
      "price": 22.99,
      "currency": "USD",
      "quantity": 600,
      "unit": "g",
      "price_per_unit": 0.0383,
      "vendor": "amazon.com",
      "url": "https://...",
      "confidence": 0.88
    },
    {
      "title": "MyProtein Creatine Monohydrate 500g",
      "price": 18.49,
      "currency": "GBP",
      "quantity": 500,
      "unit": "g",
      "price_per_unit": 0.0370,
      "vendor": "myprotein.com",
      "url": "https://...",
      "confidence": 0.91
    }
  ],
  "best_deal": {
    "title": "Pure Creatine Monohydrate Powder 500g",
    "price": 14.99,
    "currency": "USD",
    "quantity": 500,
    "unit": "g",
    "price_per_unit": 0.0300,
    "vendor": "bulksupplements.com",
    "url": "https://...",
    "confidence": 0.95
  },
  "timestamp": "2024-01-15T10:30:00.000Z",
  "search_time_ms": 8234
}
```

## Design Philosophy

This is a tool for truth, not marketing.

- **No APIs**: We scrape public HTML directly. No Google Shopping API, no affiliate networks.
- **No Tracking**: No analytics, no user accounts, no cookies.
- **No Ads**: Clean interface, no sponsored results.
- **Honest Ranking**: Sorted by value (price per unit), not by commission rates.
- **Calm Aesthetic**: Warm, ancient, timeless. Like a ledger from a trusted merchant.

## License

MIT
