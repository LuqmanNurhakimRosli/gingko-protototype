// Ginkgo Command Center — number formatting and the shared risk palette.

import type { RiskClass } from './types';

/** One risk scale, used by the map, bars, legend and report alike.
 *  Validated (dataviz validate_palette.js, light surface, all pairs):
 *  worst CVD ΔE 18.7, normal-vision ΔE 24.7. Amber sits below 3:1 contrast on
 *  white, so every class is always shown with its text label as well. */
export const RISK_COLOR: Record<RiskClass, string> = {
  High: '#DC2626',
  Moderate: '#EDA100',
  Low: '#2A78D6',
};

export const RISK_RGB: Record<RiskClass, [number, number, number]> = {
  High: [220, 38, 38],
  Moderate: [237, 161, 0],
  Low: [42, 120, 214],
};

/** Single-series magnitude bars (population, land cover) use the brand green. */
export const SERIES_COLOR = '#08A045';
export const HISTORY_RGB: [number, number, number] = [98, 80, 214];  // violet
export const BUILT_RGB: [number, number, number] = [55, 65, 81];     // slate
export const RIVER_COLOR = '#1C5CAB';
/** Screened candidate land (brand green — not part of the risk scale). */
export const SAFE_RGB: [number, number, number] = [8, 160, 69];
export const RAIL_NEUTRAL = '#374151';

export const fmtInt = (n: number) => Math.round(n).toLocaleString('en-MY');

export function fmtCompact(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e6) return `${(n / 1e6).toFixed(a >= 1e7 ? 1 : 2)}M`;
  if (a >= 1e4) return `${Math.round(n / 1e3)}K`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return fmtInt(n);
}

export function fmtKm2(km2: number): string {
  if (km2 === 0) return '0 km²';
  if (km2 < 0.1) return '< 0.1 km²';
  if (km2 < 10) return `${km2.toFixed(1)} km²`;
  return `${fmtInt(km2)} km²`;
}

export function fmtHa(km2: number): string {
  const ha = km2 * 100;
  if (ha < 1) return '< 1 ha';
  return `${fmtInt(ha)} ha`;
}

export const fmtPct = (p: number, digits = 1) => `${p.toFixed(digits)}%`;

/** Round a population estimate to a precision the method can support. */
export function fmtPopEstimate(n: number): string {
  if (n < 50) return n < 1 ? '0' : '< 50';
  if (n < 1000) return `~${Math.round(n / 10) * 10}`;
  if (n < 100000) return `~${fmtInt(Math.round(n / 100) * 100)}`;
  return `~${fmtCompact(Math.round(n / 1000) * 1000)}`;
}

export const fmtCoord = ([lon, lat]: [number, number]) =>
  `${lat.toFixed(4)}°N, ${lon.toFixed(4)}°E`;
