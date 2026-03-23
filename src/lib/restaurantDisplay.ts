interface DisplayTarget {
  name: string;
  neighborhood?: string | null;
}

export function getRestaurantDisplayName(target: DisplayTarget): string {
  return target.name.replace(/\s*\([^)]*\)\s*$/, '').trim();
}

export function getRestaurantDisplayNeighborhood(target: DisplayTarget): string | null {
  const parentheticalMatch = target.name.match(/\(([^)]+)\)\s*$/);
  const parentheticalNeighborhood = parentheticalMatch?.[1]?.trim();

  if (parentheticalNeighborhood) {
    return parentheticalNeighborhood;
  }

  return target.neighborhood?.trim() || null;
}
