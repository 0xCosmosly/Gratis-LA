#!/usr/bin/env python3
"""
Verify total physical locations by pulling ALL restaurants, cafes, and fast-food spots 
from OpenStreetMap (Overpass API) without requiring a website.
"""
import json
import urllib.request
import urllib.parse
import sys
import re

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

def overpass_query_all(bounds):
    """Query Overpass API for ALL places (no website requirement)."""
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
        'User-Agent': 'GratisLA-CoverageValidator/1.0',
        'Content-Type': 'application/x-www-form-urlencoded'
    })
    
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.loads(resp.read())

def extract_names(result):
    names = set()
    for elem in result.get('elements', []):
        tags = elem.get('tags', {})
        name = tags.get('name', '').strip()
        if name:
            names.add(name)
    return names

def normalize_name(name):
    return re.sub(r'[^a-z0-9]', '', name.lower())

def main():
    existing_normalized = set()
    # Load what we have 
    try:
        with open('/Users/ray/.gemini/antigravity/brain/4db6538f-c2f0-4a3c-9a24-d0022c4b7e6d/all_scraped_restaurants.txt') as f:
            for line in f.readlines():
                if line.strip() and not line.startswith('='):
                    existing_normalized.add(normalize_name(line.strip()))
    except: pass
    
    try:
        with open('/Users/ray/.gemini/antigravity/brain/4db6538f-c2f0-4a3c-9a24-d0022c4b7e6d/missing_yp_restaurants.txt') as f:
            for line in f.readlines():
                if line.strip() and not line.startswith('=') and not line.startswith('-'):
                    existing_normalized.add(normalize_name(line.strip()))
    except: pass

    output = {}

    for hood, bounds in NEIGHBORHOODS.items():
        print(f"Querying Overpass for {hood} (all physical locations)...", file=sys.stderr)
        try:
            res = overpass_query_all(bounds)
            physical_names = extract_names(res)
            
            missing = []
            for name in physical_names:
                if normalize_name(name) not in existing_normalized:
                    missing.append(name)
            
            output[hood] = {
                'total_physical_locations_in_osm': len(physical_names),
                'found_in_our_combined_dataset': len(physical_names) - len(missing),
                'completely_missing_from_our_radar': len(missing),
                'missing_examples': missing[:15]
            }
            print(f"  {hood}: {len(physical_names)} total physical locations.", file=sys.stderr)
            print(f"  {len(missing)} are completely missing from our dataset.", file=sys.stderr)
            
        except Exception as e:
            print(f"Error querying {hood}: {e}", file=sys.stderr)

    print(json.dumps(output, indent=2))

if __name__ == '__main__':
    main()
