import { CheerioCrawler, log } from 'crawlee';
import fs from 'fs';

// Configure logging
log.setLevel(log.LEVELS.INFO);

// Target phrases people use on Reddit when praising true no-tip spots
const TARGET_PHRASES = [
    /no tip screen/i,
    /doesn't ask for a tip/i,
    /no option to tip/i,
    /refreshing to not see a tip/i,
    /ipad spin/i,
    /no tipping screen/i
];

const results = [];

const crawler = new CheerioCrawler({
    maxRequestsPerCrawl: 50,
    
    async requestHandler({ $, request }) {
        log.info(`Processing Reddit thread: ${request.url}`);
        
        let foundMentions = [];
        
        // In Cheerio/Crawlee for Reddit, we parse the comment Divs
        // Note: Reddit's HTML classes change, so we look at general text blocks
        $('p, .md').each((i, el) => {
            const text = $(el).text();
            
            // Check if comment complains about iPads but praises a specific spot
            for (const phrase of TARGET_PHRASES) {
                if (phrase.test(text)) {
                    // We grab the comment text as context. Further LLM processing
                    // or manual review can extract the exact restaurant name.
                    foundMentions.push({
                        matched_phrase: phrase.toString(),
                        comment_context: text.trim(),
                        thread_url: request.url
                    });
                    break;
                }
            }
        });

        if (foundMentions.length > 0) {
            log.info(`Found ${foundMentions.length} relevant comments in thread.`);
            results.push(...foundMentions);
        }
    },
    
    // Optional: add failed request handling
    failedRequestHandler({ request, error }) {
        log.error(`Request ${request.url} failed with error: ${error.message}`);
    },
});

async function main() {
    log.info('Starting Reddit "Anti-iPad" discovery crawl...');
    
    // Seed URLs: We can manually supply specific Google search results of Reddit, 
    // or specific high-traction /r/FoodLosAngeles threads about tipping.
    const seedThreads = [
        "https://www.reddit.com/r/FoodLosAngeles/comments/1example1/whats_your_favorite_tip_free_spot/",
        // You can add more targeted thread URLs here after a quick Google search
    ];
    
    // Since Google blocks automated scraping without an API, we feed it known threads
    // or use Reddit's JSON search endpoint. 
    const searchUrl = 'https://www.reddit.com/r/FoodLosAngeles/search.json?q="tip%20screen"&restrict_sr=1';
    
    log.info('Fetching thread list from Reddit API...');
    try {
        const response = await fetch(searchUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (GratisLA-Bot/1.0)' }
        });
        const data = await response.json();
        const threads = data.data.children.map(child => `https://www.reddit.com${child.data.permalink}`);
        
        await crawler.run(threads);
        
        fs.writeFileSync(
            'data/reddit-tip-screen-leads.json', 
            JSON.stringify(results, null, 2)
        );
        log.info(`Scrape complete! Wrote ${results.length} potential leads to data/reddit-tip-screen-leads.json`);
    } catch (err) {
        log.error('Failed to fetch from Reddit API or crawl: ' + err);
    }
}

main();
