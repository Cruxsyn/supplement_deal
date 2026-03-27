const fs = require('fs');

// All Chrome-extracted products (verified real product pages)
const products = [
  // SanTan Solar (verified with Chrome)
  {title:'Used SSG 250W Poly Solar Panel',price:50,wattage:250,panelType:'polycrystalline',vendor:'santansolar.com',country:'US',currency:'USD',url:'https://www.santansolar.com/product/blemished-ssg-series-250w-solar-panel/'},
  {title:'Used SST 250W Poly Solar Panel',price:40,wattage:250,panelType:'polycrystalline',vendor:'santansolar.com',country:'US',currency:'USD',url:'https://www.santansolar.com/product/santan-250w-solar-panel-snail-trails/'},
  {title:'SSM 560W Mono Bifacial Grade B',price:155,wattage:560,panelType:'monocrystalline',vendor:'santansolar.com',country:'US',currency:'USD',url:'https://www.santansolar.com/product/santan-solar-ssm-560w-mono-bifacial-solar-panel-grade-b/'},
  {title:'Used SSG 250W Cracked Vinyl',price:55,wattage:250,panelType:'polycrystalline',vendor:'santansolar.com',country:'US',currency:'USD',url:'https://www.santansolar.com/product/used-ssg-250w-solar-panels-cracked-vinyl/'},
  {title:'Used Trina 230W Solar Panel',price:58,wattage:230,panelType:'monocrystalline',vendor:'santansolar.com',country:'US',currency:'USD',url:'https://www.santansolar.com/product/used-trina-230w-solar-panel/'},
  {title:'Used SunPower 327W Solar Panel',price:99,wattage:327,panelType:'monocrystalline',vendor:'santansolar.com',country:'US',currency:'USD',url:'https://www.santansolar.com/product/used-sunpower-327w-solar-panel-silver-framed/'},
  {title:'Alexus 550W Mono Solar Panel',price:198,wattage:550,panelType:'monocrystalline',vendor:'santansolar.com',country:'US',currency:'USD',url:'https://www.santansolar.com/product/alexus-solar-550w-144-half-cell-solar-panel/'},
  {title:'Used CSUN 320W Poly Solar Panel',price:75,wattage:320,panelType:'polycrystalline',vendor:'santansolar.com',country:'US',currency:'USD',url:'https://www.santansolar.com/product/used-csun-320w-72-cell-poly-solar-panel/'},
  {title:'Philadelphia Solar 440W Bifacial',price:199,wattage:440,panelType:'bifacial',vendor:'santansolar.com',country:'US',currency:'USD',url:'https://www.santansolar.com/product/new-philadelphia-solar-440w-bifacial-solar-panel/'},
  {title:'Used LG 360W Mono Solar Panel',price:90,wattage:360,panelType:'monocrystalline',vendor:'santansolar.com',country:'US',currency:'USD',url:'https://www.santansolar.com/product/used-lg-360w-72-cell-mono-solar-panel/'},
  {title:'Philadelphia Solar 450W Bifacial',price:199,wattage:450,panelType:'bifacial',vendor:'santansolar.com',country:'US',currency:'USD',url:'https://www.santansolar.com/product/new-philadelphia-solar-mono-450w-108-half-cell-bifacial-solar-panel/'},
  {title:'Canadian Solar 395W Mono',price:149,wattage:395,panelType:'monocrystalline',vendor:'santansolar.com',country:'US',currency:'USD',url:'https://www.santansolar.com/product/new-canadian-solar-395w-mono-solar-panel/'},
  {title:'Alexus Solar 400W Mono Panel',price:145,wattage:400,panelType:'monocrystalline',vendor:'santansolar.com',country:'US',currency:'USD',url:'https://www.santansolar.com/product/alexus-solar-400w-mono-solar-panel/'},
  // Signature Solar (verified with Chrome)
  {title:'URE Peach 390W Solar Panel',price:113,wattage:390,panelType:'monocrystalline',vendor:'signaturesolar.com',country:'US',currency:'USD',url:'https://signaturesolar.com/ure-peach-390w-solar-panel/'},
  {title:'Peimar 450W Mono PERC Solar Panel',price:157.5,wattage:450,panelType:'monocrystalline',vendor:'signaturesolar.com',country:'US',currency:'USD',url:'https://signaturesolar.com/peimar-450w-mono-perc-solar-panel/'},
  {title:'ZnShine 440W Bifacial Solar Panel',price:167.2,wattage:440,panelType:'bifacial',vendor:'signaturesolar.com',country:'US',currency:'USD',url:'https://signaturesolar.com/znshine-440w-bifacial-solar-panel/'},
  {title:'CW Energy 450W Monofacial Panel',price:191.25,wattage:450,panelType:'monocrystalline',vendor:'signaturesolar.com',country:'US',currency:'USD',url:'https://signaturesolar.com/cw-energy-450w-monofacial-solar-panel/'},
  {title:'Lumina SolarSpace 405W Panel',price:166.05,wattage:405,panelType:'monocrystalline',vendor:'signaturesolar.com',country:'US',currency:'USD',url:'https://signaturesolar.com/lumina-solarspace-405w-monofacial-solar-panel/'},
  {title:'ZNShine 550W Bifacial Solar Panel',price:203.5,wattage:550,panelType:'bifacial',vendor:'signaturesolar.com',country:'US',currency:'USD',url:'https://signaturesolar.com/znshine-550w-bifacial-solar-panel/'},
  {title:'Boviet 385W Monofacial Solar Panel',price:115.5,wattage:385,panelType:'monocrystalline',vendor:'signaturesolar.com',country:'US',currency:'USD',url:'https://signaturesolar.com/boviet-385w-monofacial-solar-panel/'},
  {title:'Eco-Worthy 100W Bifacial Panel',price:55,wattage:100,panelType:'bifacial',vendor:'signaturesolar.com',country:'US',currency:'USD',url:'https://signaturesolar.com/eco-worthy-100w-12v-bifacial-solar-panel/'},
  // Renogy (verified with Chrome)
  {title:'Renogy 200W N-Type Solar Panel',price:199.99,wattage:200,panelType:'monocrystalline',vendor:'renogy.com',country:'US',currency:'USD',url:'https://www.renogy.com/collections/solar-panels/products/200w-n-type-high-efficiency-solar-panel'},
  {title:'Renogy 250W Bifacial Solar Panel',price:269.99,wattage:250,panelType:'bifacial',vendor:'renogy.com',country:'US',currency:'USD',url:'https://www.renogy.com/collections/solar-panels/products/renogy-16bb-n-type-250-watt-bifacial-solar-panel'},
  {title:'Renogy 50W Monocrystalline Panel',price:54.99,wattage:50,panelType:'monocrystalline',vendor:'renogy.com',country:'US',currency:'USD',url:'https://www.renogy.com/collections/solar-panels/products/50-watt-12-volt-monocrystalline-solar-panel'},
  {title:'Renogy 200W Flexible Solar Panel',price:309.99,wattage:200,panelType:'monocrystalline',vendor:'renogy.com',country:'US',currency:'USD',url:'https://www.renogy.com/collections/solar-panels/products/200-watt-12-volt-flexible-monocrystalline-solar-panel'},
  {title:'Renogy 100W Flexible Solar Panel',price:139.99,wattage:100,panelType:'monocrystalline',vendor:'renogy.com',country:'US',currency:'USD',url:'https://www.renogy.com/collections/solar-panels/products/100-watt-12-volt-black-division-lightweight-monocrystalline-solar-panel'},
  {title:'Renogy 50W Flexible Solar Panel',price:79.99,wattage:50,panelType:'monocrystalline',vendor:'renogy.com',country:'US',currency:'USD',url:'https://www.renogy.com/collections/solar-panels/products/50-watt-12-volt-flexible-monocrystalline-solar-panel'},
  {title:'Renogy 200W ShadowFlux Panel',price:129.99,wattage:200,panelType:'monocrystalline',vendor:'renogy.com',country:'US',currency:'USD',url:'https://www.renogy.com/collections/solar-panels/products/renogy-200w-shadowflux-anti-shading-n-type-solar-panel'},
];

// Merge with ALL agent-extracted batch files (auto-discover)
const allDataFiles = fs.readdirSync('data').filter(f => f.startsWith('solar-') && f.endsWith('.json') && f !== 'solar-leaderboard.json' && f !== 'solar-vendor-urls.json');
const batchFiles = allDataFiles;
for (const file of batchFiles) {
  const path = 'data/' + file;
  try {
    if (fs.existsSync(path)) {
      const data = JSON.parse(fs.readFileSync(path, 'utf-8'));
      // Collect all product arrays from any structure
      const allProds = [];
      // Handle raw array format: [{...}, {...}]
      if (Array.isArray(data)) {
        allProds.push(...data);
      } else {
        if (data.products) allProds.push(...data.products);
        if (data.panels) allProds.push(...data.panels);
        // Handle nested country keys like {AU: {products: [...]}, CA: {products: [...]}}
        for (const key of Object.keys(data)) {
          if (data[key]?.products && Array.isArray(data[key].products)) {
            allProds.push(...data[key].products);
          }
        }
      }
      if (allProds.length > 0) {
        for (const p of allProds) {
          if (p.wattage && p.price && p.title) {
            // Normalize: some agents use 'source' instead of 'vendor'
            if (!p.vendor && p.source) p.vendor = p.source;
            if (!p.url && p.source) p.url = p.source;
            // Generate unique URL if missing (for dedup)
            if (!p.url) p.url = `https://${p.vendor || 'unknown'}/${encodeURIComponent(p.title).substring(0,80)}`;
            // Ensure price/wattage are numbers
            p.price = typeof p.price === 'string' ? parseFloat(p.price) : p.price;
            p.wattage = typeof p.wattage === 'string' ? parseInt(p.wattage) : p.wattage;
            products.push(p);
          }
        }
        console.log(`Merged ${allProds.length} products from ${file}`);
      }
    }
  } catch (e) {
    console.log(`Skipping ${file}: ${e.message}`);
  }
}

// Build leaderboard results
const seen = new Set();
const results = products
  .filter(p => p.wattage >= 10 && p.wattage <= 1000 && p.price > 0)
  .map(p => {
    // Currency conversion rates to USD
    const rates = { USD:1, EUR:1.08, GBP:1.27, CAD:0.74, AUD:0.65, JPY:0.0067, SGD:0.74, SEK:0.095, NZD:0.61, INR:0.012, BRL:0.18, NOK:0.092, DKK:0.145, PLN:0.25, CHF:1.13, KRW:0.00073, MXN:0.058, ZAR:0.055 };
    const cur = (p.currency || 'USD').toUpperCase();
    const rate = rates[cur] || 1;
    const priceUsd = Math.round(p.price * rate * 100) / 100;
    const ppw = Math.round((p.price / p.wattage) * 1000) / 1000;
    const ppwUsd = Math.round((priceUsd / p.wattage) * 1000) / 1000;
    return {
      title: p.title,
      price: p.price,
      currency: cur,
      priceUsd,
      pricePerWatt: ppw,
      pricePerWattUsd: ppwUsd,
      specs: {
        wattage: p.wattage,
        panelType: p.panelType || 'unknown',
        efficiency: null,
        dimensions: null,
        weightKg: null,
        warranty: null,
        cellCount: null,
        brand: null,
        model: null,
      },
      vendor: p.vendor,
      url: p.url,
      country: p.country || 'US',
      shipping: { cost: null, isFree: false },
      confidence: 0.85,
      lastCrawled: new Date().toISOString(),
    };
  })
  .filter(p => p.pricePerWatt >= 0.10 && p.pricePerWatt <= 3.0)
  .filter(p => {
    // Dedup by URL if it's a real URL, otherwise by title+vendor+wattage
    const isRealUrl = p.url && p.url.startsWith('http') && !p.url.includes(encodeURIComponent(p.title?.substring(0,20) || ''));
    const dedupKey = isRealUrl ? p.url : `${p.vendor}|${p.title}|${p.specs?.wattage || p.wattage}`;
    if (seen.has(dedupKey)) return false;
    seen.add(dedupKey);
    return true;
  })
  .sort((a, b) => a.pricePerWatt - b.pricePerWatt);

const vendors = [...new Set(results.map(r => r.vendor))];
const countries = [...new Set(results.map(r => r.country))];

const leaderboard = {
  results,
  metadata: {
    totalCrawled: products.length,
    totalExtracted: products.length,
    totalAfterFiltering: results.length,
    crawlStarted: new Date().toISOString(),
    crawlCompleted: new Date().toISOString(),
    crawlDurationMs: 0,
    countriesCrawled: countries,
    vendorsCrawled: vendors,
    version: 3,
  },
};

fs.writeFileSync('data/solar-leaderboard.json', JSON.stringify(leaderboard, null, 2));
console.log('\n=== Solar Leaderboard Built ===');
console.log(`Total products: ${results.length}`);
console.log(`Vendors: ${vendors.join(', ')}`);
console.log(`Countries: ${countries.join(', ')}`);
console.log('\nTop 10 deals:');
results.slice(0, 10).forEach((r, i) => {
  console.log(`${i + 1}. $${r.pricePerWatt}/W | ${r.specs.wattage}W | $${r.price} | ${r.vendor}`);
  console.log(`   ${r.title}`);
});
