import fs from 'node:fs/promises';
import path from 'node:path';

const DATASET_ID = '6rrh-rzua';
const DATASET_URL = `https://data.lacity.org/resource/${DATASET_ID}.json`;
const METADATA_URL = `https://data.lacity.org/api/views/${DATASET_ID}`;
const outputPath = path.join(process.cwd(), 'data', 'la-open-data-restaurants.json');

const INCLUDED_NAICS_DESCRIPTIONS = new Set([
  'Full-service restaurants',
  'Full-Service Restaurants',
  'Limited-service eating places',
  'Limited-Service Restaurants',
  'Snack and Nonalcoholic Beverage Bars',
  'Cafeterias, Grill Buffets, and Buffets'
]);

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      'user-agent': 'GratisLA-MasterListImporter/1.0'
    }
  });

  if (!response.ok) {
    throw new Error(`Request failed for ${url} with status ${response.status}`);
  }

  return response.json();
}

function normalizeText(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function slugify(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeZip(zipCode) {
  const match = String(zipCode ?? '').match(/\d{5}/);
  return match ? match[0] : null;
}

function parseCoordinates(location) {
  if (!location) {
    return { lat: null, lng: null };
  }

  const lat = Number(location.latitude ?? location.coordinates?.[1]);
  const lng = Number(location.longitude ?? location.coordinates?.[0]);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { lat: null, lng: null };
  }

  if (lat < 30 || lat > 40 || lng > -110 || lng < -125) {
    return { lat: null, lng: null };
  }

  return { lat, lng };
}

function pickDisplayName(row) {
  const dba = String(row.dba_name ?? '').split('|')[0].trim();
  return dba || String(row.business_name ?? '').trim();
}

function formatAddress(row) {
  const zip = normalizeZip(row.zip_code);
  const parts = [row.street_address, row.city, zip ? `CA ${zip}` : null].filter(Boolean);
  return parts.join(', ');
}

const rowParams = new URLSearchParams({
  $select: [
    'location_account',
    'business_name',
    'dba_name',
    'street_address',
    'city',
    'zip_code',
    'location_description',
    'naics',
    'primary_naics_description',
    'council_district',
    'location_start_date',
    'location_1'
  ].join(','),
  $where: 'naics like "722%"',
  $limit: '50000'
});

const [metadata, rows] = await Promise.all([
  fetchJson(METADATA_URL),
  fetchJson(`${DATASET_URL}?${rowParams.toString()}`)
]);

const restaurants = rows
  .filter((row) => INCLUDED_NAICS_DESCRIPTIONS.has(String(row.primary_naics_description ?? '').trim()))
  .map((row) => {
    const displayName = pickDisplayName(row);
    const zipCode = normalizeZip(row.zip_code);
    const address = formatAddress(row);
    const { lat, lng } = parseCoordinates(row.location_1);
    const nameKey = normalizeText(displayName);
    const addressKey = normalizeText(`${row.street_address ?? ''} ${row.city ?? ''} ${zipCode ?? ''}`);

    return {
      master_id: `la-active-${slugify(row.location_account)}`,
      source_location_account: row.location_account,
      canonical_name: displayName,
      business_name: row.business_name ?? null,
      dba_name: row.dba_name ?? null,
      address,
      street_address: row.street_address ?? null,
      city: row.city ?? null,
      state: 'CA',
      zip_code: zipCode,
      lat,
      lng,
      naics: row.naics ?? null,
      primary_naics_description: row.primary_naics_description ?? null,
      council_district: row.council_district ?? null,
      location_start_date: row.location_start_date ?? null,
      canonical_key: `${nameKey}::${addressKey}`
    };
  })
  .sort((left, right) => left.canonical_name.localeCompare(right.canonical_name));

const output = {
  generated_at: new Date().toISOString(),
  source: {
    dataset_id: metadata.id,
    name: metadata.name,
    attribution: metadata.attribution,
    description: metadata.description,
    rows_updated_at: metadata.rowsUpdatedAt ? new Date(metadata.rowsUpdatedAt * 1000).toISOString() : null,
    source_url: `https://data.lacity.org/resource/${DATASET_ID}.json`
  },
  included_naics_descriptions: [...INCLUDED_NAICS_DESCRIPTIONS],
  restaurant_count: restaurants.length,
  restaurants
};

await fs.writeFile(outputPath, JSON.stringify(output, null, 2));
console.log(`Wrote ${restaurants.length} LA restaurant rows to ${outputPath}`);
