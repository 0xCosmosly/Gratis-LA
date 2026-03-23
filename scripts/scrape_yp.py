import sys
import json
import time
from urllib.parse import urljoin
from scrapling import Fetcher

def fetch_yp_page_links(fetcher, search_url):
    print(f"Fetching {search_url}", file=sys.stderr)
    try:
        page = fetcher.get(search_url, timeout=15)
        links = page.css('a.business-name')
        
        biz_links = []
        for link in links:
            href = link.attrib.get('href')
            if href:
                # YellowPages listings are relative
                full_url = urljoin("https://www.yellowpages.com", href)
                biz_links.append(full_url)
                
        return biz_links
    except Exception as e:
        print(f"Error fetching {search_url}: {e}", file=sys.stderr)
        return []

def extract_website_from_yp_listing(fetcher, listing_url):
    try:
        page = fetcher.get(listing_url, timeout=10)
        # Check all links for the external website
        for a in page.css("a"):
            href = a.attrib.get("href")
            text = a.text.strip() if a.text else ""
            if href and "http" in href and "yellowpages" not in href and "thryv" not in href and "singleplatform" not in href and "facebook" not in href and "twitter" not in href and "instagram" not in href and "pinterest" not in href and "linkedin" not in href and "yelp" not in href and "networkadvertising" not in href:
                return href
    except Exception as e:
        # Don't print every error to avoid spam
        pass
    return None

def main():
    fetcher = Fetcher(auto_match=False)
    
    searches = {
        "Koreatown": "https://www.yellowpages.com/search?search_terms=restaurants&geo_location_terms=Koreatown%2C+Los+Angeles%2C+CA",
        "Alhambra": "https://www.yellowpages.com/search?search_terms=restaurants&geo_location_terms=Alhambra%2C+CA"
    }
    
    all_new_restaurants = []

    for hood, base_url in searches.items():
        print(f"\n--- Scraping YellowPages for {hood} ---", file=sys.stderr)
        
        # Scrape first 5 pages of YP (usually 30 results per page)
        for page_num in range(1, 6):
            url = f"{base_url}&page={page_num}"
            listing_urls = fetch_yp_page_links(fetcher, url)
            
            if not listing_urls:
                break
                
            print(f"  Found {len(listing_urls)} listings on page {page_num}", file=sys.stderr)
            
            # Now fetch each listing to get the actual website
            for i, listing_url in enumerate(listing_urls):
                website = extract_website_from_yp_listing(fetcher, listing_url)
                if website:
                    # We don't have exact name from the main page reliably without complex parsing,
                    # but we can get it from the URL slug or fetch it.
                    # For mass scraping, having the website is the most important part.
                    slug = listing_url.split('/')[-1].split('-')[0:-1]
                    name = " ".join(slug).title()
                    
                    all_new_restaurants.append({
                        "name": name,
                        "website": website,
                        "neighborhood": hood,
                        "source": "YellowPages"
                    })
                    print(f"    [+] Got website: {name} -> {website}", file=sys.stderr)
                    
                time.sleep(1) # Be polite
                
            time.sleep(2)
            
    print(f"\nTotal new restaurants found with websites: {len(all_new_restaurants)}", file=sys.stderr)
    
    # Save to file
    with open('/tmp/yp_restaurants.json', 'w') as f:
        json.dump(all_new_restaurants, f, indent=2)

if __name__ == '__main__':
    main()
