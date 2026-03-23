"""
Yelp Review Miner for Zero-Tip Fast Casual Restaurants

This script uses the Scrapling library to search Yelp for highly-rated 
counter-service restaurants in Los Angeles, then specifically paginates 
through their raw reviews looking for exact phrases indicating the absence 
of an iPad tip screen ("no option to tip", "no tip screen", etc.).

Prerequisite: 
Make sure Scrapling is installed in your virtual environment: 
source .venv-scrapling/bin/activate
pip install scrapling
"""

import re
import json
import logging
import argparse
from urllib.parse import urlencode
from typing import List, Dict

try:
    from scrapling import Fetcher
except ImportError:
    print("Scrapling is not installed. Please install it using: pip install scrapling")
    exit(1)

# Configure logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

# Search parameters
SEARCH_LOCATION = "Los Angeles, CA"
MAX_PAGES_PER_BIZ = 5
TARGET_PHRASES = [
    r"no tip screen",
    r"no option to tip",
    r"didn'?t ask for a tip",
    r"no tipping option",
    r"doesn'?t ask for tip",
    r"no tip option at checkout"
]

def search_yelp_fast_casual(fetcher: Fetcher, terms="Fast Casual") -> List[Dict]:
    """Search for fast casual/counter service restaurants in LA."""
    logger.info(f"Searching Yelp for '{terms}' in {SEARCH_LOCATION}...")
    
    query = urlencode({
        "find_desc": terms,
        "find_loc": SEARCH_LOCATION,
        "attrs": "BusinessAcceptsCreditCards" # common for iPad POS systems
    })
    
    url = f"https://www.yelp.com/search?{query}"
    page = fetcher.get(url)
    
    results = []
    
    # Yelp's business links on search pages usually match /biz/business-name-city
    for link in page.css("a[href^='/biz/']"):
        href = link.attrib.get("href", "")
        # Filter out tracking params
        clean_url = "https://www.yelp.com" + href.split("?")[0]
        # Avoid duplicate links
        if clean_url not in [r["url"] for r in results] and "review_feed" not in clean_url:
            name = link.text.strip()
            if name:
                results.append({"name": name, "url": clean_url})
                
    logger.info(f"Found {len(results)} potential restaurants to scan.")
    return results

def mine_reviews_for_restaurant(fetcher: Fetcher, business: Dict) -> None:
    """Paginate through reviews looking for anti-tipping screen phrases."""
    url = business["url"]
    logger.info(f"Scanning reviews for {business['name']} ({url})")
    
    hits = []
    
    for page_num in range(MAX_PAGES_PER_BIZ):
        start_index = page_num * 10
        page_url = f"{url}?start={start_index}&sort_by=rating_desc" # Sort by rating or newest
        
        try:
            page = fetcher.get(page_url)
        except Exception as e:
            logger.error(f"Failed to fetch {page_url}: {e}")
            break
            
        review_texts = page.css("p.comment__09f24__gu0Kd span.raw__09f24__T4Ezm")
        if not review_texts:
            break # No more reviews
            
        for review in review_texts:
            text = review.text.replace("\n", " ").strip()
            
            # Check for target phrases
            for phrase in TARGET_PHRASES:
                if re.search(phrase, text, re.IGNORECASE):
                    hits.append({
                        "phrase_matched": phrase,
                        "review_snippet": text[:200] + "..." if len(text) > 200 else text
                    })
                    break 
                    
    business["tip_screen_hits"] = hits
    
    if hits:
        logger.info(f"*** FOUND {len(hits)} POTENTIAL HITS FOR {business['name']} ***")
        for h in hits:
            logger.info(f"  - Snippet: {h['review_snippet']}")
    else:
        logger.debug(f"No hits for {business['name']}.")

def main():
    parser = argparse.ArgumentParser(description="Mine Yelp reviews for tip-free counter service.")
    parser.add_argument("--query", type=str, default="Counter Service", help="Yelp search query")
    parser.add_argument("--output", type=str, default="data/yelp-tip-screen-leads.json", help="Output file")
    args = parser.parse_args()
    
    fetcher = Fetcher(auto_match_browser=True)
    
    try:
        restaurants = search_yelp_fast_casual(fetcher, terms=args.query)
        
        for restaurant in restaurants[:15]: # Scan first 15 to test
            mine_reviews_for_restaurant(fetcher, restaurant)
            
        # Filter for only those with hits
        successful_leads = [r for r in restaurants if r.get("tip_screen_hits")]
        
        with open(args.output, "w") as f:
            json.dump(successful_leads, f, indent=2)
            
        logger.info(f"Done. Saved {len(successful_leads)} highly-probable leads to {args.output}")
        
    except Exception as e:
        logger.error(f"Scrape failed: {e}")

if __name__ == "__main__":
    main()
