// Shared types for Deep Deal Finder

export type ProductCategory = 'supplements' | 'building' | 'robotics';

export type Country = 'US' | 'CA' | 'UK' | 'DE' | 'FR' | 'ES' | 'IT' | 'NL' | 'SE' | 'AU' | 'NZ' | 'IE' | 'JP' | 'SG';

export interface SearchRequest {
  query: string;
  category?: ProductCategory;
  countries?: Country[];
}

// === UPC/Barcode Types ===

export type BarcodeType = 'upc-a' | 'ean-13' | 'gtin-14' | 'sku' | 'mpn' | 'unknown';

export type IdentifierSource =
  | 'json-ld'
  | 'meta-tag'
  | 'microdata'
  | 'data-attribute'
  | 'text-pattern';

export interface ProductIdentifier {
  type: BarcodeType;
  value: string;
  isValidCheckDigit: boolean;
  source: IdentifierSource;
}

export interface QualityVerification {
  hasValidUpc: boolean;
  crossVendorMatches: number;
  verificationScore: number;
}

/**
 * Extended price information with sale/original price detection
 */
export interface ExtractedPrice {
  current: number;
  original?: number;  // Was/strikethrough price
  discount_percent?: number;
  currency: string;
  source: 'json-ld' | 'meta' | 'css' | 'text';
}

/**
 * Shipping cost information
 */
export interface ShippingInfo {
  cost: number | null;
  freeThreshold?: number;
  isFree: boolean;
  estimate?: string;  // "2-5 business days"
}

/**
 * Coupon and promotion detection
 */
export interface PromotionInfo {
  hasCoupon: boolean;
  couponCode?: string;
  couponDiscount?: string;  // "10% off" or "$5 off"
  subscribeDiscount?: string;  // Subscribe & Save percentage
  bulkDiscount?: string;  // "Buy 3 get 10% off"
}

export interface ProductResult {
  title: string;
  price: number;
  currency: string;
  quantity: number;
  unit: string;
  price_per_unit: number;
  price_per_unit_usd?: number;  // Normalized for cross-currency comparison
  vendor: string;
  url: string;
  confidence: number;
  // UPC/barcode fields (optional for backward compatibility)
  upc?: string;
  identifiers?: ProductIdentifier[];
  verification?: QualityVerification;
  // Multi-country support
  country?: Country;
  shipping_estimate?: number;
  landed_cost?: number;
  // Enhanced price detection (Phase 2)
  original_price?: number;  // Was/strikethrough price
  discount_percent?: number;
  // Shipping and promotions (Phase 2)
  shipping?: ShippingInfo;
  promotion?: PromotionInfo;
  // Deal scoring (Phase 3)
  deal_score?: number;
}

export interface SearchResponse {
  query: string;
  category: ProductCategory;
  countries: Country[];
  results: ProductResult[];
  best_deal: ProductResult | null;
  timestamp: string;
  search_time_ms: number;
}

export interface ScrapedProduct {
  title: string;
  price: number | null;
  currency: string;
  rawQuantity: string | null;
  quantity: number | null;
  unit: string | null;
  url: string;
  vendor: string;
  // UPC/barcode fields (optional)
  identifiers?: ProductIdentifier[];
  primaryUpc?: string;
  sku?: string;
  // Enhanced price detection (Phase 2)
  original_price?: number;
  discount_percent?: number;
  // Shipping and promotions (Phase 2)
  shipping?: ShippingInfo;
  promotion?: PromotionInfo;
}

export type Unit = 'g' | 'kg' | 'mg' | 'lb' | 'oz' | 'capsules' | 'tablets' | 'servings' | 'ml' | 'l';

export interface NormalizedQuantity {
  value: number;
  unit: string;
  normalized_grams: number | null;
}

// === Solar Panel Leaderboard Types ===

export type SolarPanelType = 'monocrystalline' | 'polycrystalline' | 'thin-film' | 'bifacial' | 'unknown';

export interface SolarPanelSpecs {
  wattage: number;
  panelType: SolarPanelType;
  efficiency: number | null;
  dimensions: {
    lengthMm: number | null;
    widthMm: number | null;
    depthMm: number | null;
  } | null;
  weightKg: number | null;
  warranty: string | null;
  cellCount: number | null;
  brand: string | null;
  model: string | null;
}

export interface SolarPanelResult {
  title: string;
  price: number;
  currency: string;
  priceUsd: number;
  pricePerWatt: number;
  pricePerWattUsd: number;
  specs: SolarPanelSpecs;
  vendor: string;
  url: string;
  country: Country;
  shipping: ShippingInfo;
  confidence: number;
  lastCrawled: string;
}

export interface SolarLeaderboard {
  results: SolarPanelResult[];
  metadata: {
    totalCrawled: number;
    totalExtracted: number;
    totalAfterFiltering: number;
    crawlStarted: string;
    crawlCompleted: string;
    crawlDurationMs: number;
    countriesCrawled: Country[];
    vendorsCrawled: string[];
    version: number;
  };
}
