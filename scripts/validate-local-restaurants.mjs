import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const datasetPath = path.join(process.cwd(), 'data', 'seed-restaurants.json');
const reportPath = path.join(process.cwd(), 'data', 'local-restaurants-validation-report.json');

const LA_BOUNDS = {
  south: 33.5,
  west: -119.05,
  north: 34.95,
  east: -117.3
};

const diningHallPattern = /(dining hall|cafeteria|campus dining|student union|meal plan|commons)/i;
const publicStatuses = new Set(['verified']);

function normalizeWhitespace(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeKey(value) {
  return normalizeWhitespace(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ');
}

function isInBounds(lat, lng) {
  return lat >= LA_BOUNDS.south && lat <= LA_BOUNDS.north && lng >= LA_BOUNDS.west && lng <= LA_BOUNDS.east;
}

function isLikelyURL(value) {
  return /^https?:\/\//i.test(normalizeWhitespace(value));
}

function hasNonEmptyString(value) {
  return normalizeWhitespace(value).length > 0;
}

function addressLooksValid(value) {
  return /,\s*[A-Za-z .'-]+,\s*CA\s*\d{5}$/i.test(normalizeWhitespace(value));
}

const raw = JSON.parse(await fs.readFile(datasetPath, 'utf8'));
const restaurants = Array.isArray(raw) ? raw : [];

const errors = [];
const warnings = [];
const byID = new Map();
const byNameAddress = new Map();
const byNameCity = new Map();

for (const [index, row] of restaurants.entries()) {
  const label = `${row.name ?? '(missing name)'} [index ${index}]`;

  if (!publicStatuses.has(row.verification_status)) {
    errors.push({ type: 'non_public_status_in_public_dataset', row: label, verification_status: row.verification_status ?? null });
  }

  if (!hasNonEmptyString(row.id)) {
    errors.push({ type: 'missing_id', row: label });
  }

  if (!hasNonEmptyString(row.name)) {
    errors.push({ type: 'missing_name', row: label });
  }

  if (!hasNonEmptyString(row.address)) {
    errors.push({ type: 'missing_address', row: label });
  }

  if (!hasNonEmptyString(row.city)) {
    errors.push({ type: 'missing_city', row: label });
  }

  if (!hasNonEmptyString(row.website) || !isLikelyURL(row.website)) {
    errors.push({ type: 'invalid_website', row: label, website: row.website ?? null });
  }

  if (!Number.isFinite(row.lat) || !Number.isFinite(row.lng)) {
    errors.push({ type: 'invalid_coordinate', row: label, lat: row.lat ?? null, lng: row.lng ?? null });
  } else if (!isInBounds(row.lat, row.lng)) {
    warnings.push({ type: 'outside_greater_la_bounds', row: label, lat: row.lat, lng: row.lng });
  }

  if (!Array.isArray(row.citations) || row.citations.length === 0) {
    errors.push({ type: 'missing_citations', row: label });
  }

  if (diningHallPattern.test(`${row.name ?? ''} ${row.neighborhood ?? ''} ${row.verification_notes ?? ''}`)) {
    errors.push({ type: 'dining_hall_signal', row: label });
  }

  if (!addressLooksValid(row.address ?? '')) {
    warnings.push({ type: 'address_format_warning', row: label, address: row.address ?? null });
  }

  if (hasNonEmptyString(row.id)) {
    if (byID.has(row.id)) {
      errors.push({ type: 'duplicate_id', id: row.id, rows: [byID.get(row.id), label] });
    } else {
      byID.set(row.id, label);
    }
  }

  const nameAddressKey = `${normalizeKey(row.name)}|${normalizeKey(row.address)}`;
  if (nameAddressKey !== '|') {
    if (byNameAddress.has(nameAddressKey)) {
      warnings.push({ type: 'duplicate_name_address', rows: [byNameAddress.get(nameAddressKey), label] });
    } else {
      byNameAddress.set(nameAddressKey, label);
    }
  }

  const nameCityKey = `${normalizeKey(row.name)}|${normalizeKey(row.city)}`;
  if (nameCityKey !== '|') {
    if (byNameCity.has(nameCityKey)) {
      warnings.push({ type: 'duplicate_name_city', rows: [byNameCity.get(nameCityKey), label] });
    } else {
      byNameCity.set(nameCityKey, label);
    }
  }
}

const strictCount = restaurants.filter((row) => row.has_no_tip_policy === true && row.has_service_fee === false).length;
const serviceFeeCount = restaurants.filter((row) => row.has_no_tip_policy === true && row.has_service_fee === true).length;

const report = {
  generated_at: new Date().toISOString(),
  dataset_path: datasetPath,
  total_restaurants: restaurants.length,
  strict_no_fee_count: strictCount,
  service_fee_count: serviceFeeCount,
  errors,
  warnings,
  ok: errors.length === 0
};

await fs.mkdir(path.dirname(reportPath), { recursive: true });
await fs.writeFile(reportPath, JSON.stringify(report, null, 2));

console.log(`Validation report written to ${reportPath}`);
console.log(`- restaurants: ${restaurants.length}`);
console.log(`- errors: ${errors.length}`);
console.log(`- warnings: ${warnings.length}`);

if (errors.length > 0) {
  process.exitCode = 1;
}
