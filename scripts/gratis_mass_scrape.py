#!/usr/bin/env python3
"""
Mass restaurant discovery + policy scraping for Koreatown and Alhambra.
Step 1: Discover all restaurants with websites via Overpass API.
Step 2: Scrape each for no-tip / included service charge policy text.
"""
import json
import re
import sys
import time
import urllib.request
import urllib.parse
from urllib.parse import urljoin, urlparse

from scrapling import Fetcher

# Neighborhood bounding boxes
NEIGHBORHOODS = {
    "Koreatown": {
        "south": 34.052, "west": -118.316,
        "north": 34.074, "east": -118.282
    },
    "Alhambra": {
        "south": 34.070, "west": -118.155,
        "north": 34.105, "east": -118.110
    },
}

SEED_FILE = '/Users/ray/Documents/2. AI Coding/Gratis LA/data/tracked-restaurants.json'

POLICY_PHRASES = [
    r'no tip(?:ping)?',
    r'no-tipping\s+establishment',
    r'tips?\s+(?:are\s+)?not\s+accepted',
    r'do\s+not\s+accept\s+tips?',
    r'please\s+do\s+not\s+tip',
    r'gratuity[- ]free',
    r'service\s+included',
    r'hospitality\s+included',
    r'inclusive\s+pricing',
    r'facility\s+fee',
    r'service\s+fee',
    r'service\s+charge',
    r'mandatory\s+fee',
    r'surcharge',
    r'fee\s+will\s+be\s+added\s+to\s+(?:your|every|all)\s+bill',
    r'(?:gratuity|service\s+charge|fee)\s+(?:is\s+)?(?:automatically\s+)?(?:added|included|applied)',
    r'\d+%\s*(?:service|facility|gratuity|fee|charge)',
    r'(?:service|facility|gratuity)\s*(?:fee|charge)?\s*(?:of\s+)?\d+%',
    r'gratuity\s+(?:will\s+be\s+)?(?:added|included)',
]

PARTY_EXCLUSION = [
    r'parties?\s+of\s+\d+\s+or\s+more',
    r'groups?\s+of\s+\d+\s+or\s+more',
    r'tables?\s+of\s+\d+\s+or\s+more',
    r'\d+\s+or\s+more\s+(?:guests?|people|persons?|adults?|diners?)',
    r'large\s+part(?:y|ies)',
]

LINK_KEYWORDS = [
    'faq', 'menu', 'reservation', 'reservations', 'locations', 'location',
    'policy', 'visit', 'dine', 'restaurant', 'about', 'private-dining',
    'info', 'contact', 'order', 'service', 'gratuity', 'rules'
]


def normalize_domain(url):
    try:
        return urlparse(url).netloc.replace('www.', '').lower()
    except:
        return ''


def normalize_name(name):
    return re.sub(r'[^a-z0-9]', '', name.lower())


def load_existing():
    try:
        with open(SEED_FILE, 'r') as f:
            data = json.load(f)
        names = {normalize_name(r.get('name', '')) for r in data}
        domains = {normalize_domain(r.get('website', '')) for r in data}
        return names, domains, data
    except Exception as e:
        print(f"Warning: could not load seed file: {e}", file=sys.stderr)
        return set(), set(), []


def overpass_query(bounds):
    """Query Overpass API for restaurants in the given bounds."""
    s, w, n, e = bounds['south'], bounds['west'], bounds['north'], bounds['east']
    query = f"""[out:json][timeout:90];
(
  node["amenity"="restaurant"]["name"](around:0,{s},{w},{n},{e});
  way["amenity"="restaurant"]["name"](around:0,{s},{w},{n},{e});
  node["amenity"="restaurant"]["name"]({s},{w},{n},{e});
  way["amenity"="restaurant"]["name"]({s},{w},{n},{e});
  relation["amenity"="restaurant"]["name"]({s},{w},{n},{e});
  node["amenity"="cafe"]["name"]({s},{w},{n},{e});
  way["amenity"="cafe"]["name"]({s},{w},{n},{e});
  node["amenity"="fast_food"]["name"]({s},{w},{n},{e});
  way["amenity"="fast_food"]["name"]({s},{w},{n},{e});
  node["amenity"="bar"]["name"]({s},{w},{n},{e});
  way["amenity"="bar"]["name"]({s},{w},{n},{e});
  node["shop"="bakery"]["name"]({s},{w},{n},{e});
  way["shop"="bakery"]["name"]({s},{w},{n},{e});
);
out center tags;"""

    url = 'https://overpass-api.de/api/interpreter'
    data = urllib.parse.urlencode({'data': query}).encode()
    req = urllib.request.Request(url, data=data, headers={
        'User-Agent': 'GratisLA-Scanner/1.0',
        'Content-Type': 'application/x-www-form-urlencoded'
    })
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.loads(resp.read())


def extract_restaurants_from_overpass(result, neighborhood):
    """Parse Overpass result into restaurant list."""
    restaurants = []
    seen_websites = set()

    for elem in result.get('elements', []):
        tags = elem.get('tags', {})
        name = tags.get('name', '').strip()
        if not name:
            continue

        website = tags.get('website') or tags.get('contact:website') or ''
        website = website.strip()

        lat = elem.get('lat') or (elem.get('center', {}) or {}).get('lat')
        lng = elem.get('lon') or (elem.get('center', {}) or {}).get('lon')

        if website:
            if not website.startswith('http'):
                website = 'https://' + website
            domain = normalize_domain(website)
            if domain in seen_websites:
                continue
            seen_websites.add(domain)

        restaurants.append({
            'name': name,
            'website': website if website else None,
            'address': ' '.join(filter(None, [
                tags.get('addr:housenumber', ''),
                tags.get('addr:street', ''),
            ])).strip() or None,
            'lat': lat,
            'lng': lng,
            'neighborhood': neighborhood,
            'amenity': tags.get('amenity', tags.get('shop', 'unknown')),
        })

    return restaurants


def extract_text(page):
    try:
        text = page.get_all_text() if hasattr(page, 'get_all_text') else ""
        if not text:
            text = page.text if hasattr(page, 'text') else str(page)
        return re.sub(r'\s+', ' ', text).strip()
    except:
        return ""


def extract_links(page, base_url):
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
    except:
        pass
    return list(links)[:8]


def find_policy_matches(text):
    matches = []
    text_lower = text.lower()
    for pattern in POLICY_PHRASES:
        for m in re.finditer(pattern, text_lower):
            start = max(0, m.start() - 100)
            end = min(len(text), m.end() + 150)
            context = text[start:end].strip()
            matches.append({'pattern': pattern, 'matched': m.group(), 'context': context})
    return matches


def is_party_only(context):
    context_lower = context.lower()
    for pattern in PARTY_EXCLUSION:
        if re.search(pattern, context_lower):
            return True
    return False


def classify_matches(matches):
    """Classify based on the policy matches found."""
    if not matches:
        return 'none', None

    # Filter out party-only matches
    universal = [m for m in matches if not is_party_only(m['context'])]
    party_only = [m for m in matches if is_party_only(m['context'])]

    if not universal and party_only:
        return 'party_only', party_only[0]

    if not universal:
        return 'none', None

    best = universal[0]
    ctx = best['context'].lower()

    no_tip = any(re.search(p, ctx) for p in [
        r'no tip(?:ping)?', r'tips?\s+not\s+accepted',
        r'no-tipping', r'gratuity[- ]free',
        r'do\s+not\s+accept\s+tips?', r'please\s+do\s+not\s+tip',
    ])
    has_fee = any(re.search(p, ctx) for p in [
        r'service\s+fee', r'facility\s+fee', r'service\s+charge',
        r'mandatory\s+fee', r'hospitality\s+(?:fee|charge|included)',
        r'\d+%.*(?:fee|charge|service|facility)',
        r'fee\s+will\s+be\s+added', r'surcharge',
    ])

    if no_tip and not has_fee:
        return 'no_tip', best
    elif no_tip and has_fee:
        return 'included', best
    elif has_fee:
        return 'included', best
    else:
        return 'unclear', best


def scrape_restaurant(fetcher, restaurant):
    """Scrape a single restaurant's website for policy text."""
    website = restaurant['website']
    if not website:
        return None

    result = {
        'name': restaurant['name'],
        'website': website,
        'neighborhood': restaurant['neighborhood'],
        'classification': None,
        'source_url': None,
        'exact_excerpt': None,
        'checked_urls': [],
    }

    urls_to_check = [website]

    # First, get homepage
    try:
        page = fetcher.get(website, timeout=12)
        text = extract_text(page)
        result['checked_urls'].append(website)

        if text and len(text) > 50:
            matches = find_policy_matches(text)
            if matches:
                cls, best = classify_matches(matches)
                if cls in ('no_tip', 'included'):
                    result['classification'] = cls
                    result['source_url'] = website
                    result['exact_excerpt'] = best['context'][:300]
                    return result
                elif cls == 'party_only':
                    result['classification'] = 'party_only'
                    result['source_url'] = website
                    result['exact_excerpt'] = best['context'][:300]
                    return result

            # Extract links for deeper check
            subpages = extract_links(page, website)
            urls_to_check.extend(subpages)
        else:
            # Try common subpages
            parsed = urlparse(website)
            base = f"{parsed.scheme}://{parsed.netloc}"
            for path in ['/menu', '/faq', '/policy', '/about', '/reservation']:
                urls_to_check.append(base + path)

    except Exception as e:
        result['checked_urls'].append(website)

    # Check subpages (limit to 5 to keep speed reasonable)
    for url in urls_to_check[1:6]:
        if url in result['checked_urls']:
            continue
        try:
            page = fetcher.get(url, timeout=10)
            text = extract_text(page)
            result['checked_urls'].append(url)

            if text and len(text) > 50:
                matches = find_policy_matches(text)
                if matches:
                    cls, best = classify_matches(matches)
                    if cls in ('no_tip', 'included'):
                        result['classification'] = cls
                        result['source_url'] = url
                        result['exact_excerpt'] = best['context'][:300]
                        return result
                    elif cls == 'party_only' and not result['classification']:
                        result['classification'] = 'party_only'
                        result['source_url'] = url
                        result['exact_excerpt'] = best['context'][:300]
        except:
            result['checked_urls'].append(url)
        time.sleep(0.3)

    if not result['classification']:
        result['classification'] = 'none'
        result['source_url'] = website

    return result


def main():
    existing_names, existing_domains, existing_data = load_existing()
    print(f"Loaded {len(existing_names)} existing restaurants from seed file", file=sys.stderr)

    all_restaurants = []

    # Step 1: Discover restaurants via Overpass API
    for hood, bounds in NEIGHBORHOODS.items():
        print(f"\n{'='*60}", file=sys.stderr)
        print(f"Querying Overpass API for {hood}...", file=sys.stderr)
        try:
            result = overpass_query(bounds)
            restaurants = extract_restaurants_from_overpass(result, hood)
            print(f"  Found {len(restaurants)} total places in {hood}", file=sys.stderr)

            with_website = [r for r in restaurants if r['website']]
            print(f"  {len(with_website)} have websites", file=sys.stderr)

            # Filter out already-in-seed
            new_restaurants = []
            for r in with_website:
                cname = normalize_name(r['name'])
                cdomain = normalize_domain(r['website'])
                if cname not in existing_names and cdomain not in existing_domains:
                    new_restaurants.append(r)

            print(f"  {len(new_restaurants)} are new (not in seed)", file=sys.stderr)
            all_restaurants.extend(new_restaurants)

        except Exception as e:
            print(f"  ERROR querying Overpass for {hood}: {e}", file=sys.stderr)

    # Load alternative directory results (YellowPages)
    yp_restaurants = []
    try:
        with open('/tmp/yp_restaurants.json', 'r') as f:
            yp_restaurants = json.load(f)
        
        # Deduplicate against the existing list of Overpass+Seed restaurants
        seen_domains = {normalize_domain(r.get('website', '')) for r in all_restaurants}
        seen_domains.update(existing_domains)
        
        new_yp = []
        for r in yp_restaurants:
            cdomain = normalize_domain(r.get('website', ''))
            if cdomain and cdomain not in seen_domains:
                new_yp.append(r)
                seen_domains.add(cdomain)
                
        all_restaurants.extend(new_yp)
        print(f"\nAdded {len(new_yp)} new unique restaurants from YellowPages", file=sys.stderr)
    except Exception as e:
        print(f"Error loading YellowPages data: {e}", file=sys.stderr)

    print(f"\nTotal restaurants to scrape: {len(all_restaurants)}", file=sys.stderr)

    # Step 2: Scrape all restaurants
    fetcher = Fetcher(auto_match=False)
    results = {
        'accepted_no_tip': [],
        'accepted_included': [],
        'rejected': [],
        'unverified': [],
        'stats': {
            'total_discovered': len(all_restaurants),
            'total_scraped': 0,
            'with_policy': 0,
            'party_only': 0,
            'no_policy': 0,
            'errors': 0,
        }
    }

    for i, restaurant in enumerate(all_restaurants):
        name = restaurant['name']
        website = restaurant['website']
        hood = restaurant['neighborhood']
        print(f"\n[{i+1}/{len(all_restaurants)}] {name} ({hood}) - {website}", file=sys.stderr)

        try:
            scan = scrape_restaurant(fetcher, restaurant)
            results['stats']['total_scraped'] += 1

            if scan is None:
                continue

            cls = scan['classification']

            if cls == 'no_tip':
                results['accepted_no_tip'].append({
                    'name': name,
                    'website': website,
                    'source_url': scan['source_url'],
                    'exact_excerpt': scan['exact_excerpt'],
                    'reason': 'Official source says no tipping.',
                    'neighborhood': hood,
                })
                results['stats']['with_policy'] += 1
                print(f"  *** ACCEPTED (no_tip): {scan['exact_excerpt'][:100]}", file=sys.stderr)

            elif cls == 'included':
                results['accepted_included'].append({
                    'name': name,
                    'website': website,
                    'source_url': scan['source_url'],
                    'exact_excerpt': scan['exact_excerpt'],
                    'reason': 'Official source says a mandatory fee is added to bills.',
                    'neighborhood': hood,
                })
                results['stats']['with_policy'] += 1
                print(f"  *** ACCEPTED (included): {scan['exact_excerpt'][:100]}", file=sys.stderr)

            elif cls == 'party_only':
                results['rejected'].append({
                    'name': name,
                    'website': website,
                    'reason': 'Policy only applies to large parties.',
                    'source_url': scan['source_url'],
                    'neighborhood': hood,
                })
                results['stats']['party_only'] += 1
                print(f"  REJECTED (party_only)", file=sys.stderr)

            elif cls == 'none':
                results['stats']['no_policy'] += 1
                # Don't add every no-policy restaurant to unverified, too many

        except Exception as e:
            results['stats']['errors'] += 1
            print(f"  ERROR: {str(e)[:80]}", file=sys.stderr)

        time.sleep(0.3)

    # Print final results
    print(json.dumps(results, indent=2))

    # Print summary to stderr
    print(f"\n{'='*60}", file=sys.stderr)
    print(f"SUMMARY", file=sys.stderr)
    print(f"  Total discovered: {results['stats']['total_discovered']}", file=sys.stderr)
    print(f"  Total scraped: {results['stats']['total_scraped']}", file=sys.stderr)
    print(f"  With qualifying policy: {results['stats']['with_policy']}", file=sys.stderr)
    print(f"  Party-only (rejected): {results['stats']['party_only']}", file=sys.stderr)
    print(f"  No policy found: {results['stats']['no_policy']}", file=sys.stderr)
    print(f"  Errors: {results['stats']['errors']}", file=sys.stderr)
    print(f"  Accepted no-tip: {len(results['accepted_no_tip'])}", file=sys.stderr)
    print(f"  Accepted included: {len(results['accepted_included'])}", file=sys.stderr)
    print(f"  Rejected: {len(results['rejected'])}", file=sys.stderr)


if __name__ == '__main__':
    main()
