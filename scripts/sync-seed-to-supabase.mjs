import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false }
});

const seedPath = path.join(process.cwd(), 'data', 'seed-restaurants.json');
const rawSeed = await fs.readFile(seedPath, 'utf8');
const seed = JSON.parse(rawSeed);

if (!Array.isArray(seed)) {
  console.error('Seed file must be an array.');
  process.exit(1);
}

let syncedRestaurants = 0;
let syncedCitations = 0;

for (const item of seed) {
  const restaurantPayload = {
    slug: item.slug,
    name: item.name,
    address: item.address ?? null,
    city: item.city ?? null,
    neighborhood: item.neighborhood ?? null,
    website: item.website ?? null,
    lat: item.lat ?? null,
    lng: item.lng ?? null,
    is_fast_food: Boolean(item.is_fast_food),
    has_no_tip_policy: Boolean(item.has_no_tip_policy),
    has_service_fee: Boolean(item.has_service_fee),
    verification_status: item.verification_status,
    verification_notes: item.verification_notes ?? null,
    last_checked_at: item.last_checked_at ?? null,
    next_check_at: item.next_check_at ?? null
  };

  const { data: restaurant, error: restaurantError } = await supabase
    .from('restaurants')
    .upsert(restaurantPayload, { onConflict: 'slug' })
    .select('id')
    .single();

  if (restaurantError || !restaurant) {
    console.error(`Failed to upsert restaurant ${item.name}:`, restaurantError?.message ?? 'Unknown error');
    continue;
  }

  syncedRestaurants += 1;

  const citations = Array.isArray(item.citations) ? item.citations : [];
  if (citations.length === 0) {
    continue;
  }

  const citationPayload = citations.map((citation) => ({
    restaurant_id: restaurant.id,
    source_name: citation.source_name,
    source_url: citation.source_url,
    excerpt: citation.excerpt ?? null,
    published_at: citation.published_at ?? null,
    checked_at: citation.checked_at ?? null,
    indicates_no_tip: Boolean(citation.indicates_no_tip),
    indicates_service_fee: Boolean(citation.indicates_service_fee),
    confidence: citation.confidence ?? null
  }));

  const { error: citationError } = await supabase
    .from('citations')
    .upsert(citationPayload, { onConflict: 'restaurant_id,source_url' });

  if (citationError) {
    console.error(`Failed to upsert citations for ${item.name}:`, citationError.message);
    continue;
  }

  syncedCitations += citationPayload.length;
}

console.log(`Synced ${syncedRestaurants} restaurants and ${syncedCitations} citations.`);
