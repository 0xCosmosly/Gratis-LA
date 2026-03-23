#!/usr/bin/env python3
"""
Scrapling-based checker for Gratis LA uncertain candidates.
Uses get -> fetch -> stealthy-fetch escalation per the user's instructions.
"""
import json
import re
import sys
import time
from urllib.parse import urljoin, urlparse

from scrapling import Fetcher, StealthyFetcher

# Scrapling "get" = Fetcher().get()
# Scrapling "fetch" = StealthyFetcher(auto_match=False).fetch() -- uses playwright basic
# Scrapling "stealthy-fetch" = StealthyFetcher().fetch() -- uses camoufox/stealth

POLICY_PHRASES = [
    r'no tip(?:ping)?',
    r'no-tipping establishment',
    r'tips?\s+not\s+accepted',
    r'no tips?\s+(?:are\s+)?expected\s+or\s+accepted',
    r'gratuity[- ]free',
    r'service\s+included',
    r'hospitality\s+included',
    r'facility\s+fee',
    r'service\s+fee',
    r'service\s+charge',
    r'mandatory\s+fee',
    r'fee\s+will\s+be\s+added\s+to\s+(?:your|every|all)\s+bill',
    r'(?:gratuity|service\s+charge|fee)\s+(?:is\s+)?(?:automatically\s+)?(?:added|included|applied)',
    r'\d+%\s*(?:service|facility|gratuity|fee|charge)',
    r'(?:service|facility|gratuity)\s*(?:fee|charge)?\s*(?:of\s+)?\d+%',
]

PARTY_EXCLUSION = [
    r'parties?\s+of\s+\d+\s+or\s+more',
    r'groups?\s+of\s+\d+\s+or\s+more',
    r'tables?\s+of\s+\d+\s+or\s+more',
    r'\d+\s+or\s+more\s+(?:guests?|people|persons?|adults?|diners?)',
]

LINK_KEYWORDS = [
    'faq', 'menu', 'reservation', 'reservations', 'locations', 'location',
    'policy', 'visit', 'dine', 'restaurant', 'about', 'private-dining',
    'info', 'contact', 'order', 'service', 'gratuity', 'rules'
]

CANDIDATES = [
    {"name": "Parks BBQ", "website": "https://parksbbq.com/"},
    {"name": "Sun Nong Dan", "website": "https://www.sunnongdan.net/"},
    {"name": "Quarters Korean BBQ", "website": "https://www.quarterskbbq.com/"},
    {"name": "Ahgassi Gopchang", "website": "http://www.ahgassicopchang.com/"},
    {"name": "MUN Korean Steakhouse", "website": "https://munkoreansteakhouse.com/"},
    {"name": "BBQ Chung Dam", "website": "https://www.bbqchungdam.com/"},
    {"name": "Aki Shabu", "website": "https://www.akishabuktown.com/"},
    {"name": "Restaurant Ki", "website": "https://restaurantki.com/"},
    {"name": "Petit Trois", "website": "https://petittrois.com/"},
    {"name": "Jeong Yuk Jeom", "website": "https://www.jeongyukjeom.com/"},
    {"name": "Origin Korean BBQ", "website": "https://www.originkbbq.com/"},
    {"name": "Joo Pocha", "website": "https://pochahouse.com/"},
    {"name": "Pigya", "website": "https://www.pigyarestaurant.com/"},
    {"name": "Moo Dae Po II", "website": "http://www.moodaepobbq.com/"},
    {"name": "Bulgogi Hut", "website": "https://bulgogihut.com/"},
]


def extract_text(page):
    """Extract visible text from a Scrapling page response."""
    try:
        # Try to get text content
        text = page.get_all_text() if hasattr(page, 'get_all_text') else ""
        if not text:
            text = page.text if hasattr(page, 'text') else str(page)
        return re.sub(r'\s+', ' ', text).strip()
    except Exception as e:
        return ""


def extract_links(page, base_url):
    """Extract same-domain links that might contain policy info."""
    links = set()
    parsed_base = urlparse(base_url)
    base_domain = parsed_base.netloc.replace('www.', '')

    try:
        all_links = page.css('a')
        for link in all_links:
            href = link.attrib.get('href', '')
            if not href or href.startswith('#') or href.startswith('mailto:') or href.startswith('tel:'):
                continue
            full_url = urljoin(base_url, href)
            parsed = urlparse(full_url)
            link_domain = parsed.netloc.replace('www.', '')
            if link_domain == base_domain:
                path_lower = parsed.path.lower()
                if any(kw in path_lower for kw in LINK_KEYWORDS):
                    links.add(full_url.split('#')[0].split('?')[0])
    except Exception:
        pass

    # Also add common subpages
    for path in ['/menu', '/faq', '/policy', '/reservation', '/reservations',
                 '/location', '/locations', '/about', '/private-dining', '/contact',
                 '/visit', '/info']:
        links.add(urljoin(base_url, path))

    return list(links)[:15]


def find_policy_matches(text):
    """Search text for policy phrases. Returns list of (pattern, match, context)."""
    matches = []
    text_lower = text.lower()
    for pattern in POLICY_PHRASES:
        for m in re.finditer(pattern, text_lower):
            start = max(0, m.start() - 100)
            end = min(len(text), m.end() + 150)
            context = text[start:end].strip()
            matches.append({
                'pattern': pattern,
                'matched': m.group(),
                'context': context
            })
    return matches


def is_party_only(context):
    """Check if a policy match is only for large parties."""
    context_lower = context.lower()
    for pattern in PARTY_EXCLUSION:
        if re.search(pattern, context_lower):
            return True
    return False


def scrapling_get(url, timeout=15):
    """Level 1: Simple GET request via Scrapling Fetcher."""
    try:
        fetcher = Fetcher(auto_match=False)
        page = fetcher.get(url, timeout=timeout)
        return page
    except Exception as e:
        print(f"    [get] FAILED for {url}: {e}", file=sys.stderr)
        return None


def scrapling_fetch(url, timeout=30):
    """Level 2: Dynamic fetch via Scrapling StealthyFetcher with basic mode."""
    try:
        fetcher = StealthyFetcher(auto_match=False)
        page = fetcher.fetch(url, headless=True, timeout=timeout * 1000)
        return page
    except Exception as e:
        print(f"    [fetch] FAILED for {url}: {e}", file=sys.stderr)
        return None


def scrapling_stealthy_fetch(url, timeout=30):
    """Level 3: Full stealth via Scrapling StealthyFetcher."""
    try:
        fetcher = StealthyFetcher(auto_match=True)
        page = fetcher.fetch(url, headless=True, timeout=timeout * 1000)
        return page
    except Exception as e:
        print(f"    [stealthy-fetch] FAILED for {url}: {e}", file=sys.stderr)
        return None


def check_page(url, escalation_level=0):
    """Check a single page, escalating as needed. Returns (text, page, method)."""
    methods = [
        ("get", scrapling_get),
        ("fetch", scrapling_fetch),
        ("stealthy-fetch", scrapling_stealthy_fetch),
    ]

    for i in range(escalation_level, len(methods)):
        method_name, method_func = methods[i]
        print(f"    Trying [{method_name}] on {url}", file=sys.stderr)
        page = method_func(url)
        if page is not None:
            text = extract_text(page)
            if text and len(text) > 50:
                return text, page, method_name
            else:
                print(f"    [{method_name}] returned insufficient text ({len(text) if text else 0} chars)", file=sys.stderr)
        time.sleep(1)

    return None, None, None


def check_restaurant(candidate):
    """Full check for a single restaurant."""
    name = candidate['name']
    website = candidate['website']
    print(f"\n{'='*60}", file=sys.stderr)
    print(f"Checking: {name} ({website})", file=sys.stderr)
    print(f"{'='*60}", file=sys.stderr)

    result = {
        'name': name,
        'website': website,
        'checked_urls': [],
        'policy_matches': [],
        'classification': None,
        'source_url': None,
        'exact_excerpt': None,
        'reason': None,
        'method_used': None,
    }

    # Step 1: Check homepage
    print(f"  Step 1: Homepage", file=sys.stderr)
    text, page, method = check_page(website)
    result['checked_urls'].append(website)

    if text is None:
        result['classification'] = 'unverified'
        result['reason'] = 'Official website could not be reached.'
        result['source_url'] = website
        return result

    # Check homepage text for policy
    matches = find_policy_matches(text)
    if matches:
        for m in matches:
            if not is_party_only(m['context']):
                result['policy_matches'].append(m)
                print(f"  FOUND on homepage: {m['matched']}", file=sys.stderr)
                print(f"    Context: {m['context'][:200]}", file=sys.stderr)

    # Step 2: Extract same-domain links
    subpage_urls = []
    if page is not None:
        subpage_urls = extract_links(page, website)
        print(f"  Found {len(subpage_urls)} candidate subpages", file=sys.stderr)

    # Step 3: Check sitemap
    parsed = urlparse(website)
    base = f"{parsed.scheme}://{parsed.netloc}"
    for sitemap_path in ['/sitemap.xml', '/sitemap_index.xml', '/wp-sitemap.xml']:
        sitemap_url = base + sitemap_path
        if sitemap_url not in result['checked_urls']:
            print(f"  Checking sitemap: {sitemap_url}", file=sys.stderr)
            sm_text, sm_page, sm_method = check_page(sitemap_url, escalation_level=0)
            result['checked_urls'].append(sitemap_url)
            if sm_text:
                # Extract URLs from sitemap
                for sm_match in re.finditer(r'<loc>(https?://[^<]+)</loc>', sm_text):
                    url_found = sm_match.group(1)
                    path_lower = urlparse(url_found).path.lower()
                    if any(kw in path_lower for kw in LINK_KEYWORDS):
                        if url_found not in subpage_urls:
                            subpage_urls.append(url_found)

    # Step 4-6: Check subpages
    for sub_url in subpage_urls[:12]:
        if sub_url in result['checked_urls']:
            continue
        print(f"  Checking subpage: {sub_url}", file=sys.stderr)
        sub_text, sub_page, sub_method = check_page(sub_url)
        result['checked_urls'].append(sub_url)

        if sub_text:
            sub_matches = find_policy_matches(sub_text)
            for m in sub_matches:
                if not is_party_only(m['context']):
                    m['source_url'] = sub_url
                    result['policy_matches'].append(m)
                    print(f"  FOUND on {sub_url}: {m['matched']}", file=sys.stderr)
                    print(f"    Context: {m['context'][:200]}", file=sys.stderr)

        time.sleep(0.5)

    # Step 8: Classify
    if not result['policy_matches']:
        result['classification'] = 'unverified'
        result['reason'] = 'No official online policy text found.'
        result['source_url'] = website
    else:
        # Analyze the matches
        best_match = result['policy_matches'][0]
        context = best_match['context'].lower()

        # Check for no-tip patterns
        no_tip = any(re.search(p, context) for p in [
            r'no tip(?:ping)?', r'tips?\s+not\s+accepted',
            r'no-tipping', r'gratuity[- ]free',
            r'no tips?\s+(?:are\s+)?expected'
        ])

        # Check for fee patterns
        has_fee = any(re.search(p, context) for p in [
            r'service\s+fee', r'facility\s+fee', r'service\s+charge',
            r'mandatory\s+fee', r'hospitality\s+(?:fee|charge|included)',
            r'\d+%.*(?:fee|charge|service|facility)',
            r'fee\s+will\s+be\s+added'
        ])

        # Check if party-only somewhere in full context
        any_party_only = any(is_party_only(m['context']) for m in result['policy_matches'])
        all_party_only = all(is_party_only(m['context']) for m in result['policy_matches'])

        if all_party_only:
            result['classification'] = 'rejected'
            result['reason'] = f"Policy only applies to large parties."
            result['source_url'] = best_match.get('source_url', website)
            result['exact_excerpt'] = best_match['context'][:300]
        elif no_tip and not has_fee:
            result['classification'] = 'accepted_no_tip'
            result['reason'] = 'Official source says no tipping.'
            result['source_url'] = best_match.get('source_url', website)
            result['exact_excerpt'] = best_match['context'][:300]
        elif no_tip and has_fee:
            result['classification'] = 'accepted_included'
            result['reason'] = 'Official source says no tipping with a mandatory fee added.'
            result['source_url'] = best_match.get('source_url', website)
            result['exact_excerpt'] = best_match['context'][:300]
        elif has_fee and not any_party_only:
            result['classification'] = 'accepted_included'
            result['reason'] = 'Official source says a mandatory fee is added to bills.'
            result['source_url'] = best_match.get('source_url', website)
            result['exact_excerpt'] = best_match['context'][:300]
        else:
            result['classification'] = 'unverified'
            result['reason'] = 'Policy text found but unclear if it applies to every bill.'
            result['source_url'] = best_match.get('source_url', website)
            result['exact_excerpt'] = best_match['context'][:300]

    print(f"  => Classification: {result['classification']}", file=sys.stderr)
    print(f"  => Reason: {result['reason']}", file=sys.stderr)
    return result


SEED_FILE = '/Users/ray/Documents/2. AI Coding/Gratis LA/data/tracked-restaurants.json'


def normalize_name(name):
    return re.sub(r'[^a-z0-9]', '', name.lower())


def normalize_domain(url):
    try:
        return urlparse(url).netloc.replace('www.', '').lower()
    except Exception:
        return ''


def load_existing():
    """Load existing seed restaurants and return sets of normalized names and domains."""
    try:
        with open(SEED_FILE, 'r') as f:
            data = json.load(f)
        names = {normalize_name(r.get('name', '')) for r in data}
        domains = {normalize_domain(r.get('website', '')) for r in data}
        return names, domains
    except Exception as e:
        print(f"Warning: could not load seed file: {e}", file=sys.stderr)
        return set(), set()


def main():
    existing_names, existing_domains = load_existing()
    print(f"Loaded {len(existing_names)} existing restaurants from seed file", file=sys.stderr)

    results = []
    for candidate in CANDIDATES:
        # Skip if already in seed file
        cand_name = normalize_name(candidate['name'])
        cand_domain = normalize_domain(candidate['website'])
        if cand_name in existing_names or cand_domain in existing_domains:
            print(f"SKIPPING {candidate['name']} - already in seed file", file=sys.stderr)
            continue

        try:
            result = check_restaurant(candidate)
            results.append(result)
        except Exception as e:
            print(f"ERROR checking {candidate['name']}: {e}", file=sys.stderr)
            results.append({
                'name': candidate['name'],
                'website': candidate['website'],
                'classification': 'unverified',
                'reason': f'Error during check: {str(e)[:100]}',
                'source_url': candidate['website'],
                'checked_urls': [],
                'policy_matches': [],
                'exact_excerpt': None,
                'method_used': None,
            })
        time.sleep(1)

    # Output results as JSON
    print(json.dumps(results, indent=2))


if __name__ == '__main__':
    main()
