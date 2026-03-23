import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false }
});

const blacklistPath = path.join(process.cwd(), 'data', 'fast-food-blacklist.json');
const domainsPath = path.join(process.cwd(), 'data', 'reputable-source-domains.json');
const reportPath = path.join(process.cwd(), 'data', 'latest-verification-report.json');
const blacklist = JSON.parse(await fs.readFile(blacklistPath, 'utf8'));
const reputableDomains = JSON.parse(await fs.readFile(domainsPath, 'utf8'));

const noTipPatterns = [
  /no tip(?:ping)?/i,
  /tips? not accepted/i,
  /do not accept tips?/i,
  /no gratuity/i,
  /gratuity is not accepted/i
];

const serviceFeePatterns = [
  /service fee/i,
  /facility fee/i,
  /mandatory fee/i,
  /surcharge/i,
  /gratuity (?:will be )?added/i,
  /\b\d+%\b[^.]{0,40}(?:service|facility|gratuity|fee)/i
];

function normalizeHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300000)
    .toLowerCase();
}

function detect(text) {
  return {
    hasNoTipLanguage: noTipPatterns.some((pattern) => pattern.test(text)),
    hasServiceFeeLanguage: serviceFeePatterns.some((pattern) => pattern.test(text))
  };
}

function containsBlacklistedChain(name) {
  const normalized = name.toLowerCase();
  return blacklist.some((chain) => normalized.includes(String(chain).toLowerCase()));
}

function isDomainReputable(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    return reputableDomains.some((domain) => host === String(domain).toLowerCase());
  } catch {
    return false;
  }
}

async function fetchWithTimeout(url, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent': 'NoTipMapVerifier/1.0 (GitHub Action)'
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

function addDaysIso(days) {
  const next = new Date();
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString();
}

const { data: restaurants, error: restaurantError } = await supabase
  .from('restaurants')
  .select('id, slug, name, verification_status')
  .neq('verification_status', 'rejected');

if (restaurantError) {
  console.error('Could not load restaurants:', restaurantError.message);
  process.exit(1);
}

const restaurantRows = restaurants ?? [];
if (restaurantRows.length === 0) {
  console.log('No restaurants to verify.');
  process.exit(0);
}

const restaurantIds = restaurantRows.map((row) => row.id);
const { data: citations, error: citationError } = await supabase
  .from('citations')
  .select('id, restaurant_id, source_name, source_url')
  .in('restaurant_id', restaurantIds);

if (citationError) {
  console.error('Could not load citations:', citationError.message);
  process.exit(1);
}

const citationMap = new Map();
for (const citation of citations ?? []) {
  const existing = citationMap.get(citation.restaurant_id) ?? [];
  existing.push(citation);
  citationMap.set(citation.restaurant_id, existing);
}

const report = {
  generated_at: new Date().toISOString(),
  checks: []
};

for (const restaurant of restaurantRows) {
  const isFastFood = containsBlacklistedChain(restaurant.name);
  const relatedCitations = citationMap.get(restaurant.id) ?? [];

  let hasNoTipLanguage = false;
  let hasServiceFeeLanguage = false;
  const citationResults = [];

  for (const citation of relatedCitations) {
    const domainReputable = isDomainReputable(citation.source_url);
    if (!domainReputable) {
      citationResults.push({
        source_name: citation.source_name,
        source_url: citation.source_url,
        ok: false,
        status: null,
        error: 'Source domain not in approved reputable-source list.'
      });
      continue;
    }

    const response = await fetchWithTimeout(citation.source_url);

    if (!response.ok) {
      citationResults.push({
        source_name: citation.source_name,
        source_url: citation.source_url,
        ok: false,
        status: response.status,
        error: response.error ?? `HTTP ${response.status}`
      });
      continue;
    }

    const detection = detect(normalizeHtml(response.text));
    hasNoTipLanguage = hasNoTipLanguage || detection.hasNoTipLanguage;
    hasServiceFeeLanguage = hasServiceFeeLanguage || detection.hasServiceFeeLanguage;

    citationResults.push({
      source_name: citation.source_name,
      source_url: citation.source_url,
      ok: true,
      status: response.status,
      no_tip_detected: detection.hasNoTipLanguage,
      service_fee_detected: detection.hasServiceFeeLanguage
    });

    await supabase.from('citations').update({ checked_at: new Date().toISOString() }).eq('id', citation.id);
  }

  const nowIso = new Date().toISOString();
  const updatePayload = {
    last_checked_at: nowIso,
    next_check_at: addDaysIso(7)
  };

  let recommendation = 'needs_review';

  if (isFastFood) {
    recommendation = 'rejected_fast_food';
    Object.assign(updatePayload, {
      is_fast_food: true,
      verification_status: 'rejected',
      verification_notes: 'Automatically rejected by default fast-food blacklist.'
    });
  } else if (hasServiceFeeLanguage) {
    recommendation = 'rejected_service_fee';
    Object.assign(updatePayload, {
      has_service_fee: true,
      verification_status: 'rejected',
      verification_notes: 'Automatically rejected because source text includes service fee language.'
    });
  } else if (hasNoTipLanguage) {
    recommendation = 'candidate_no_tip';
    Object.assign(updatePayload, {
      has_no_tip_policy: true,
      has_service_fee: false,
      verification_status: restaurant.verification_status === 'verified' ? 'verified' : 'candidate',
      verification_notes:
        restaurant.verification_status === 'verified'
          ? 'Still verified by prior manual review. Auto-check found no-tip language and no service-fee language.'
          : 'Auto-check found no-tip language and no service-fee language. Keep as candidate until manual review.'
    });
  } else {
    recommendation = 'needs_review';
    Object.assign(updatePayload, {
      verification_status: 'needs_review',
      verification_notes: 'Could not confirm no-tip policy from current source text. Needs manual review.'
    });
  }

  const { error: updateError } = await supabase.from('restaurants').update(updatePayload).eq('id', restaurant.id);
  if (updateError) {
    console.error(`Failed to update ${restaurant.name}: ${updateError.message}`);
  }

  report.checks.push({
    slug: restaurant.slug,
    name: restaurant.name,
    recommendation,
    citation_results: citationResults
  });
}

await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
console.log(`Verification run complete. Report saved to ${reportPath}`);
