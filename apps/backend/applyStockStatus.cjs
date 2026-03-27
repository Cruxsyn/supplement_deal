const fs = require('fs');

// Load current leaderboard
const lb = JSON.parse(fs.readFileSync('data/solar-leaderboard.json', 'utf-8'));
console.log(`Leaderboard has ${lb.results.length} products`);

// Collect all stock results
const stockMap = {};
const stockFiles = fs.readdirSync('data').filter(f => f.startsWith('stock-results-') && f.endsWith('.json'));
console.log(`Found ${stockFiles.length} stock result files`);

for (const file of stockFiles) {
  try {
    const data = JSON.parse(fs.readFileSync('data/' + file, 'utf-8'));
    const results = data.results || data;
    let count = 0;
    for (const [url, status] of Object.entries(results)) {
      if (status && status !== 'unknown') {
        stockMap[url] = status;
        count++;
      }
    }
    console.log(`  ${file}: ${count} status entries (${Object.keys(results).length} total)`);
  } catch (e) {
    console.log(`  Skipping ${file}: ${e.message}`);
  }
}

console.log(`\nTotal stock statuses: ${Object.keys(stockMap).length}`);

// Apply to leaderboard
let inStock = 0, outOfStock = 0, unknown = 0;
for (const result of lb.results) {
  const status = stockMap[result.url];
  if (status === 'in-stock' || status === 'in_stock') {
    result.stockStatus = 'in-stock';
    inStock++;
  } else if (status === 'out-of-stock' || status === 'out_of_stock' || status === 'out-of-stock') {
    result.stockStatus = 'out-of-stock';
    outOfStock++;
  } else {
    result.stockStatus = 'unknown';
    unknown++;
  }
}

console.log(`\nApplied stock status:`);
console.log(`  In stock: ${inStock}`);
console.log(`  Out of stock: ${outOfStock}`);
console.log(`  Unknown: ${unknown}`);

// Save updated leaderboard
fs.writeFileSync('data/solar-leaderboard.json', JSON.stringify(lb, null, 2));
console.log(`\nSaved updated leaderboard with stock status`);
