import fs from 'fs';

// 1. Read files
let seedData = JSON.parse(fs.readFileSync('data/seed-restaurants.json', 'utf8'));
let rejectedData = JSON.parse(fs.readFileSync('data/rejected-restaurants.json', 'utf8'));

// 2. Add Tigawok to seedData
const tigawokID = "local-tigawok-sawtelle";
if (!seedData.find(r => r.id === tigawokID)) {
    seedData.push({
        id: tigawokID,
        slug: "tigawok-sawtelle",
        name: "Tigawok",
        address: "2224 Sawtelle Blvd, Los Angeles, CA 90064",
        city: "Los Angeles",
        neighborhood: "Sawtelle",
        website: null,
        yelp_url: "https://www.yelp.com/biz/tigawok-los-angeles",
        lat: 34.037562,
        lng: -118.441865,
        is_fast_food: false,
        has_no_tip_policy: true,
        has_service_fee: false,
        verification_status: "verified",
        verification_notes: "No tipping option available, NO service charge/surcharge. Confirmed via Yelp reviews/BrowserOS.",
        last_checked_at: new Date().toISOString(),
        next_check_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        citations: [
            {
                source_name: "Yelp Reviews for Tigawok",
                source_url: "https://www.yelp.com/biz/tigawok-los-angeles",
                excerpt: "There is no option to tip, which is new norm like rest of the world. No tip either - rare find!",
                published_at: "2024-07-01T00:00:00Z",
                checked_at: new Date().toISOString(),
                indicates_no_tip: true,
                indicates_service_fee: false,
                confidence: 5
            }
        ]
    });
    console.log("Added Tigawok to seed-restaurants.json");
} else {
    console.log("Tigawok already exists");
}

// 3. Identify false positives keyword matches
const fpKeywords = ["Kazunori", "KazuNori", "Sugarfish", "SUGARFISH", "HiHo", "Mo Mo", "Uovo", "Matu", "SOBAR", "Sushi Tama", "Ōwa", "Owa", "kodo", "Shojin", "Ten no Meshi", "Momo Paradise", "Mo Mo Paradise", "Cheesesteaks by Matu"];

const toReject = seedData.filter(r => fpKeywords.some(kw => r.name.toLowerCase().includes(kw.toLowerCase())));

seedData = seedData.filter(r => !fpKeywords.some(kw => r.name.toLowerCase().includes(kw.toLowerCase())));
console.log(`Moved ${toReject.length} false positive restaurants from seed to rejected.`);

for (let r of toReject) {
    r.verification_status = "rejected";
    r.verification_notes = "Excluded: found to be false positive (has standard mandatory 16-20% service charge).";
    if (!rejectedData.find(rej => rej.id === r.id)) {
        rejectedData.push(r);
    }
}

// Add any missing ones from No_Tipping_LA_Final.md
const explicitRejects = [
    { name: "KazuNori (Downtown)", slug: "kazunori-downtown" },
    { name: "KazuNori (Marina Del Rey)", slug: "kazunori-mdr" },
    { name: "KazuNori (Koreatown)", slug: "kazunori-ktown" },
    { name: "Sugarfish (La Brea)", slug: "sugarfish-labrea" },
    { name: "Sugarfish (Hollywood)", slug: "sugarfish-hollywood" },
    { name: "HiHo Cheeseburger", slug: "hiho-cheeseburger" },
    { name: "Uovo", slug: "uovo" },
    { name: "Matu", slug: "matu" },
    { name: "Mo Mo Paradise (Arcadia)", slug: "momo-paradise-arcadia" },
    { name: "SOBAR", slug: "sobar" },
    { name: "Sushi Tama", slug: "sushi-tama" },
    { name: "Ōwa", slug: "owa" },
    { name: "kodo", slug: "kodo" },
    { name: "Shojin", slug: "shojin" },
    { name: "Ten no Meshi", slug: "ten-no-meshi" }
];

let addedNewRejects = 0;
for (const fp of explicitRejects) {
    const slug = fp.slug;
    // Check if we already rejected something like this
    if (!rejectedData.find(r => r.id === "local-" + slug || r.slug === slug || r.name.toLowerCase().includes(fp.name.toLowerCase()))) {
        rejectedData.push({
            id: "local-" + slug,
            slug: slug,
            name: fp.name,
            address: null,
            city: "Los Angeles",
            neighborhood: null,
            website: null,
            yelp_url: null,
            lat: null,
            lng: null,
            is_fast_food: false,
            has_no_tip_policy: false,
            has_service_fee: true,
            verification_status: "rejected",
            verification_notes: "Excluded: found to be false positive (has standard mandatory 16-20% service charge).",
            last_checked_at: new Date().toISOString(),
            next_check_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
            citations: []
        });
        addedNewRejects++;
    }
}
console.log(`Added ${addedNewRejects} new explicit targets to rejected-restaurants.json`);

// 4. Save files
fs.writeFileSync('data/seed-restaurants.json', JSON.stringify(seedData, null, 2));
fs.writeFileSync('data/rejected-restaurants.json', JSON.stringify(rejectedData, null, 2));
console.log("Done.");
