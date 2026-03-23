import type { RestaurantCardData } from '../types';

const chainKeyOverrides: Array<{ pattern: RegExp; chainKey: string }> = [
  { pattern: /\bmatu\b/i, chainKey: 'matu' }
];
const alwaysChainPatterns: RegExp[] = [/\bmcdonald'?s\b/i];

function normalizeChainName(name: string): string {
  const normalizedName = name
    .replace(/\s*\([^)]*\)\s*$/g, '')
    .replace(/\s*\|.*$/g, '')
    .trim()
    .toLowerCase();

  const override = chainKeyOverrides.find(({ pattern }) => pattern.test(normalizedName));
  return override?.chainKey ?? normalizedName;
}

export function buildChainCounts(restaurants: Pick<RestaurantCardData, 'name'>[]): Map<string, number> {
  const counts = new Map<string, number>();

  for (const restaurant of restaurants) {
    const chainKey = normalizeChainName(restaurant.name);
    counts.set(chainKey, (counts.get(chainKey) ?? 0) + 1);
  }

  return counts;
}

export function isChainRestaurant(
  restaurant: Pick<RestaurantCardData, 'name'>,
  chainCounts: ReadonlyMap<string, number>
): boolean {
  const chainKey = normalizeChainName(restaurant.name);
  if (alwaysChainPatterns.some((pattern) => pattern.test(chainKey))) {
    return true;
  }
  return (chainCounts.get(chainKey) ?? 0) > 1;
}
