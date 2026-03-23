import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { PlaywrightCrawler } from 'crawlee';

try {
  process.loadEnvFile('.env');
} catch {}

try {
  process.loadEnvFile('.env.local');
} catch {}

const outputPath = path.join(process.cwd(), 'data', 'koreatown-site-policy-scan.json');
const seedDatasetPath = path.join(process.cwd(), 'data', 'tracked-restaurants.json');
const OVERPASS_ENDPOINT = 'https://overpass-api.de/api/interpreter';
const CLOUDFLARE_RATE_LIMIT_MS = 10_500;
const CLOUDFLARE_SAFE_BUDGET_MS = 9 * 60 * 1000;
const DEFAULT_MAX_WEBSITES = 80;
const DEFAULT_CRAWLEE_CONCURRENCY = 4;
const MAX_CLOUDFLARE_PAGES_PER_SITE = 6;
const MAX_CRAWLEE_PAGES_PER_SITE = 8;

const args = parseArgs(process.argv.slice(2));
const maxWebsites = Number(args['max-websites'] ?? DEFAULT_MAX_WEBSITES);
const crawleeConcurrency = Number(args.concurrency ?? DEFAULT_CRAWLEE_CONCURRENCY);

const KOREATOWN_BOUNDS = {
  south: 34.052,
  west: -118.316,
  north: 34.0735,
  east: -118.282
};

const noTipPatterns = [
  /no tip(?:ping)?/i,
  /tips? not accepted/i,
  /do not accept tips?/i,
  /no gratuity/i,
  /gratuity is not accepted/i,
  /please do not tip/i,
  /we are a no[- ]tipping establishment/i,
  /gratuity included/i,
  /service (?:is )?included/i,
  /hospitality included/i,
  /inclusive pricing/i
];

const feePatterns = [
  /service fee/i,
  /facility fee/i,
  /mandatory fee/i,
  /service charge/i,
  /surcharge/i,
  /gratuity (?:will be )?added/i,
  /gratuity added/i,
  /\b\d+%\b[^.]{0,90}(?:service|facility|gratuity|fee|charge)/i
];

const relevantPathPattern = /(menu|faq|policy|about|visit|location|order|info|koreatown|reservation|private-dining|rules|gratuity|service|charge)/i;

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      continue;
    }

    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      values[key] = true;
      continue;
    }

    values[key] = next;
    index += 1;
  }

  return values;
}

function normalizeWhitespace(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function asWebsiteUrl(raw) {
  const trimmed = normalizeWhitespace(raw);
  if (!trimmed) {
    return null;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  return `https://${trimmed}`;
}

function normalizeHtml(html) {
  return normalizeWhitespace(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&#8211;|&#8212;/g, ' - ')
      .replace(/&#8217;|&#39;/g, "'")
  ).slice(0, 500_000);
}

function excerpt(text, pattern) {
  const match = text.match(pattern);
  if (!match || match.index == null) {
    return null;
  }

  const start = Math.max(0, match.index - 110);
  const end = Math.min(text.length, match.index + 220);
  return text.slice(start, end).trim();
}

function detectPolicy(text) {
  const noTipPattern = noTipPatterns.find((pattern) => pattern.test(text)) ?? null;
  const feePattern = feePatterns.find((pattern) => pattern.test(text)) ?? null;
  return {
    noTipPattern,
    feePattern
  };
}

function safeHostname(url) {
  try {
    return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return null;
  }
}

function isSameSiteUrl(url, hostname) {
  const nextHostname = safeHostname(url);
  return Boolean(nextHostname && hostname && nextHostname === hostname);
}

function looksLikeWebPage(url) {
  try {
    const parsed = new URL(url);
    return /^https?:$/i.test(parsed.protocol) && !/\.(pdf|jpg|jpeg|png|gif|webp|svg|zip)$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function extractCandidateLinks(baseUrl, html, hostname) {
  const links = [];
  const seen = new Set();

  for (const match of html.matchAll(/href=["']([^"'#]+)["']/gi)) {
    const raw = match[1];
    if (!raw || raw.startsWith('mailto:') || raw.startsWith('tel:') || raw.startsWith('javascript:')) {
      continue;
    }

    try {
      const next = new URL(raw, baseUrl);
      const nextUrl = next.toString();
      if (seen.has(nextUrl)) {
        continue;
      }

      if (!looksLikeWebPage(nextUrl) || !isSameSiteUrl(nextUrl, hostname)) {
        continue;
      }

      const pathSignal = `${next.pathname}${next.search}`;
      if (next.pathname !== '/' && !relevantPathPattern.test(pathSignal)) {
        continue;
      }

      seen.add(nextUrl);
      links.push(nextUrl);
    } catch {
      continue;
    }
  }

  return links.slice(0, MAX_CRAWLEE_PAGES_PER_SITE);
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildOverpassQuery() {
  const { south, west, north, east } = KOREATOWN_BOUNDS;
  return `[out:json][timeout:180];
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

function isInKoreatown(lat, lng) {
  return lat >= KOREATOWN_BOUNDS.south && lat <= KOREATOWN_BOUNDS.north && lng >= KOREATOWN_BOUNDS.west && lng <= KOREATOWN_BOUNDS.east;
}

async function fetchDiscoveredRestaurants() {
  const overpassResponse = await fetch(OVERPASS_ENDPOINT, {
    method: 'POST',
    body: buildOverpassQuery(),
    headers: {
      'content-type': 'text/plain',
      'user-agent': 'GratisLA-KoreatownScan/2.0'
    }
  });

  if (!overpassResponse.ok) {
    throw new Error(`Overpass request failed with status ${overpassResponse.status}`);
  }

  const overpassPayload = await overpassResponse.json();
  const uniqueByWebsite = new Map();

  for (const row of overpassPayload.elements ?? []) {
    const tags = row.tags ?? {};
    const name = normalizeWhitespace(tags.name);
    const website = asWebsiteUrl(tags.website ?? tags['contact:website'] ?? null);
    if (!name || !website || uniqueByWebsite.has(website)) {
      continue;
    }

    uniqueByWebsite.set(website, {
      name,
      website,
      address: [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' '),
      lat: row.lat ?? row.center?.lat ?? null,
      lng: row.lon ?? row.center?.lon ?? null
    });
  }

  let seedRows = [];
  try {
    seedRows = JSON.parse(await fs.readFile(seedDatasetPath, 'utf8'));
  } catch {
    seedRows = [];
  }

  for (const row of Array.isArray(seedRows) ? seedRows : []) {
    const website = asWebsiteUrl(row.website);
    const lat = Number(row.lat);
    const lng = Number(row.lng);
    if (!website || uniqueByWebsite.has(website) || !Number.isFinite(lat) || !Number.isFinite(lng) || !isInKoreatown(lat, lng)) {
      continue;
    }

    uniqueByWebsite.set(website, {
      name: normalizeWhitespace(row.name),
      website,
      address: normalizeWhitespace(row.address),
      lat,
      lng
    });
  }

  return Array.from(uniqueByWebsite.values())
    .sort((left, right) => left.name.localeCompare(right.name))
    .slice(0, Number.isFinite(maxWebsites) ? maxWebsites : DEFAULT_MAX_WEBSITES);
}

function createEmptyResult(restaurant, checkedUrls = []) {
  return {
    ...restaurant,
    matched_url: null,
    checked_urls: Array.from(new Set(checkedUrls)),
    no_tip_excerpt: null,
    fee_excerpt: null,
    scan_method: null
  };
}

function applyDetection(result, url, detection, text, method) {
  return {
    ...result,
    matched_url: url,
    no_tip_excerpt: detection.noTipPattern ? excerpt(text, detection.noTipPattern) : null,
    fee_excerpt: detection.feePattern ? excerpt(text, detection.feePattern) : null,
    scan_method: method
  };
}

function createCloudflareClient() {
  const accountId = normalizeWhitespace(process.env.CLOUDFLARE_ACCOUNT_ID);
  const apiToken = normalizeWhitespace(process.env.CLOUDFLARE_API_TOKEN);

  return {
    enabled: Boolean(accountId && apiToken),
    accountId,
    apiToken,
    exhausted: false,
    disabledReason: accountId && apiToken ? null : 'Missing CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_TOKEN',
    browserMsUsed: 0,
    requestsAttempted: 0,
    requestsSucceeded: 0,
    lastStartedAt: 0
  };
}

function looksLikeCloudflareQuotaError(status, payload) {
  if (status === 429 || status === 402) {
    return true;
  }

  const detail = JSON.stringify(payload?.errors ?? payload?.messages ?? payload ?? {});
  return /(limit|quota|rate|exceed|browser rendering)/i.test(detail);
}

function extractCloudflareBrowserTime(response) {
  const candidates = [
    'x-browser-ms-used',
    'x-cloudflare-browser-rendering-ms-used',
    'browser-rendering-time',
    'x-browser-rendering-time'
  ];

  for (const header of candidates) {
    const value = response.headers.get(header);
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
  }

  return 0;
}

async function fetchWithCloudflare(client, url) {
  if (!client.enabled || client.exhausted) {
    return { ok: false, quotaStop: client.exhausted, html: null };
  }

  const now = Date.now();
  const waitMs = Math.max(0, CLOUDFLARE_RATE_LIMIT_MS - (now - client.lastStartedAt));
  if (waitMs > 0) {
    await sleep(waitMs);
  }
  client.lastStartedAt = Date.now();
  client.requestsAttempted += 1;

  let response;
  let payload = null;

  try {
    response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${client.accountId}/browser-rendering/content`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${client.apiToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          url,
          gotoOptions: {
            waitUntil: 'domcontentloaded',
            timeout: 30_000
          }
        })
      }
    );
  } catch (error) {
    return {
      ok: false,
      quotaStop: false,
      error: error instanceof Error ? error.message : String(error),
      html: null
    };
  }

  const browserMs = extractCloudflareBrowserTime(response);
  client.browserMsUsed += browserMs;

  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok || payload?.success === false) {
    const quotaStop = looksLikeCloudflareQuotaError(response.status, payload);
    if (quotaStop || client.browserMsUsed >= CLOUDFLARE_SAFE_BUDGET_MS) {
      client.exhausted = true;
    }

    return {
      ok: false,
      quotaStop,
      error: normalizeWhitespace(
        payload?.errors?.map((entry) => entry.message).join(' ') ??
          payload?.messages?.map((entry) => entry.message).join(' ') ??
          `Cloudflare returned status ${response.status}`
      ),
      html: null
    };
  }

  if (client.browserMsUsed >= CLOUDFLARE_SAFE_BUDGET_MS) {
    client.exhausted = true;
  }

  const html =
    typeof payload?.result === 'string'
      ? payload.result
      : typeof payload?.result?.content === 'string'
        ? payload.result.content
        : null;

  if (!html) {
    return {
      ok: false,
      quotaStop: false,
      error: 'Cloudflare did not return HTML content',
      html: null
    };
  }

  client.requestsSucceeded += 1;

  return {
    ok: true,
    quotaStop: false,
    html
  };
}

async function scanWithCloudflare(client, restaurant) {
  const result = createEmptyResult(restaurant);
  if (!client.enabled || client.exhausted) {
    return { result, unresolved: true };
  }

  const checked = new Set();
  const queued = [restaurant.website];
  const hostname = safeHostname(restaurant.website);

  while (queued.length > 0 && checked.size < MAX_CLOUDFLARE_PAGES_PER_SITE && !client.exhausted) {
    const nextUrl = queued.shift();
    if (!nextUrl || checked.has(nextUrl)) {
      continue;
    }

    checked.add(nextUrl);
    result.checked_urls.push(nextUrl);

    const response = await fetchWithCloudflare(client, nextUrl);
    if (!response.ok || !response.html) {
      return { result: createEmptyResult(restaurant, result.checked_urls), unresolved: true };
    }

    const normalized = normalizeHtml(response.html);
    const detection = detectPolicy(normalized);
    if (detection.noTipPattern || detection.feePattern) {
      return {
        result: applyDetection(result, nextUrl, detection, normalized, 'cloudflare'),
        unresolved: false
      };
    }

    const candidateLinks = extractCandidateLinks(nextUrl, response.html, hostname);
    for (const candidate of candidateLinks) {
      if (!checked.has(candidate) && queued.length < MAX_CLOUDFLARE_PAGES_PER_SITE) {
        queued.push(candidate);
      }
    }
  }

  return { result: createEmptyResult(restaurant, result.checked_urls), unresolved: true };
}

async function scanWithCrawlee(restaurants, priorResults) {
  if (restaurants.length === 0) {
    return [];
  }

  const states = new Map();

  for (const restaurant of restaurants) {
    const prior = priorResults.get(restaurant.website) ?? createEmptyResult(restaurant);
    states.set(restaurant.website, {
      ...prior,
      checked_urls: Array.from(new Set(prior.checked_urls ?? [])),
      checkedSet: new Set(prior.checked_urls ?? []),
      hostname: safeHostname(restaurant.website)
    });
  }

  const crawler = new PlaywrightCrawler({
    headless: true,
    maxConcurrency: Math.max(1, crawleeConcurrency),
    maxRequestsPerCrawl: restaurants.length * MAX_CRAWLEE_PAGES_PER_SITE,
    requestHandlerTimeoutSecs: 45,
    launchContext: {
      launchOptions: {
        ignoreHTTPSErrors: true
      }
    },
    preNavigationHooks: [
      async ({ page }) => {
        await page.route('**/*', (route) => {
          const resourceType = route.request().resourceType();
          if (resourceType === 'image' || resourceType === 'media' || resourceType === 'font') {
            return route.abort();
          }
          return route.continue();
        });
      }
    ],
    async requestHandler({ page, request, enqueueLinks, log }) {
      const rootWebsite = request.userData.rootWebsite;
      const state = states.get(rootWebsite);
      if (!state || state.matched_url) {
        return;
      }

      await page.waitForLoadState('domcontentloaded').catch(() => {});
      await page.waitForTimeout(900);

      const loadedUrl = normalizeWhitespace(request.loadedUrl ?? page.url() ?? request.url);
      if (!loadedUrl || !isSameSiteUrl(loadedUrl, state.hostname) || state.checkedSet.has(loadedUrl)) {
        return;
      }

      state.checkedSet.add(loadedUrl);
      state.checked_urls.push(loadedUrl);

      const html = await page.content();
      const normalized = normalizeHtml(html);
      const detection = detectPolicy(normalized);

      if (detection.noTipPattern || detection.feePattern) {
        state.matched_url = loadedUrl;
        state.no_tip_excerpt = detection.noTipPattern ? excerpt(normalized, detection.noTipPattern) : null;
        state.fee_excerpt = detection.feePattern ? excerpt(normalized, detection.feePattern) : null;
        state.scan_method =
          state.scan_method === 'cloudflare' ? 'cloudflare+crawlee' : 'crawlee';
        return;
      }

      const depth = Number(request.userData.depth ?? 0);
      const remainingBudget = MAX_CRAWLEE_PAGES_PER_SITE - state.checked_urls.length;
      if (depth >= 1 || remainingBudget <= 0) {
        return;
      }

      const candidateLinks = extractCandidateLinks(loadedUrl, html, state.hostname).filter(
        (candidate) => !state.checkedSet.has(candidate)
      );

      if (candidateLinks.length === 0) {
        return;
      }

      await enqueueLinks({
        urls: candidateLinks,
        strategy: 'same-origin',
        limit: remainingBudget,
        transformRequestFunction: (nextRequest) => {
          const nextUrl = normalizeWhitespace(nextRequest.url);
          if (!nextUrl || state.matched_url || state.checkedSet.has(nextUrl) || !isSameSiteUrl(nextUrl, state.hostname)) {
            return false;
          }

          return {
            ...nextRequest,
            uniqueKey: `${rootWebsite}:${nextUrl}`,
            userData: {
              ...request.userData,
              rootWebsite,
              depth: depth + 1
            }
          };
        }
      });
    },
    failedRequestHandler({ request }) {
      const rootWebsite = request.userData.rootWebsite;
      const state = states.get(rootWebsite);
      if (!state) {
        return;
      }

      const failedUrl = normalizeWhitespace(request.loadedUrl ?? request.url);
      if (failedUrl && !state.checkedSet.has(failedUrl)) {
        state.checkedSet.add(failedUrl);
        state.checked_urls.push(failedUrl);
      }
    },
    errorHandler({ request }, error) {
      const rootWebsite = request.userData.rootWebsite;
      const state = states.get(rootWebsite);
      if (!state) {
        return;
      }
      state.last_error = error instanceof Error ? error.message : String(error);
    }
  });

  const seedRequests = restaurants.map((restaurant) => ({
    url: restaurant.website,
    uniqueKey: restaurant.website,
    userData: {
      rootWebsite: restaurant.website,
      depth: 0
    }
  }));

  await crawler.run(seedRequests);

  return restaurants.map((restaurant) => {
    const state = states.get(restaurant.website);
    if (!state) {
      return createEmptyResult(restaurant);
    }

    const { checkedSet, hostname, last_error, ...rest } = state;
    return {
      ...rest,
      scan_method: rest.scan_method ?? 'crawlee',
      last_error: last_error ?? null
    };
  });
}

const restaurants = await fetchDiscoveredRestaurants();
const cloudflareClient = createCloudflareClient();
const stagedResults = new Map();
const unresolvedRestaurants = [];

for (const restaurant of restaurants) {
  const scan = await scanWithCloudflare(cloudflareClient, restaurant);
  stagedResults.set(restaurant.website, scan.result);
  if (scan.unresolved) {
    unresolvedRestaurants.push(restaurant);
  }
}

const crawleeResults = await scanWithCrawlee(unresolvedRestaurants, stagedResults);

for (const result of crawleeResults) {
  stagedResults.set(result.website, result);
}

const allResults = restaurants
  .map((restaurant) => stagedResults.get(restaurant.website) ?? createEmptyResult(restaurant))
  .sort((left, right) => left.name.localeCompare(right.name));

const matches = allResults.filter((restaurant) => restaurant.matched_url);

const report = {
  generated_at: new Date().toISOString(),
  search_scope: 'Koreatown official restaurant websites',
  websites_checked: restaurants.length,
  matched_records: matches.length,
  cloudflare: {
    configured: cloudflareClient.enabled,
    disabled_reason: cloudflareClient.disabledReason,
    exhausted: cloudflareClient.exhausted,
    requests_attempted: cloudflareClient.requestsAttempted,
    requests_succeeded: cloudflareClient.requestsSucceeded,
    browser_ms_used: cloudflareClient.browserMsUsed
  },
  fallback: {
    provider: 'crawlee-playwright',
    used: unresolvedRestaurants.length > 0,
    unresolved_websites: unresolvedRestaurants.length
  },
  restaurants: matches
};

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, JSON.stringify(report, null, 2));

console.log(`Koreatown scan complete.
- websites checked: ${restaurants.length}
- matched records: ${matches.length}
- cloudflare configured: ${cloudflareClient.enabled}
- cloudflare exhausted: ${cloudflareClient.exhausted}
- crawlee fallback websites: ${unresolvedRestaurants.length}
- report: ${outputPath}`);
