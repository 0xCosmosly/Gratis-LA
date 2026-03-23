import fs from 'node:fs/promises';
import path from 'node:path';

const seedPath = path.join(process.cwd(), 'data', 'tracked-restaurants.json');
const domainsPath = path.join(process.cwd(), 'data', 'reputable-source-domains.json');
const reportPath = path.join(process.cwd(), 'data', 'source-check-report.json');

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
    .trim();
}

function detectPolicy(text) {
  const noTipDetected = noTipPatterns.some((pattern) => pattern.test(text));
  const serviceFeeDetected = serviceFeePatterns.some((pattern) => pattern.test(text));

  return {
    noTipDetected,
    serviceFeeDetected
  };
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
      return {
        ok: false,
        status: response.status,
        text: ''
      };
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

const seed = JSON.parse(await fs.readFile(seedPath, 'utf8'));
const reputableDomains = JSON.parse(await fs.readFile(domainsPath, 'utf8'));
const report = {
  generated_at: new Date().toISOString(),
  checks: []
};

function isDomainReputable(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    return reputableDomains.some((domain) => host === String(domain).toLowerCase());
  } catch {
    return false;
  }
}

for (const restaurant of seed) {
  const citations = Array.isArray(restaurant.citations) ? restaurant.citations : [];
  const citationChecks = [];

  for (const citation of citations) {
    const domainReputable = isDomainReputable(citation.source_url);

    const response = await fetchWithTimeout(citation.source_url);

    if (!response.ok) {
      citationChecks.push({
        source_name: citation.source_name,
        source_url: citation.source_url,
        domain_reputable: domainReputable,
        ok: false,
        status: response.status,
        error: response.error ?? `HTTP ${response.status}`
      });
      continue;
    }

    const normalizedText = normalizeHtml(response.text).slice(0, 300000);
    const detection = detectPolicy(normalizedText);

    citationChecks.push({
      source_name: citation.source_name,
      source_url: citation.source_url,
      domain_reputable: domainReputable,
      ok: true,
      status: response.status,
      no_tip_detected: detection.noTipDetected,
      service_fee_detected: detection.serviceFeeDetected
    });
  }

  const hasUntrustedSource = citationChecks.some((check) => check.domain_reputable === false);
  const detectedServiceFee = citationChecks.some((check) => check.service_fee_detected === true);
  const detectedNoTip = citationChecks.some((check) => check.no_tip_detected === true);

  let recommendation = 'needs_manual_review';
  if (detectedServiceFee) {
    recommendation = 'reject_service_fee';
  } else if (hasUntrustedSource) {
    recommendation = 'needs_reputable_source';
  } else if (detectedNoTip) {
    recommendation = 'candidate_ok';
  }

  report.checks.push({
    slug: restaurant.slug,
    name: restaurant.name,
    recommendation,
    citation_checks: citationChecks
  });
}

await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
console.log(`Wrote source check report to ${reportPath}`);
