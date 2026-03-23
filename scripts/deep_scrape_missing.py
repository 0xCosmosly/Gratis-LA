#!/usr/bin/env python3
"""
Deep Extractor & Scraper:
1. Load all missing restaurant names (YP, DDG searches, Overpass physical nodes).
2. Use DuckDuckGo Search to find their actual official website.
3. Use Scrapling to check their website for no-tip or service fee policies.
"""
import json
import re
import sys
import time
from urllib.parse import urlparse, urljoin
from ddgs import DDGS
from scrapling import Fetcher

# From original mass_scrape
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

IGNORE_DOMAINS = [
    'yelp.com', 'tripadvisor.com', 'opentable.com', 'doordash.com', 'ubereats.com', 'grubhub.com',
    'postmates.com', 'facebook.com', 'instagram.com', 'yellowpages.com', 'mapquest.com',
    'foursquare.com', 'zomato.com', 'seamless.com', 'chownow.com', 'menupages.com', 'sirved.com',
    'allmenus.com', 'toasttab.com', 'roaminghunger.com', 'singleplatform.com', 'locu.com',
    'beyondmenu.com', 'restaurantguru.com', 'yellowbook.com', 'bbb.org', 'linkedin.com',
    'twitter.com', 'tiktok.com', 'pinterest.com', 'youtube.com', 'yahoo.com', 'google.com',
    'apple.com', 'theinfatuation.com', 'eater.com', 'latimes.com', 'timeout.com'
]

def normalize_name(name):
    return re.sub(r'[^a-z0-9]', '', name.lower())

def is_party_only(context):
    context_lower = context.lower()
    for pattern in PARTY_EXCLUSION:
        if re.search(pattern, context_lower):
            return True
    return False

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

def classify_matches(matches):
    if not matches:
        return 'none', None

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
    return list(links)[:5]

def search_for_website(ddgs, name, neighborhood):
    query = f'"{name}" {neighborhood} CA official website restaurant -yelp -tripadvisor'
    try:
        # DDGS API
        res = getattr(ddgs, 'text', getattr(ddgs, 'search', None))
        if res:
            results = list(res(query, max_results=10))
            for r in results:
                url = r.get('href')
                if not url: continue
                domain = urlparse(url).netloc.lower().replace('www.', '')
                
                # Check if it's a known directory/aggregator
                is_ignored = False
                for ig in IGNORE_DOMAINS:
                    if ig in domain:
                        is_ignored = True
                        break
                if not is_ignored:
                    return url
    except Exception as e:
        print(f"  DDG search failed for {name}: {e}", file=sys.stderr)
    return None

def scrape_restaurant(fetcher, name, website, neighborhood):
    result = {
        'name': name,
        'website': website,
        'neighborhood': neighborhood,
        'classification': 'none',
        'source_url': website,
        'exact_excerpt': None,
        'checked_urls': [],
    }

    urls_to_check = [website]

    try:
        page = fetcher.get(website, timeout=12)
        text = extract_text(page)
        result['checked_urls'].append(website)

        if text and len(text) > 50:
            matches = find_policy_matches(text)
            if matches:
                cls, best = classify_matches(matches)
                if cls in ('no_tip', 'included', 'party_only'):
                    result['classification'] = cls
                    result['exact_excerpt'] = best['context'][:300]
                    return result

            subpages = extract_links(page, website)
            urls_to_check.extend(subpages)
        else:
            parsed = urlparse(website)
            base = f"{parsed.scheme}://{parsed.netloc}"
            for path in ['/menu', '/faq', '/policy', '/about']:
                urls_to_check.append(base + path)
    except Exception as e:
        result['checked_urls'].append(website)

    for url in urls_to_check[1:4]:
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
                    elif cls == 'party_only' and result['classification'] == 'none':
                        result['classification'] = 'party_only'
                        result['source_url'] = url
                        result['exact_excerpt'] = best['context'][:300]
        except:
            result['checked_urls'].append(url)
        time.sleep(0.5)

    return result

def load_missing_names():
    missing = []
    
    # YellowPages gaps
    try:
        with open('/Users/ray/.gemini/antigravity/brain/4db6538f-c2f0-4a3c-9a24-d0022c4b7e6d/missing_yp_restaurants.txt') as f:
            current_hood = "Koreatown"
            for line in f.readlines():
                line = line.strip()
                if not line or line.startswith('='): continue
                if 'KOREATOWN' in line:
                    current_hood = "Koreatown"
                    continue
                if 'ALHAMBRA' in line:
                    current_hood = "Alhambra"
                    continue
                if not line.startswith('-'):
                    missing.append((line, current_hood))
    except Exception as e:
        print(f"Error loading missing YP: {e}", file=sys.stderr)

    # DDG newly found
    try:
        with open('/tmp/ddg_bypass_results.json') as f:
            d = json.load(f)
            for hood, data in d.items():
                for n in data.get('newly_found', []):
                    missing.append((n, hood))
    except Exception as e:
        print(f"Error loading DDG bypass: {e}", file=sys.stderr)

    # Overpass entirely missing
    try:
        with open('/tmp/overpass_results.json') as f:
            d = json.load(f)
            for hood, data in d.items():
                for n in data.get('missing_examples', []):
                    missing.append((n, hood))
    except Exception as e:
        print(f"Error loading Overpass bypass: {e}", file=sys.stderr)
        
    # Deduplicate
    unique = {}
    for name, hood in missing:
        norm = normalize_name(name)
        if norm and norm not in unique:
            unique[norm] = {"name": name, "hood": hood}
            
    return list(unique.values())

def main():
    missing = load_missing_names()
    print(f"Loaded {len(missing)} completely missing business names to deeply search + scrape.", file=sys.stderr)
    
    ddgs = DDGS()
    fetcher = Fetcher(auto_match=False)
    
    results = {
        'accepted_no_tip': [],
        'accepted_included': [],
        'rejected': [],
        'stats': {
            'total_names': len(missing),
            'websites_found': 0,
            'websites_scraped': 0,
            'with_policy': 0,
            'party_only': 0
        }
    }
    
    for i, item in enumerate(missing):
        name = item['name']
        hood = item['hood']
        print(f"\n[{i+1}/{len(missing)}] {name} ({hood})", file=sys.stderr)
        
        # 1. Find Website
        time.sleep(1) # Be nice to DDG
        website = search_for_website(ddgs, name, hood)
        
        if not website:
            print(f"  -> No valid official website found", file=sys.stderr)
            continue
            
        print(f"  -> Found website: {website}", file=sys.stderr)
        results['stats']['websites_found'] += 1
        
        # 2. Scrape Policy
        scan = scrape_restaurant(fetcher, name, website, hood)
        results['stats']['websites_scraped'] += 1
        
        cls = scan['classification']
        if cls == 'no_tip':
            results['accepted_no_tip'].append(scan)
            results['stats']['with_policy'] += 1
            print(f"  *** ACCEPTED (no_tip): {scan['exact_excerpt'][:100]}", file=sys.stderr)
        elif cls == 'included':
            results['accepted_included'].append(scan)
            results['stats']['with_policy'] += 1
            print(f"  *** ACCEPTED (included): {scan['exact_excerpt'][:100]}", file=sys.stderr)
        elif cls == 'party_only':
            results['rejected'].append(scan)
            results['stats']['party_only'] += 1
            print(f"  REJECTED (party_only)", file=sys.stderr)
            
    print(json.dumps(results, indent=2))
    
    print(f"\n================ SUMMARY ================", file=sys.stderr)
    for k, v in results['stats'].items():
        print(f"  {k}: {v}", file=sys.stderr)
    print(f"  Found {len(results['accepted_included'])} new true inclusive/surcharge policies", file=sys.stderr)

if __name__ == '__main__':
    main()
