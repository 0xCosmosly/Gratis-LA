import reviewRestaurants from '../../data/review-restaurants.json';
import seedRestaurants from '../../data/seed-restaurants.json';
import { withRestaurantMetadata } from './restaurantMetadata';
import type { CitationRow, RestaurantCardData, RestaurantServiceStyle, VerificationStatus } from '../types';

const visibleStatuses: VerificationStatus[] = ['verified', 'candidate', 'needs_review'];

interface SeedCitation {
  source_name: string;
  source_url: string;
  excerpt?: string | null;
  published_at?: string | null;
  checked_at?: string | null;
  indicates_no_tip?: boolean;
  indicates_service_fee?: boolean;
  confidence?: number | null;
}

interface SeedRestaurant {
  id?: string;
  slug: string;
  name: string;
  address?: string | null;
  city?: string | null;
  neighborhood?: string | null;
  website?: string | null;
  yelp_url?: string | null;
  lat?: number | null;
  lng?: number | null;
  is_fast_food: boolean;
  service_style?: RestaurantServiceStyle | null;
  food_type?: string | null;
  has_no_tip_policy: boolean;
  has_service_fee: boolean;
  verification_status: VerificationStatus;
  verification_notes?: string | null;
  last_checked_at?: string | null;
  next_check_at?: string | null;
  citations?: SeedCitation[];
}

function toCitationRows(restaurantId: string, citations: SeedCitation[], restaurantIndex: number): CitationRow[] {
  return citations.map((citation, citationIndex) => ({
    id: restaurantIndex * 1000 + citationIndex + 1,
    restaurant_id: restaurantId,
    source_name: citation.source_name,
    source_url: citation.source_url,
    excerpt: citation.excerpt ?? null,
    published_at: citation.published_at ?? null,
    checked_at: citation.checked_at ?? null,
    indicates_no_tip: Boolean(citation.indicates_no_tip),
    indicates_service_fee: Boolean(citation.indicates_service_fee),
    confidence: citation.confidence ?? null
  }));
}

export function loadDemoRestaurants(): RestaurantCardData[] {
  const rows = [...(seedRestaurants as SeedRestaurant[]), ...(reviewRestaurants as SeedRestaurant[])];

  return rows
    .filter((restaurant) => restaurant.has_no_tip_policy || restaurant.has_service_fee)
    .filter((restaurant) => !restaurant.is_fast_food)
    .filter((restaurant) => visibleStatuses.includes(restaurant.verification_status))
    .map((restaurant, restaurantIndex) => {
      const id = restaurant.id ?? `local-${restaurant.slug}`;
      const baseRestaurant = withRestaurantMetadata({
        id,
        slug: restaurant.slug,
        name: restaurant.name,
        address: restaurant.address ?? null,
        city: restaurant.city ?? null,
        neighborhood: restaurant.neighborhood ?? null,
        website: restaurant.website ?? null,
        yelp_url: restaurant.yelp_url ?? null,
        lat: restaurant.lat ?? null,
        lng: restaurant.lng ?? null,
        is_fast_food: restaurant.is_fast_food,
        service_style: restaurant.service_style ?? null,
        food_type: restaurant.food_type ?? null,
        has_no_tip_policy: restaurant.has_no_tip_policy,
        has_service_fee: restaurant.has_service_fee,
        verification_status: restaurant.verification_status,
        base_verification_status: restaurant.verification_status,
        verification_notes: restaurant.verification_notes ?? null,
        last_checked_at: restaurant.last_checked_at ?? null,
        next_check_at: restaurant.next_check_at ?? null,
        created_at: restaurant.last_checked_at ?? '2026-03-12T00:00:00Z'
      });

      return {
        ...baseRestaurant,
        citations: toCitationRows(id, restaurant.citations ?? [], restaurantIndex),
        photos: [],
        voteCount: 0,
        userHasUpvoted: false
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
