#!/usr/bin/env python3
"""
Use DuckDuckGo Search to bypass Yelp / TripAdvisor blocks by scraping search engine results
instead of hitting the directories directly.
"""
import json
import re
import sys
import time
from ddgs import DDGS
from urllib.parse import unquote

def normalize_name(name):
    return re.sub(r'[^a-z0-9]', '', name.lower())

def clean_yelp_name(title):
    # Titles usually look like: "Restaurant Name - Los Angeles, CA - Yelp"
    title = re.sub(r'- Updated.*$', '', title, flags=re.IGNORECASE)
    title = re.sub(r'- Los Angeles.*$', '', title, flags=re.IGNORECASE)
    title = re.sub(r'- Alhambra.*$', '', title, flags=re.IGNORECASE)
    title = re.sub(r'- Yelp.*$', '', title, flags=re.IGNORECASE)
    title = re.sub(r'- Menu.*$', '', title, flags=re.IGNORECASE)
    title = re.sub(r'\|.*$', '', title, flags=re.IGNORECASE)
    return title.strip().title()

def search_ddg_for_directory(ddgs, query, max_results=300):
    print(f"Searching DDG: {query}", file=sys.stderr)
    results = []
    try:
        res = getattr(ddgs, 'text', getattr(ddgs, 'search', None))
        if res:
            for r in res(query, max_results=max_results):
                results.append({
                    'title': r.get('title', ''),
                    'url': r.get('href', ''),
                })
    except Exception as e:
        print(f"Error searching DDG: {e}", file=sys.stderr)
    print(f"  Got {len(results)} results", file=sys.stderr)
    time.sleep(1) # small backoff
    return results

def main():
    ddgs = DDGS()
    
    neighborhoods = {
        "Koreatown": '"Koreatown" "Los Angeles"',
        "Alhambra": '"Alhambra" "CA"'
    }
    
    # Existing names
    existing_names = set()
    try:
        with open('/Users/ray/.gemini/antigravity/brain/4db6538f-c2f0-4a3c-9a24-d0022c4b7e6d/all_scraped_restaurants.txt') as f:
            for line in f.readlines():
                if line.strip() and not line.startswith('='):
                    existing_names.add(normalize_name(line.strip()))
    except: pass

    # Load missing names from YP to mark if we found them
    missing_yp = set()
    try:
        with open('/Users/ray/.gemini/antigravity/brain/4db6538f-c2f0-4a3c-9a24-d0022c4b7e6d/missing_yp_restaurants.txt') as f:
            for line in f.readlines():
                if line.strip() and not line.startswith('=') and not line.startswith('-'):
                    missing_yp.add(normalize_name(line.strip()))
    except: pass
    
    all_found_names = set()
    output = {}

    for hood_key, location in neighborhoods.items():
        print(f"\n====================== {hood_key} ======================", file=sys.stderr)
        
        # Yelp Query
        yelp_query = f'site:yelp.com/biz/ {location} restaurant'
        yelp_results = search_ddg_for_directory(ddgs, yelp_query, max_results=400)
        
        # TripAdvisor Query
        ta_query = f'site:tripadvisor.com/Restaurant_Review {location}'
        ta_results = search_ddg_for_directory(ddgs, ta_query, max_results=400)
        
        # OpenTable / Eater
        ot_query = f'site:opentable.com {location} restaurant'
        ot_results = search_ddg_for_directory(ddgs, ot_query, max_results=400)

        # Extraction logic
        yelp_names = set()
        for r in yelp_results:
            name = clean_yelp_name(r['title']).replace(" - Closed", "")
            if name and "Yelp" not in name:
                yelp_names.add(name)
        
        ta_names = set()
        for r in ta_results:
            # Format: Name, City - Restaurant Reviews
            name = re.sub(r',(.*)$', '', r['title'])
            name = name.replace(" - Menu, Prices & Restaurant Reviews", "")
            name = name.replace(" - Tripadvisor", "").strip()
            if name:
                ta_names.add(name)

        ot_names = set()
        for r in ot_results:
            name = re.sub(r'-.*$', '', r['title']).strip()
            if name:
                ot_names.add(name)

        newly_found = []
        # Check against everything
        combined_names = yelp_names | ta_names | ot_names
        for name in list(combined_names):
            norm = normalize_name(name)
            if norm not in existing_names and norm not in missing_yp and len(norm) > 2:
                newly_found.append(name)
                
        output[hood_key] = {
            'distinct_businesses_from_yelp': len(yelp_names),
            'distinct_businesses_from_ta': len(ta_names),
            'distinct_businesses_from_ot': len(ot_names),
            'total_distinct_directory_results': len(combined_names),
            'newly_found_count': len(newly_found),
            'newly_found': newly_found
        }

        print(f"\n{hood_key} unique results:", file=sys.stderr)
        print(f"  Yelp: {len(yelp_names)}", file=sys.stderr)
        print(f"  TripAdvisor: {len(ta_names)}", file=sys.stderr)
        print(f"  OpenTable: {len(ot_names)}", file=sys.stderr)
        print(f"  Total distinct across 3 directories: {len(combined_names)}", file=sys.stderr)
        print(f"  Brand new unmatched locations: {len(newly_found)}", file=sys.stderr)

    print(json.dumps(output, indent=2))

if __name__ == '__main__':
    main()
