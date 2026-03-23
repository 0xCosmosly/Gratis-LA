import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const DEFAULT_MAX_WEBSITES = 450;
const DEFAULT_CONCURRENCY = 10;
const OVERPASS_ENDPOINT = 'https://overpass-api.de/api/interpreter';
const outputPath = path.join(process.cwd(), 'data', 'scraped-greater-la-no-tip.json');
const iosBundlePath = path.join(process.cwd(), 'ios', 'App', 'App', 'public', 'local-restaurants.json');
const blacklistPath = path.join(process.cwd(), 'data', 'fast-food-blacklist.json');

const args = parseArgs(process.argv.slice(2));
const maxWebsites = Number(args['max-websites'] ?? DEFAULT_MAX_WEBSITES);
const concurrency = Number(args.concurrency ?? DEFAULT_CONCURRENCY);

const noTipPatterns = [
  /no tip(?:ping)?/i,
  /tips? not accepted/i,
  /do not accept tips?/i,
  /no gratuity/i,
  /gratuity is not accepted/i,
  /please do not tip/i,
  /gratuity included/i,
  /service (?:is )?included/i,
  /hospitality included/i,
  /inclusive pricing/i
];

const serviceFeePatterns = [
  /service fee/i,
  /facility fee/i,
  /mandatory fee/i,
  /surcharge/i,
  /gratuity (?:will be )?added/i,
  /\b\d+%\b[^.]{0,50}(?:service|facility|gratuity|fee)/i
];

const diningHallPatterns = [
  /\bdining hall\b/i,
  /\bcafeteria\b/i,
  /\bfood court\b/i,
  /\bcommons\b/i,
  /\bcampus dining\b/i,
  /\bstudent union\b/i,
  /\buniversity\b/i,
  /\bcollege\b/i,
  /\bdorm\b/i,
  /\bmeal plan\b/i
];

const greaterLABoundingTiles = [
  [33.5, -119.05, 34.95, -118.3],
  [33.5, -118.3, 34.95, -117.3]
];

function parseArgs(argv) {
  const values = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      continue;
    }

    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      values[key] = true;
      continue;
    }

    values[key] = next;
    i += 1;
  }
  return values;
}

function asWebsiteUrl(raw) {
  if (!raw) {
    return null;
  }

  const trimmed = String(raw).trim();
  if (trimmed.length === 0) {
    return null;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  return `https://${trimmed}`;
}

function normalizeHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 400000);
}

function detectPolicy(text) {
  return {
    noTipDetected: noTipPatterns.some((pattern) => pattern.test(text)),
    serviceFeeDetected: serviceFeePatterns.some((pattern) => pattern.test(text))
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchText(url, timeoutMs = 20000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'user-agent': 'NoTipLA-Scraper/1.0'
      }
    });

    if (!response.ok) {
      return { ok: false, status: response.status, text: '' };
    }

    return {
      ok: true,
      status: response.status,
      text: await response.text()
    };
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

function makeCandidateUrls(base) {
  try {
    const root = new URL(base);
    const variants = ['', '/menu', '/menus', '/faq', '/about', '/policies', '/visit'];
    return variants.map((suffix) => new URL(suffix, root).toString());
  } catch {
    return [base];
  }
}

function buildOverpassQuery([south, west, north, east]) {
  return `[out:json][timeout:210];
(
  node["amenity"="restaurant"]["name"]["website"](${south},${west},${north},${east});
  way["amenity"="restaurant"]["name"]["website"](${south},${west},${north},${east});
  relation["amenity"="restaurant"]["name"]["website"](${south},${west},${north},${east});
  node["amenity"="restaurant"]["name"]["contact:website"](${south},${west},${north},${east});
  way["amenity"="restaurant"]["name"]["contact:website"](${south},${west},${north},${east});
  relation["amenity"="restaurant"]["name"]["contact:website"](${south},${west},${north},${east});
);
out center tags;`;
}

async function fetchOverpassTile(bbox) {
  const query = buildOverpassQuery(bbox);
  const attempts = 3;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await fetch(OVERPASS_ENDPOINT, {
      method: 'POST',
      body: query,
      headers: {
        'content-type': 'text/plain',
        'user-agent': 'NoTipLA-Scraper/1.0'
      }
    });

    if (response.ok) {
      return response.json();
    }

    if (attempt < attempts) {
      await sleep(1200 * attempt);
    } else {
      throw new Error(`Overpass request failed after ${attempts} attempts with status ${response.status}`);
    }
  }

  return { elements: [] };
}

function buildAddress(tags) {
  const houseNumber = tags['addr:housenumber'];
  const street = tags['addr:street'];
  if (!houseNumber && !street) {
    return null;
  }
  return [houseNumber, street].filter(Boolean).join(' ');
}

function normalizeForId(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function isDiningHall(name, website) {
  const haystack = `${name} ${website ?? ''}`.toLowerCase();
  return diningHallPatterns.some((pattern) => pattern.test(haystack));
}

function isFastFood(name, blacklist) {
  const normalizedName = name.toLowerCase();
  return blacklist.some((entry) => normalizedName.includes(String(entry).toLowerCase()));
}

function formatDateLabel(isoDate) {
  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) {
    return 'Unknown';
  }
  return parsed.toISOString().slice(0, 10);
}

function makeCitation(sourceURL, excerpt) {
  return {
    source_name: 'Official website (auto-scrape)',
    source_url: sourceURL,
    excerpt
  };
}

async function runPool(items, limit, worker) {
  const results = [];
  let cursor = 0;

  async function runOne() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) {
        return;
      }

      const item = items[index];
      const result = await worker(item, index);
      if (result !== null) {
        results.push(result);
      }
    }
  }

  const workers = Array.from({ length: Math.max(1, limit) }, () => runOne());
  await Promise.all(workers);
  return results;
}

const fastFoodBlacklist = JSON.parse(await fs.readFile(blacklistPath, 'utf8'));
const uniqueByWebsite = new Map();

for (const bbox of greaterLABoundingTiles) {
  const payload = await fetchOverpassTile(bbox);
  const rows = payload.elements ?? [];

  for (const row of rows) {
    const tags = row.tags ?? {};
    const name = String(tags.name ?? '').trim();
    if (!name) {
      continue;
    }

    const websiteRaw = tags.website ?? tags['contact:website'] ?? null;
    const website = asWebsiteUrl(websiteRaw);
    if (!website) {
      continue;
    }

    if (isDiningHall(name, website)) {
      continue;
    }

    if (isFastFood(name, fastFoodBlacklist)) {
      continue;
    }

    const key = website.toLowerCase();
    if (uniqueByWebsite.has(key)) {
      continue;
    }

    const lat = typeof row.lat === 'number' ? row.lat : row.center?.lat ?? null;
    const lng = typeof row.lon === 'number' ? row.lon : row.center?.lon ?? null;

    uniqueByWebsite.set(key, {
      name,
      website,
      lat,
      lng,
      address: buildAddress(tags),
      city: tags['addr:city'] ?? null,
      neighborhood: tags['addr:suburb'] ?? tags['addr:neighbourhood'] ?? null
    });
  }
}

const candidates = Array.from(uniqueByWebsite.values())
  .sort((a, b) => a.name.localeCompare(b.name))
  .slice(0, maxWebsites);

const nowIso = new Date().toISOString();
const nextCheckAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

let inspected = 0;

const verified = await runPool(candidates, concurrency, async (candidate, index) => {
  if ((index + 1) % 25 === 0) {
    console.log(`Checked ${index + 1}/${candidates.length} websites...`);
  }

  inspected += 1;
  const candidateUrls = makeCandidateUrls(candidate.website);
  let matchedExcerpt = null;
  let matchedUrl = null;
  let serviceFeeDetected = false;

  for (const url of candidateUrls) {
    const response = await fetchText(url);
    if (!response.ok) {
      continue;
    }

    const normalized = normalizeHtml(response.text);
    const detection = detectPolicy(normalized);
    serviceFeeDetected = serviceFeeDetected || detection.serviceFeeDetected;

    if (!detection.noTipDetected) {
      continue;
    }

    matchedExcerpt = normalized
      .match(
        /(?:no tip(?:ping)?|tips? not accepted|do not accept tips?|no gratuity|gratuity included|service (?:is )?included|hospitality included)[^.]{0,140}\./i
      )?.[0]
      ?.trim() ?? 'No-tip/service-included language detected on official website.';
    matchedUrl = url;
    break;
  }

  if (!matchedExcerpt || serviceFeeDetected) {
    return null;
  }

  const slugBase = normalizeForId(candidate.name);
  const slug = `${slugBase}-${normalizeForId(new URL(candidate.website).hostname)}`;

  return {
    id: `scraped-${slug}`,
    slug,
    name: candidate.name,
    address: candidate.address,
    city: candidate.city,
    neighborhood: candidate.neighborhood,
    website: candidate.website,
    lat: candidate.lat,
    lng: candidate.lng,
    is_fast_food: false,
    has_no_tip_policy: true,
    has_service_fee: false,
    verification_status: 'candidate',
    verification_notes: 'Auto-scraped from official website. Manual review recommended.',
    last_checked_at: nowIso,
    next_check_at: nextCheckAt,
    citations: [makeCitation(matchedUrl ?? candidate.website, matchedExcerpt)]
  };
});

const uniqueByNameAddress = new Map();
for (const row of verified) {
  const dedupeKey = `${row.name.toLowerCase()}|${(row.address ?? '').toLowerCase()}`;
  if (!uniqueByNameAddress.has(dedupeKey)) {
    uniqueByNameAddress.set(dedupeKey, row);
  }
}

const restaurants = Array.from(uniqueByNameAddress.values());

const result = {
  generated_at: nowIso,
  data_as_of: formatDateLabel(nowIso),
  scraping_scope: 'Greater Los Angeles',
  excludes: ['dining halls', 'fast food chains', 'restaurants with detected service fee language'],
  candidate_count_checked: candidates.length,
  restaurants
};

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.mkdir(path.dirname(iosBundlePath), { recursive: true });
await fs.writeFile(outputPath, JSON.stringify(result, null, 2));

if (restaurants.length > 0) {
  await fs.writeFile(iosBundlePath, JSON.stringify(result, null, 2));
}

console.log(`Scraping complete.
- candidates checked: ${candidates.length}
- inspected pages: ${inspected}
- matched restaurants: ${restaurants.length}
- report: ${outputPath}
- iOS bundle dataset: ${
  restaurants.length > 0 ? `updated (${iosBundlePath})` : `kept existing (no new matches)`
}`);
