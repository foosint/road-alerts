import type { ExpressionSpecification } from 'maplibre-gl';

/**
 * Line colour per road status. Statuses not listed here fall back to the
 * `stroke` colour in the data (set by road-alerts-data), then to FALLBACK.
 */
export const STATUS_COLORS: Record<string, string> = {
  neutral: '#2f9e44',
  busy: '#e03131',
};
const FALLBACK = '#8a8f98';

export function statusColor(status: string, stroke?: string): string {
  return STATUS_COLORS[status] ?? stroke ?? FALLBACK;
}

/** The same rule as a MapLibre expression, for a given expression that yields the status. */
export function statusColorExpr(status: ExpressionSpecification): ExpressionSpecification {
  return [
    'match',
    status,
    ...Object.entries(STATUS_COLORS).flat(),
    ['coalesce', ['get', 'stroke'], FALLBACK],
  ] as unknown as ExpressionSpecification;
}

export const STATUS_COLOR_EXPR = statusColorExpr(['get', 'status']);
