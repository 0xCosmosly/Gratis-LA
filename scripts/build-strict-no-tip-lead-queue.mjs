import fs from 'node:fs/promises';
import path from 'node:path';

const masterListPath = path.join(process.cwd(), 'data', 'la-open-data-restaurants.json');
const seedPath = path.join(process.cwd(), 'data', 'tracked-restaurants.json');
const outputPath = path.join(process.cwd(), 'data', 'la-strict-no-tip-lead-queue.json');

const DISPLAY_NAME_PATTERNS = [
  { pattern: /\bathenaeum\b/i, reason: 'Athenaeum / institutional club name', score: 5 },
  { pattern: /\bguest ?house\b/i, reason: 'Guest house / public hospitality name', score: 5 },
  { pattern: /\bconference\b/i, reason: 'Conference / hospitality property name', score: 4 },
  { pattern: /\blodge\b/i, reason: 'Lodge / hospitality property name', score: 4 },
  { pattern: /\buniversity\b/i, reason: 'University / campus operator name', score: 4 },
  { pattern: /\bcollege\b/i, reason: 'College / campus operator name', score: 4 },
  { pattern: /\bcampus\b/i, reason: 'Campus dining operator name', score: 4 },
  { pattern: /\bfaculty club\b/i, reason: 'Faculty club dining lead', score: 4 },
  { pattern: /\buniversity club\b/i, reason: 'University club dining lead', score: 4 },
  { pattern: /\bcity club\b/i, reason: 'City club dining lead', score: 4 },
  { pattern: /\bhotel\b/i, reason: 'Hotel restaurant lead', score: 3 }
];

const OPERATOR_PATTERNS = [
  { pattern: /\buniversity\b/i, reason: 'Operator name references a university', score: 3 },
  { pattern: /\bcollege\b/i, reason: 'Operator name references a college', score: 3 },
  { pattern: /\bcampus\b/i, reason: 'Operator name references campus dining', score: 3 },
  { pattern: /\bathenaeum\b/i, reason: 'Operator name references an Athenaeum', score: 3 },
  { pattern: /\bguest ?house\b/i, reason: 'Operator name references a guest house', score: 3 },
  { pattern: /\bconference\b/i, reason: 'Operator name references a conference property', score: 3 },
  { pattern: /\blodge\b/i, reason: 'Operator name references a lodge property', score: 3 },
  { pattern: /\bhotel\b/i, reason: 'Operator name references a hotel property', score: 2 }
];

const NEGATIVE_PATTERNS = [
  { pattern: /\bnight ?club\b/i, reason: 'Nightclub / bar lead, not useful for strict no-tip search' },
  { pattern: /\bkaraoke\b/i, reason: 'Karaoke venue, not a restaurant target' },
  { pattern: /\bbilliard\b/i, reason: 'Billiards venue, not a restaurant target' },
  { pattern: /\bpool hall\b/i, reason: 'Pool hall venue, not a restaurant target' },
  { pattern: /\bhonky tonk\b/i, reason: 'Bar / nightlife venue, not a restaurant target' },
  { pattern: /\bescape hotel\b/i, reason: 'Entertainment venue, not a restaurant target' }
];

function normalizeText(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeAddress(value) {
  return normalizeText(value)
    .replace(/\bstreet\b/g, 'st')
    .replace(/\bavenue\b/g, 'ave')
    .replace(/\bboulevard\b/g, 'blvd');
}

function buildComparableSet(restaurants) {
  const names = new Set();
  const namesAndAddresses = new Set();

  for (const restaurant of restaurants) {
    const name = normalizeText(restaurant.name);
    const address = normalizeAddress(restaurant.address);
    if (name) {
      names.add(name);
    }
    if (name && address) {
      namesAndAddresses.add(`${name}::${address}`);
    }
  }

  return { names, namesAndAddresses };
}

function scoreLead(entry) {
  const displayHaystack = [entry.canonical_name, entry.dba_name]
    .filter(Boolean)
    .join(' ');
  const operatorHaystack = String(entry.business_name ?? '');

  const reasons = [];
  let score = 0;

  for (const item of DISPLAY_NAME_PATTERNS) {
    if (item.pattern.test(displayHaystack)) {
      reasons.push(item.reason);
      score += item.score;
    }
  }

  for (const item of OPERATOR_PATTERNS) {
    if (item.pattern.test(operatorHaystack)) {
      reasons.push(item.reason);
      score += item.score;
    }
  }

  const negatives = NEGATIVE_PATTERNS.filter((item) =>
    item.pattern.test([displayHaystack, operatorHaystack].filter(Boolean).join(' '))
  );
  if (negatives.length > 0) {
    return {
      score: 0,
      reasons: negatives.map((item) => item.reason),
      excluded: true
    };
  }

  if (/full-service restaurant/i.test(entry.primary_naics_description ?? '')) {
    reasons.push('Full-service restaurant category');
    score += 1;
  }

  const hasDisplaySignal = DISPLAY_NAME_PATTERNS.some((item) => item.pattern.test(displayHaystack));
  const hasOperatorSignal = OPERATOR_PATTERNS.some((item) => item.pattern.test(operatorHaystack));
  if (!hasDisplaySignal && !hasOperatorSignal) {
    return {
      score: 0,
      reasons: [],
      excluded: true
    };
  }

  return { score, reasons, excluded: false };
}

const masterList = JSON.parse(await fs.readFile(masterListPath, 'utf8'));
const seed = JSON.parse(await fs.readFile(seedPath, 'utf8'));
const tracked = buildComparableSet(seed);

const candidates = [];
const skippedTracked = [];

for (const entry of masterList.restaurants ?? []) {
  const normalizedName = normalizeText(entry.canonical_name);
  const normalizedAddress = normalizeAddress(entry.address);
  const trackedByName = tracked.names.has(normalizedName);
  const trackedByNameAndAddress = tracked.namesAndAddresses.has(`${normalizedName}::${normalizedAddress}`);

  if (trackedByName || trackedByNameAndAddress) {
    skippedTracked.push({
      master_id: entry.master_id,
      canonical_name: entry.canonical_name,
      address: entry.address
    });
    continue;
  }

  const { score, reasons, excluded } = scoreLead(entry);
  if (excluded || score < 4) {
    continue;
  }

  candidates.push({
    master_id: entry.master_id,
    canonical_name: entry.canonical_name,
    business_name: entry.business_name,
    dba_name: entry.dba_name,
    address: entry.address,
    city: entry.city,
    zip_code: entry.zip_code,
    lat: entry.lat,
    lng: entry.lng,
    primary_naics_description: entry.primary_naics_description,
    lead_score: score,
    lead_reasons: [...new Set(reasons)]
  });
}

candidates.sort((left, right) => {
  if (right.lead_score !== left.lead_score) {
    return right.lead_score - left.lead_score;
  }
  return left.canonical_name.localeCompare(right.canonical_name);
});

const output = {
  generated_at: new Date().toISOString(),
  source_file: masterListPath,
  heuristic_summary: [
    'Built from LA Open Data active-business rows filtered to restaurant-like NAICS descriptions.',
    'Ranks leads toward strict no-tip discovery based on institutional, hospitality, and campus-dining signals.',
    'Excludes businesses already tracked in tracked-restaurants.json so the queue stays focused on unexplored leads.'
  ],
  master_restaurant_count: masterList.restaurant_count ?? 0,
  tracked_seed_count: seed.length,
  skipped_tracked_count: skippedTracked.length,
  candidate_count: candidates.length,
  candidates
};

await fs.writeFile(outputPath, JSON.stringify(output, null, 2));
console.log(`Wrote ${candidates.length} strict no-tip discovery leads to ${outputPath}`);
