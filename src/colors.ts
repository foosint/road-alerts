import type { ExpressionSpecification } from 'maplibre-gl';

/**
 * The two road states and their line colours. Every status in the feed is mapped to one of
 * them by twoState() when the data is loaded.
 */
export const STATUS_COLORS: Record<string, string> = {
  neutral: '#2f9e44',
  busy: '#e03131',
};
const FALLBACK = '#8a8f98';

/** "busy" stays busy; anything else (neutral, cleared, unknown) is neutral. */
export const twoState = (status: string | null | undefined) => (status === 'busy' ? 'busy' : 'neutral');

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
