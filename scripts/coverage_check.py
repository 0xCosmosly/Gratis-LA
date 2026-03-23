#!/usr/bin/env python3
"""
Comprehensive coverage check: scrape ALL YellowPages pages for Koreatown and Alhambra,
extract restaurant names using span + href fallback, cross-reference against our data.
"""
import json
import re
import sys
import time
from urllib.parse import urljoin, urlparse

from scrapling import Fetcher


def normalize_name(name):
    return re.sub(r'[^a-z0-9]', '', name.lower())


def name_from_slug(href):
    """Extract a readable name from YP URL slug like 'marouch-restaurant-465004155'"""
    slug = href.split('/')[-1]
    # Remove trailing ID numbers
    slug = re.sub(r'-\d{5,}$', '', slug)
    # Remove leading MIP pattern
    slug = re.sub(r'^mip/', '', slug)
    return slug.replace('-', ' ').title()


def scrape_yp_names(fetcher, base_url, hood_key, max_pages=15):
    """Extract ALL business names from YellowPages search, up to max_pages."""
    all_names = []
    seen_norm = set()
    
    for page_num in range(1, max_pages + 1):
        url = f"{base_url}&page={page_num}"
        print(f"[{hood_key}] YP page {page_num}", file=sys.stderr, end='')
        
        try:
            page = fetcher.get(url, timeout=15)
            
            # Primary: get names from spans inside business-name links
            spans = page.css('a.business-name span')
            links = page.css('a.business-name')
            
            names_from_spans = []
            for span in spans:
                name = span.text.strip() if span.text else ""
                if name:
                    names_from_spans.append(name)
            
            # Also get names from href slugs as fallback
            names_from_links = []
            for link in links:
                href = link.attrib.get('href', '')
                # Try direct text first
                text = link.text.strip() if link.text else ""
                if text and len(text) > 1:
                    names_from_links.append(text)
                elif href:
                    names_from_links.append(name_from_slug(href))
            
            # Merge - prefer span names (more reliable), but use link names to fill gaps
            found = names_from_spans if len(names_from_spans) >= len(names_from_links) else names_from_links
            if not found:
                # Try href-based extraction as final fallback
                found = names_from_links
            
            if not found:
                print(f"  -> no results, stopping", file=sys.stderr)
                break
            
            new_count = 0
            for name in found:
                norm = normalize_name(name)
                if norm and norm not in seen_norm and len(norm) > 2:
                    seen_norm.add(norm)
                    all_names.append(name)
                    new_count += 1
            
            print(f"  -> {len(found)} listings, {new_count} new unique", file=sys.stderr)
            
        except Exception as e:
            print(f"  -> ERROR: {e}", file=sys.stderr)
            break
        
        time.sleep(1)
    
    return all_names


def main():
    # Load all existing restaurant names from our datasets
    existing_names = set()
    
    # From seed file
    try:
        with open('/Users/ray/Documents/2. AI Coding/Gratis LA/data/tracked-restaurants.json') as f:
            for r in json.load(f):
                existing_names.add(normalize_name(r.get('name', '')))
    except Exception as e:
        print(f"Error loading seed: {e}", file=sys.stderr)
    
    # From YP data
    try:
        with open('/tmp/yp_restaurants.json') as f:
            for r in json.load(f):
                existing_names.add(normalize_name(r.get('name', '')))
    except Exception as e:
        print(f"Error loading YP: {e}", file=sys.stderr)
    
    # From scrape log (restaurant names from Overpass)
    try:
        with open('/tmp/scrape_stderr.log') as f:
            log = f.read()
        for m in re.finditer(r'\[\d+/361\] (.+?) \(', log):
            existing_names.add(normalize_name(m.group(1)))
    except Exception as e:
        print(f"Error loading scrape log: {e}", file=sys.stderr)
    
    existing_names.discard('')
    print(f"Total existing unique restaurant names: {len(existing_names)}", file=sys.stderr)
    
    fetcher = Fetcher(auto_match=False)
    
    searches = {
        "Koreatown": "https://www.yellowpages.com/search?search_terms=restaurants&geo_location_terms=Koreatown%2C+Los+Angeles%2C+CA",
        "Alhambra": "https://www.yellowpages.com/search?search_terms=restaurants&geo_location_terms=Alhambra%2C+CA",
    }
    
    results = {}
    all_missing = []
    
    for hood_key, base_url in searches.items():
        print(f"\n{'='*60}", file=sys.stderr)
        print(f"Coverage check: {hood_key}", file=sys.stderr)
        print(f"{'='*60}", file=sys.stderr)
        
        yp_names = scrape_yp_names(fetcher, base_url, hood_key, max_pages=15)
        
        found_count = 0
        missing = []
        for name in yp_names:
            norm = normalize_name(name)
            if norm in existing_names:
                found_count += 1
            else:
                missing.append(name)
        
        results[hood_key] = {
            'total_yp_names': len(yp_names),
            'already_in_our_data': found_count,
            'missing_count': len(missing),
            'coverage_pct': round(found_count / len(yp_names) * 100, 1) if yp_names else 0,
            'missing_names': missing,
        }
        all_missing.extend([(name, hood_key) for name in missing])
        
        print(f"\n{hood_key}: {len(yp_names)} YP names, {found_count} found in our data, {len(missing)} missing", file=sys.stderr)
        print(f"  Coverage: {results[hood_key]['coverage_pct']}%", file=sys.stderr)
        if missing:
            print(f"  Missing restaurants:", file=sys.stderr)
            for name in missing:
                print(f"    - {name}", file=sys.stderr)
        
        time.sleep(2)
    
    print(f"\n{'='*60}", file=sys.stderr)
    print(f"TOTAL MISSING: {len(all_missing)} restaurants not in our data", file=sys.stderr)
    
    print(json.dumps(results, indent=2))


if __name__ == '__main__':
    main()
