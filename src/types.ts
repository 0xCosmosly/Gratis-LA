export type VerificationStatus = 'verified' | 'candidate' | 'needs_review' | 'rejected';
export type VerificationVoteChoice = 'verified' | 'unverified';
export type RestaurantServiceStyle = 'sit_down' | 'quick_service' | 'bar';

export interface VerificationVoteMetadata {
  downvote_reason?: string | null;
}

export interface RestaurantRow {
  id: string;
  slug: string;
  name: string;
  address: string | null;
  city: string | null;
  neighborhood: string | null;
  website: string | null;
  yelp_url?: string | null;
  lat: number | null;
  lng: number | null;
  is_fast_food: boolean;
  service_style?: RestaurantServiceStyle | null;
  food_type?: string | null;
  has_no_tip_policy: boolean;
  has_service_fee: boolean;
  verification_status: VerificationStatus;
  base_verification_status?: VerificationStatus;
  verification_notes: string | null;
  last_checked_at: string | null;
  next_check_at: string | null;
  created_at: string;
}

export interface CitationRow {
  id: number;
  restaurant_id: string;
  source_name: string;
  source_url: string;
  excerpt: string | null;
  published_at: string | null;
  checked_at: string | null;
  indicates_no_tip: boolean;
  indicates_service_fee: boolean;
  confidence: number | null;
}

export interface VoteRow {
  restaurant_id: string;
  device_id: string;
}

export interface VerificationVoteRow extends VerificationVoteMetadata {
  restaurant_id: string;
  device_id: string;
  vote_value: VerificationVoteChoice;
  is_trusted_vote?: boolean;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface RestaurantVerificationState {
  effectiveStatus: VerificationStatus;
  graceEndsAt: string | null;
  isGraceActive: boolean;
  showVotingControls: boolean;
  userVote: VerificationVoteChoice | null;
  verifiedShare: number | null;
}

export interface PhotoRow {
  id: number;
  restaurant_id: string;
  image_url: string;
  caption: string | null;
  status: 'pending' | 'approved' | 'rejected';
}

export interface RestaurantCardData extends RestaurantRow {
  service_style: RestaurantServiceStyle;
  food_type: string;
  citations: CitationRow[];
  photos: PhotoRow[];
  voteCount: number;
  userHasUpvoted: boolean;
}

export interface RestaurantSubmission {
  name: string;
  address: string;
  city: string;
  neighborhood: string;
  website: string;
  citationTitle: string;
  citationUrl: string;
  citationExcerpt: string;
}

export interface PhotoSubmission {
  restaurantId: string;
  imageUrl: string;
  caption: string;
}
