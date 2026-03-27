/**
 * Pure utility functions for the Deep Deal Finder frontend.
 * Extracted from main.ts for testability.
 */

/**
 * Format currency value
 */
export function formatCurrency(value: number | null | undefined, currency: string): string {
  if (value == null || isNaN(value)) {
    return '\u2014';
  }
  const symbols: Record<string, string> = {
    USD: '$',
    EUR: '\u20ac',
    GBP: '\u00a3',
    INR: '\u20b9',
    JPY: '\u00a5',
    AUD: 'A$',
    CAD: 'C$',
  };
  const symbol = symbols[currency] || currency + ' ';
  return `${symbol}${value.toFixed(2)}`;
}

/**
 * Format price per unit
 */
export function formatPricePerUnit(value: number | null | undefined, unit: string): string {
  if (value == null || isNaN(value)) {
    return `\u2014/${unit}`;
  }
  // For very small values (per gram), show more decimals
  if (value < 0.01) {
    return `${value.toFixed(4)}/${unit}`;
  }
  return `${value.toFixed(2)}/${unit}`;
}

/**
 * Format quantity with unit
 */
export function formatQuantity(quantity: number | null | undefined, unit: string): string {
  if (quantity == null || isNaN(quantity)) {
    return '\u2014';
  }
  return `${quantity} ${unit}`;
}

/**
 * Truncate text to max length
 */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}

/**
 * Format elapsed time
 */
export function formatElapsedTime(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

/**
 * Get stage icon
 */
export function getStageIcon(stage: string): string {
  switch (stage) {
    case 'starting': return '...';
    case 'searching': return '...';
    case 'crawling': return '...';
    case 'extracting': return '...';
    case 'ranking': return '...';
    case 'complete': return '...';
    default: return '...';
  }
}
