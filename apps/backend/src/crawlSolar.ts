#!/usr/bin/env bun
/**
 * CLI script to run the solar panel leaderboard crawl.
 * Usage: bun run src/crawlSolar.ts [--countries US,DE,AU,UK] [--max-pages 3000]
 */

import { crawlSolarLeaderboard, saveLeaderboard } from './solarCrawler';
import type { Country } from '../../../shared/types';

// ============================================================================
// ARGUMENT PARSING
// ============================================================================

const VALID_COUNTRIES: Country[] = ['US', 'CA', 'UK', 'DE', 'FR', 'ES', 'IT', 'NL', 'SE', 'AU', 'NZ', 'IE', 'JP', 'SG'];

function parseArgs(): { countries: Country[]; maxPages: number } {
  const args = process.argv.slice(2);
  let countries: Country[] = ['US', 'CA', 'UK', 'DE', 'AU', 'FR', 'NL', 'JP'];
  let maxPages = 3000;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--countries' && args[i + 1]) {
      const raw = args[i + 1].split(',').map(c => c.trim().toUpperCase());
      const validated = raw.filter((c): c is Country => VALID_COUNTRIES.includes(c as Country));
      if (validated.length > 0) {
        countries = validated;
      } else {
        console.warn(`[CLI] No valid countries in "${args[i + 1]}", using defaults`);
      }
      i++;
    } else if (args[i] === '--max-pages' && args[i + 1]) {
      const n = parseInt(args[i + 1], 10);
      if (!isNaN(n) && n > 0) {
        maxPages = n;
      } else {
        console.warn(`[CLI] Invalid --max-pages "${args[i + 1]}", using default ${maxPages}`);
      }
      i++;
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`
Solar Panel Leaderboard Crawler
================================
Usage: bun run src/crawlSolar.ts [options]

Options:
  --countries US,DE,AU,UK   Comma-separated country codes (default: US,CA,UK,DE,AU,FR,NL,JP)
  --max-pages 3000          Maximum pages to crawl (default: 3000)
  --help                    Show this help message

Valid countries: ${VALID_COUNTRIES.join(', ')}

Examples:
  bun run src/crawlSolar.ts
  bun run src/crawlSolar.ts --countries US,DE --max-pages 500
  bun run src/crawlSolar.ts --countries AU,NZ --max-pages 1000
`);
      process.exit(0);
    }
  }

  return { countries, maxPages };
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  const { countries, maxPages } = parseArgs();

  console.log(`
========================================
  Solar Panel Leaderboard Crawler
========================================
  Countries: ${countries.join(', ')}
  Max pages: ${maxPages}
  Started:   ${new Date().toISOString()}
========================================
`);

  const startTime = Date.now();

  try {
    const leaderboard = await crawlSolarLeaderboard({
      countries,
      maxTotalPages: maxPages,
      onProgress: (progress) => {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`[${elapsed}s] [${progress.stage}] ${progress.message}`);
        if (progress.detail) {
          console.log(`         ${progress.detail}`);
        }
      },
    });

    // Save results
    saveLeaderboard(leaderboard);

    // Print summary
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`
========================================
  Crawl Complete
========================================
  Duration:          ${duration}s
  Pages crawled:     ${leaderboard.metadata.totalCrawled}
  Panels extracted:  ${leaderboard.metadata.totalExtracted}
  After filtering:   ${leaderboard.metadata.totalAfterFiltering}
  Vendors found:     ${leaderboard.metadata.vendorsCrawled.length}
  Countries:         ${leaderboard.metadata.countriesCrawled.join(', ')}
========================================
`);

    if (leaderboard.results.length > 0) {
      const top = leaderboard.results[0];
      console.log(`  Top result:`);
      console.log(`    ${top.title}`);
      console.log(`    ${top.specs.wattage}W | $${top.pricePerWattUsd.toFixed(3)}/W | ${top.currency} ${top.price}`);
      console.log(`    ${top.vendor} (${top.country})`);
      console.log(`    ${top.url}`);
      console.log();
    }
  } catch (error) {
    console.error('[CLI] Fatal error:', error);
    process.exit(1);
  }
}

main();
