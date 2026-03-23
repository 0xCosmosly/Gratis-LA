import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const datasetPath = path.join(process.cwd(), 'ios', 'App', 'App', 'public', 'local-restaurants.json');
const reportPath = path.join(process.cwd(), 'data', 'chain-location-enrichment-report.json');

const LA_BOUNDS = {
  south: 33.5,
  west: -119.05,
  north: 34.95,
  east: -117.3
};

const LOCATION_EXCLUSION_PATTERNS = [
  /\bdining hall\b/i,
  /\bcafeteria\b/i,
  /\bcampus dining\b/i,
  /\bstudent union\b/i,
  /\bmeal plan\b/i
];

const CHAINS = [
  {
    key: 'sugarfish',
    label: 'SUGARFISH',
    homeURL: 'https://sugarfishsushi.com/',
    locationURLPattern: /https:\/\/sugarfishsushi\.com\/locations\/([a-z0-9-]+)\//g,
    excludedSlugs: new Set([
      'flatiron',
      'midtown-east',
      'midtown-west',
      'soho',
      'upper-west-side',
      'williamsburg',
      'press'
    ]),
    slugLabels: {
      'la-bh': 'Beverly Hills',
      'la-brea': 'La Brea',
      dtla: 'Downtown LA'
    },
    fallbackCoordinates: {
      dtla: { lat: 34.04735, lng: -118.256999 },
      hollywood: { lat: 34.09822, lng: -118.322511 },
      'la-bh': { lat: 34.0688, lng: -118.4011 },
      'la-brea': { lat: 34.0721, lng: -118.3449 },
      'marina-del-rey': { lat: 33.978955, lng: -118.438098 },
      pasadena: { lat: 34.1431, lng: -118.131777 },
      'santa-monica': { lat: 34.015386, lng: -118.497213 },
      'studio-city': { lat: 34.153469, lng: -118.64666 },
      brentwood: { lat: 34.053499, lng: -118.462879 }
    },
    policySource: {
      source_name: 'SUGARFISH menu policy',
      source_url: 'https://sugarfishsushi.com/food-menus/daily-menu/',
      excerpt: 'Menu language includes no tipping and mandatory service fee.'
    },
    verificationNotes: 'Chain policy cites no tipping with mandatory service fee language.'
  },
  {
    key: 'kazunori',
    label: 'KazuNori',
    homeURL: 'https://www.handrollbar.com/',
    locationURLPattern: /https:\/\/www\.handrollbar\.com\/locations\/([a-z0-9-]+)\//g,
    excludedSlugs: new Set(['greenwich-village', 'midtown-east', 'nomad', 'union-square']),
    slugLabels: {
      dtla: 'Downtown LA',
      'mid-wilshire': 'Mid-Wilshire'
    },
    fallbackAddresses: {
      'santa-monica': {
        full: '120 Broadway, Santa Monica, CA 90401',
        city: 'Santa Monica'
      }
    },
    fallbackCoordinates: {
      dtla: { lat: 34.0476, lng: -118.2474 },
      koreatown: { lat: 34.063726, lng: -118.297138 },
      'marina-del-rey': { lat: 33.980839, lng: -118.441632 },
      'mid-wilshire': { lat: 34.0618, lng: -118.3666 },
      pasadena: { lat: 34.143037, lng: -118.131955 },
      'santa-monica': { lat: 34.013111, lng: -118.495799 },
      'studio-city': { lat: 34.14028, lng: -118.37557 },
      westwood: { lat: 34.0597, lng: -118.4436 }
    },
    policySource: {
      source_name: 'KazuNori menu policy',
      source_url: 'https://www.handrollbar.com/los-angeles-to-go-menu/',
      excerpt: 'Menu language references no tipping and mandatory service charge.'
    },
    verificationNotes: 'Chain policy cites no tipping with mandatory service fee language.'
  },
  {
    key: 'uovo',
    label: 'Uovo',
    homeURL: 'https://uovo.la/',
    locationURLPattern: /https:\/\/uovo\.la\/locations\/location-([a-z0-9-]+)\//g,
    excludedSlugs: new Set(['nomad']),
    slugLabels: {
      marina: 'Marina del Rey',
      'mid-wilshire': 'Mid-Wilshire',
      'studio-city': 'Studio City'
    },
    fallbackCoordinates: {
      marina: { lat: 33.980839, lng: -118.441632 },
      'mid-wilshire': { lat: 34.0618, lng: -118.3666 },
      pasadena: { lat: 34.143037, lng: -118.131955 },
      'santa-monica': { lat: 34.015709, lng: -118.498287 },
      'studio-city': { lat: 34.14028, lng: -118.37557 }
    },
    policySource: {
      source_name: 'Uovo menu policy',
      source_url: 'https://uovo.la/dine-in-menu/',
      excerpt: 'Menu language references no tipping and mandatory service charge.'
    },
    verificationNotes: 'Published menu notes no tipping with mandatory service charge language.'
  }
];

const cityStateZipPattern = /([A-Za-z .'-]{2,40})\s*,?\s*CA\s*(\d{5})/i;
const streetSuffixPattern = '(?:street|avenue|boulevard|drive|road|plaza|parkway|highway|pkwy|hwy|ave|blvd|dr|rd|st|way|ln|lane|ct|court)';
const fullAddressPattern = new RegExp(
  String.raw`(\d{1,5}[A-Za-z0-9 ./'#-]{1,120}?(?:${streetSuffixPattern})\b\.?(?:\s*,?\s*(?:#|suite|ste\.?)\s*[A-Za-z0-9-]+)?)\s*,?\s*([A-Za-z .'-]{2,40})\s*,?\s*CA\s*(\d{5})`,
  'i'
);

function normalizeWhitespace(value) {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeForId(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function normalizeCityName(city) {
  const normalized = normalizeWhitespace(city).toLowerCase();
  if (normalized === 'la' || normalized === 'l.a.' || normalized === 'los angeles') {
    return 'Los Angeles';
  }

  if (normalized === 'marina del rey') {
    return 'Marina del Rey';
  }

  if (normalized === 'universal city') {
    return 'Universal City';
  }

  return normalized
    .split(' ')
    .map((part) => {
      if (!part) {
        return part;
      }
      if (part === 'del') {
        return 'del';
      }
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(' ');
}

function normalizeAddressForKey(address) {
  return normalizeWhitespace(address)
    .toLowerCase()
    .replace(/[.,]/g, '')
    .replace(/\bstreet\b/g, 'st')
    .replace(/\bavenue\b/g, 'ave')
    .replace(/\bboulevard\b/g, 'blvd')
    .replace(/\bdrive\b/g, 'dr')
    .replace(/\broad\b/g, 'rd')
    .replace(/\bhighway\b/g, 'hwy')
    .replace(/\bsouth\b/g, 's')
    .replace(/\bnorth\b/g, 'n')
    .replace(/\beast\b/g, 'e')
    .replace(/\bwest\b/g, 'w')
    .replace(/\bla,\\s*ca\\b/g, 'los angeles, ca');
}

function makeRestaurantKey(name, address) {
  const normalizedName = normalizeWhitespace(name).toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  const normalizedAddress = normalizeAddressForKey(address ?? '');
  return `${normalizedName}|${normalizedAddress}`;
}

function makeNameCityKey(name, city) {
  const normalizedName = normalizeWhitespace(name).toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  const normalizedCity = normalizeCityName(city ?? '').toLowerCase();
  return `${normalizedName}|${normalizedCity}`;
}

function normalizeAddressDisplay(address) {
  return normalizeWhitespace(address ?? '')
    .replace(/\b(Ste\.?\s*[A-Za-z0-9-]+)\s+([A-Za-z][A-Za-z .'-]+),\s*CA\b/gi, '$1, $2, CA')
    .replace(/\bLA,\s*CA\b/gi, 'Los Angeles, CA')
    .replace(/\bMARINA DEL REY\b/g, 'Marina del Rey')
    .replace(/\bLOS ANGELES\b/g, 'Los Angeles')
    .replace(/\bPASADENA\b/g, 'Pasadena')
    .replace(/\bSANTA MONICA\b/g, 'Santa Monica');
}

function normalizeRestaurantRow(row) {
  const normalizedAddress = normalizeAddressDisplay(row.address);
  const cityFromAddressRaw = normalizedAddress.match(/,\s*([A-Za-z .'-]+),\s*CA\s*\d{5}/)?.[1] ?? row.city ?? '';
  const cityFromAddress = cityFromAddressRaw.replace(/^(?:#|suite|ste\.?)\s*[A-Za-z0-9-]+\s+/i, '');

  return {
    ...row,
    address: normalizedAddress,
    city: normalizeCityName(cityFromAddress)
  };
}

function normalizeHtmlToText(html) {
  return normalizeWhitespace(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&#8211;|&#8212;/g, ' - ')
      .replace(/&#8217;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
  );
}

function normalizeHtmlToLines(html) {
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h1|h2|h3|h4|h5|h6|section|article)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#8211;|&#8212;/g, ' - ')
    .replace(/&#8217;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');

  return cleaned
    .split('\n')
    .map((line) => normalizeWhitespace(line))
    .filter((line) => line.length > 0);
}

function extractLocationLinks(html, pattern) {
  const links = new Map();
  for (const match of html.matchAll(pattern)) {
    const full = match[0];
    const slug = match[1];
    if (!full || !slug) {
      continue;
    }

    links.set(slug.toLowerCase(), full);
  }

  return Array.from(links.entries()).map(([slug, url]) => ({ slug, url }));
}

function hasDiningHallSignal(value) {
  return LOCATION_EXCLUSION_PATTERNS.some((pattern) => pattern.test(value));
}

function formatLocationLabel(slug, labelOverrides = {}) {
  if (labelOverrides[slug]) {
    return labelOverrides[slug];
  }

  return slug
    .split('-')
    .map((part) => {
      const lower = part.toLowerCase();
      if (lower === 'dtla') {
        return 'Downtown LA';
      }
      if (lower === 'la') {
        return 'LA';
      }
      if (lower === 'del') {
        return 'del';
      }
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ')
    .replace(' Del ', ' del ');
}

function parseAddressCandidate(value) {
  const matched = value.match(fullAddressPattern);
  if (!matched) {
    return null;
  }

  const street = normalizeWhitespace(matched[1].replace(/\s+,/g, ',').replace(/,\s*$/, ''));
  const city = normalizeWhitespace(matched[2]);
  const zip = matched[3];

  return {
    street,
    city,
    full: `${street}, ${city}, CA ${zip}`
  };
}

function extractAddress(text, lines) {
  const direct = parseAddressCandidate(text);
  if (direct) {
    return direct;
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!cityStateZipPattern.test(line)) {
      continue;
    }

    const candidates = [line];
    if (index > 0) {
      candidates.push(`${lines[index - 1]} ${line}`);
    }
    if (index > 1) {
      candidates.push(`${lines[index - 2]} ${lines[index - 1]} ${line}`);
    }

    for (const candidate of candidates) {
      const parsed = parseAddressCandidate(candidate);
      if (parsed) {
        return parsed;
      }
    }
  }

  return null;
}

function isInLABounds(lat, lng) {
  return lat >= LA_BOUNDS.south && lat <= LA_BOUNDS.north && lng >= LA_BOUNDS.west && lng <= LA_BOUNDS.east;
}

async function fetchText(url, timeoutMs = 20000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'user-agent': 'NoTipLA-LocationEnricher/1.0'
      }
    });

    if (!response.ok) {
      return { ok: false, status: response.status, text: '' };
    }

    return { ok: true, status: response.status, text: await response.text() };
  } catch (error) {
    return {
      ok: false,
      status: null,
      text: '',
      error: error instanceof Error ? error.message : String(error)
    };
  } finally {
    clearTimeout(timeout);
  }
}

const geocodeCache = new Map();

async function geocodeAddress(address) {
  if (geocodeCache.has(address)) {
    return geocodeCache.get(address);
  }

  const attempts = [
    address,
    normalizeWhitespace(address.replace(/,?\s*(?:#|suite|ste)\s*[A-Za-z0-9-]+/gi, '')),
    normalizeWhitespace(address.replace(/,?\s*(?:#|suite|ste)\s*[A-Za-z0-9-]+/gi, '').replace(/,\s*,/g, ','))
  ];

  for (const query of attempts) {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=us&q=${encodeURIComponent(query)}`;
    const response = await fetchText(url, 25000);
    if (!response.ok) {
      continue;
    }

    try {
      const rows = JSON.parse(response.text);
      const first = Array.isArray(rows) ? rows[0] : null;
      const lat = Number(first?.lat);
      const lng = Number(first?.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        continue;
      }

      if (!isInLABounds(lat, lng)) {
        continue;
      }

      const point = { lat, lng };
      geocodeCache.set(address, point);
      return point;
    } catch {
      continue;
    }
  }

  geocodeCache.set(address, null);
  return null;
}

function dedupeRestaurants(restaurants) {
  const map = new Map();
  for (const row of restaurants) {
    const key = makeRestaurantKey(row.name, row.address);
    if (!map.has(key)) {
      map.set(key, row);
    }
  }

  return Array.from(map.values());
}

async function buildChainRows(chain) {
  const home = await fetchText(chain.homeURL);
  if (!home.ok) {
    return {
      chain: chain.key,
      added: 0,
      skipped: 0,
      errors: [`Failed to load ${chain.homeURL}`],
      rows: []
    };
  }

  const links = extractLocationLinks(home.text, chain.locationURLPattern)
    .filter((entry) => !chain.excludedSlugs.has(entry.slug))
    .filter((entry) => !hasDiningHallSignal(entry.slug));

  const rows = [];
  const errors = [];
  let skipped = 0;

  for (const entry of links) {
    const page = await fetchText(entry.url);
    if (!page.ok) {
      errors.push(`Failed page: ${entry.url}`);
      skipped += 1;
      continue;
    }

    const text = normalizeHtmlToText(page.text);
    const lines = normalizeHtmlToLines(page.text);
    const fallbackAddress = chain.fallbackAddresses?.[entry.slug] ?? null;
    const address = extractAddress(text, lines) ?? fallbackAddress;
    if (!address) {
      errors.push(`No address found: ${entry.url}`);
      skipped += 1;
      continue;
    }

    let coordinate = chain.fallbackCoordinates?.[entry.slug] ?? null;
    if (!coordinate) {
      coordinate = await geocodeAddress(address.full);
    }

    if (!coordinate) {
      errors.push(`Geocode miss/outside LA: ${address.full}`);
      skipped += 1;
      continue;
    }

    const locationLabel = formatLocationLabel(entry.slug, chain.slugLabels);
    const listingName = `${chain.label} (${locationLabel})`;

    rows.push({
      id: `local-${normalizeForId(`${chain.key}-${entry.slug}`)}`,
      slug: normalizeForId(`${chain.key}-${entry.slug}`),
      name: listingName,
      address: address.full,
      city: normalizeCityName(address.city),
      neighborhood: locationLabel,
      website: entry.url,
      lat: Number(coordinate.lat.toFixed(6)),
      lng: Number(coordinate.lng.toFixed(6)),
      is_fast_food: false,
      has_no_tip_policy: true,
      has_service_fee: true,
      verification_status: 'needs_review',
      verification_notes: chain.verificationNotes,
      last_checked_at: new Date().toISOString(),
      next_check_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      upvote_count: 2,
      citations: [
        {
          source_name: `${chain.label} official location page`,
          source_url: entry.url,
          excerpt: 'Official location page used for address and location details.'
        },
        chain.policySource
      ]
    });
  }

  return {
    chain: chain.key,
    added: rows.length,
    skipped,
    errors,
    rows
  };
}

function mergeWithExisting(existingRestaurants, newRestaurants) {
  const merged = new Map();
  const mergedByNameCity = new Set();

  for (const row of existingRestaurants) {
    const key = makeRestaurantKey(row.name, row.address);
    const nameCityKey = makeNameCityKey(row.name, row.city);
    if (mergedByNameCity.has(nameCityKey)) {
      continue;
    }

    merged.set(key, row);
    mergedByNameCity.add(nameCityKey);
  }

  for (const row of newRestaurants) {
    const key = makeRestaurantKey(row.name, row.address);
    const nameCityKey = makeNameCityKey(row.name, row.city);
    if (mergedByNameCity.has(nameCityKey)) {
      continue;
    }

    if (!merged.has(key)) {
      merged.set(key, row);
      mergedByNameCity.add(nameCityKey);
    }
  }

  return Array.from(merged.values()).sort((a, b) => {
    if (a.has_service_fee !== b.has_service_fee) {
      return a.has_service_fee ? 1 : -1;
    }
    return String(a.name).localeCompare(String(b.name));
  });
}

function removeDiningHalls(rows) {
  return rows.filter((row) => {
    const haystack = `${row.name ?? ''} ${row.neighborhood ?? ''} ${row.verification_notes ?? ''}`;
    return !hasDiningHallSignal(haystack);
  });
}

function dedupeByNameCity(rows) {
  const bestByKey = new Map();

  function score(row) {
    let value = 0;
    if (/,\s*[A-Za-z .'-]+,\s*CA\s*\d{5}$/i.test(row.address ?? '')) {
      value += 3;
    }
    if (Array.isArray(row.citations)) {
      value += Math.min(row.citations.length, 2);
    }
    if ((row.website ?? '').length > 0) {
      value += 1;
    }
    if ((row.address ?? '').length > 0) {
      value += 1;
    }
    return value;
  }

  for (const row of rows) {
    const key = makeNameCityKey(row.name, row.city);
    const existing = bestByKey.get(key);
    if (!existing || score(row) > score(existing)) {
      bestByKey.set(key, row);
    }
  }

  return Array.from(bestByKey.values());
}

const nowIso = new Date().toISOString();
const existingRaw = JSON.parse(await fs.readFile(datasetPath, 'utf8'));
const existingRestaurants = Array.isArray(existingRaw.restaurants) ? existingRaw.restaurants : [];

const chainResults = [];
for (const chain of CHAINS) {
  chainResults.push(await buildChainRows(chain));
}

const chainRows = dedupeRestaurants(
  chainResults.flatMap((result) => result.rows)
).filter((row) => !hasDiningHallSignal(`${row.name} ${row.neighborhood}`));

const mergedRestaurants = dedupeByNameCity(
  removeDiningHalls(mergeWithExisting(existingRestaurants, chainRows)).map(normalizeRestaurantRow)
);

const strictCount = mergedRestaurants.filter((row) => row.has_no_tip_policy && row.has_service_fee === false).length;
const serviceFeeCount = mergedRestaurants.filter((row) => row.has_no_tip_policy && row.has_service_fee === true).length;

const output = {
  generated_at: nowIso,
  data_as_of: nowIso.slice(0, 10),
  scraping_scope: 'Greater Los Angeles',
  excludes: ['dining halls', 'fast food chains'],
  restaurants: mergedRestaurants
};

const report = {
  generated_at: nowIso,
  chains: chainResults.map((row) => ({
    chain: row.chain,
    added: row.added,
    skipped: row.skipped,
    errors: row.errors.slice(0, 20)
  })),
  existing_restaurants: existingRestaurants.length,
  merged_restaurants: mergedRestaurants.length,
  strict_no_fee_count: strictCount,
  service_fee_count: serviceFeeCount
};

await fs.mkdir(path.dirname(datasetPath), { recursive: true });
await fs.mkdir(path.dirname(reportPath), { recursive: true });
await fs.writeFile(datasetPath, JSON.stringify(output, null, 2));
await fs.writeFile(reportPath, JSON.stringify(report, null, 2));

console.log(`Chain enrichment complete.
- existing restaurants: ${existingRestaurants.length}
- merged restaurants: ${mergedRestaurants.length}
- strict no-fee count: ${strictCount}
- service-fee count: ${serviceFeeCount}
- report: ${reportPath}`);
