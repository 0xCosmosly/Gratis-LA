import blacklist from '../../data/fast-food-blacklist.json';
import type { RestaurantCardData, VerificationStatus } from '../types';

export const fastFoodBlacklist = blacklist;

export function isBlacklistedFastFood(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  return fastFoodBlacklist.some((entry) => normalized.includes(entry.toLowerCase()));
}

function normalizeSearchValue(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(value: string): string[] {
  const normalized = normalizeSearchValue(value);
  return normalized ? normalized.split(' ') : [];
}

function toPhoneticKey(word: string): string {
  const normalized = normalizeSearchValue(word);
  if (!normalized) {
    return '';
  }

  const phonetic = normalized
    .replace(/^q/, 'ch')
    .replace(/^x/, 'sh')
    .replace(/^c(?=[eiy])/, 's')
    .replace(/^c/, 'k')
    .replace(/ph/g, 'f')
    .replace(/kn/g, 'n')
    .replace(/wr/g, 'r')
    .replace(/dg(?=[eiy])/g, 'j')
    .replace(/tch/g, 'ch')
    .replace(/qu/g, 'kw')
    .replace(/ch/g, 'c')
    .replace(/sh/g, 's')
    .replace(/zh/g, 'j')
    .replace(/[aeiouy]+/g, '')
    .replace(/(.)\1+/g, '$1');

  return phonetic || normalized;
}

function getEditDistance(a: string, b: string): number {
  if (a === b) {
    return 0;
  }

  if (!a.length || !b.length) {
    return Math.max(a.length, b.length);
  }

  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);

  for (let row = 1; row <= a.length; row += 1) {
    let diagonal = previous[0];
    previous[0] = row;

    for (let column = 1; column <= b.length; column += 1) {
      const cached = previous[column];
      const substitutionCost = a[row - 1] === b[column - 1] ? 0 : 1;
      previous[column] = Math.min(
        previous[column] + 1,
        previous[column - 1] + 1,
        diagonal + substitutionCost
      );
      diagonal = cached;
    }
  }

  return previous[b.length];
}

function getTokenMatchScore(queryToken: string, candidateToken: string): number {
  if (candidateToken === queryToken) {
    return 0;
  }

  if (candidateToken.startsWith(queryToken)) {
    return 1;
  }

  if (candidateToken.includes(queryToken)) {
    return 2;
  }

  const queryPhonetic = toPhoneticKey(queryToken);
  const candidatePhonetic = toPhoneticKey(candidateToken);

  if (queryPhonetic && queryPhonetic === candidatePhonetic) {
    return 3;
  }

  const editDistance = getEditDistance(queryToken, candidateToken);
  if (editDistance <= 1) {
    return 4;
  }

  if (queryToken.length >= 4 && candidateToken.length >= 4 && editDistance <= 2) {
    return 5;
  }

  if (queryPhonetic && candidatePhonetic && getEditDistance(queryPhonetic, candidatePhonetic) <= 1) {
    return 6;
  }

  return Number.POSITIVE_INFINITY;
}

function buildSearchParts(restaurant: RestaurantCardData): string[] {
  return [
    restaurant.name,
    restaurant.address ?? '',
    restaurant.city ?? '',
    restaurant.neighborhood ?? ''
  ].filter(Boolean);
}

export function getSearchScore(restaurant: RestaurantCardData, query: string): number {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) {
    return 0;
  }

  const searchParts = buildSearchParts(restaurant);
  const normalizedParts = searchParts.map(normalizeSearchValue).filter(Boolean);
  const candidateTokens = normalizedParts.flatMap(tokenize);

  let totalScore = 0;

  for (const queryToken of queryTokens) {
    let bestScore = normalizedParts.some((part) => part.includes(queryToken)) ? 0 : Number.POSITIVE_INFINITY;

    for (const candidateToken of candidateTokens) {
      bestScore = Math.min(bestScore, getTokenMatchScore(queryToken, candidateToken));
    }

    if (!Number.isFinite(bestScore)) {
      return Number.POSITIVE_INFINITY;
    }

    totalScore += bestScore;
  }

  return totalScore;
}

export function matchesSearch(restaurant: RestaurantCardData, query: string): boolean {
  if (!query.trim()) {
    return true;
  }

  return Number.isFinite(getSearchScore(restaurant, query));
}

export function matchesStatus(restaurant: RestaurantCardData, statuses: VerificationStatus[]): boolean {
  if (statuses.length === 0) {
    return true;
  }

  return statuses.includes(restaurant.verification_status);
}
