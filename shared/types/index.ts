// Shared types for Supplement Deal Finder

export interface SearchRequest {
  query: string;
}

export interface ProductResult {
  title: string;
  price: number;
  currency: string;
  quantity: number;
  unit: string;
  price_per_unit: number;
  vendor: string;
  url: string;
  confidence: number;
}

export interface SearchResponse {
  query: string;
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
}

export type Unit = 'g' | 'kg' | 'mg' | 'lb' | 'oz' | 'capsules' | 'tablets' | 'servings' | 'ml' | 'l';

export interface NormalizedQuantity {
  value: number;
  unit: string;
  normalized_grams: number | null;
}
