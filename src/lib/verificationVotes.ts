import { getDeviceId } from './deviceId';
import type {
  RestaurantCardData,
  RestaurantVerificationState,
  VerificationStatus,
  VerificationVoteChoice,
  VerificationVoteMetadata,
  VerificationVoteRow
} from '../types';

const LOCAL_VERIFICATION_VOTES_KEY = 'gratis_la_verification_votes';
const VERIFIED_GRACE_DAYS = 30;

function getBaseVerificationStatus(
  restaurant: Pick<RestaurantCardData, 'verification_status' | 'base_verification_status'>
): VerificationStatus {
  return restaurant.base_verification_status ?? restaurant.verification_status;
}

function toIsoString(value: Date): string {
  return value.toISOString();
}

function addDays(value: Date, days: number): Date {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function getVerifiedGraceEndsAt(
  restaurant: Pick<RestaurantCardData, 'verification_status' | 'base_verification_status' | 'last_checked_at' | 'created_at'>
): string | null {
  if (getBaseVerificationStatus(restaurant) !== 'verified') {
    return null;
  }

  const sourceDate = restaurant.last_checked_at ?? restaurant.created_at;
  if (!sourceDate) {
    return null;
  }

  const parsed = new Date(sourceDate);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return toIsoString(addDays(parsed, VERIFIED_GRACE_DAYS));
}

function isGraceActive(graceEndsAt: string | null, now: Date): boolean {
  if (!graceEndsAt) {
    return false;
  }

  const parsed = new Date(graceEndsAt);
  if (Number.isNaN(parsed.getTime())) {
    return false;
  }

  return parsed.getTime() > now.getTime();
}

function normalizeVoteRows(rows: VerificationVoteRow[]): VerificationVoteRow[] {
  const latestByRestaurantAndDevice = new Map<string, VerificationVoteRow>();

  for (const row of rows) {
    const key = `${row.restaurant_id}::${row.device_id}`;
    const previous = latestByRestaurantAndDevice.get(key);
    if (!previous) {
      latestByRestaurantAndDevice.set(key, row);
      continue;
    }

    const previousUpdatedAt = previous.updated_at ?? previous.created_at ?? '';
    const currentUpdatedAt = row.updated_at ?? row.created_at ?? '';
    if (currentUpdatedAt >= previousUpdatedAt) {
      latestByRestaurantAndDevice.set(key, row);
    }
  }

  return Array.from(latestByRestaurantAndDevice.values());
}

function getWeightedVerifiedShare(rows: VerificationVoteRow[]): number | null {
  if (rows.length === 0) {
    return null;
  }

  const normalizedRows = normalizeVoteRows(rows);
  const trustedRows = normalizedRows.filter((row) => row.is_trusted_vote);
  const standardRows = normalizedRows.filter((row) => !row.is_trusted_vote);

  let verifiedWeight = 0;
  let totalWeight = 0;

  if (trustedRows.length === 0) {
    const weight = 1 / normalizedRows.length;
    for (const row of normalizedRows) {
      totalWeight += weight;
      if (row.vote_value === 'verified') {
        verifiedWeight += weight;
      }
    }
    return verifiedWeight / totalWeight;
  }

  if (standardRows.length === 0) {
    const weight = 1 / trustedRows.length;
    for (const row of trustedRows) {
      totalWeight += weight;
      if (row.vote_value === 'verified') {
        verifiedWeight += weight;
      }
    }
    return verifiedWeight / totalWeight;
  }

  const trustedWeight = 0.1 / trustedRows.length;
  const standardWeight = 0.9 / standardRows.length;

  for (const row of trustedRows) {
    totalWeight += trustedWeight;
    if (row.vote_value === 'verified') {
      verifiedWeight += trustedWeight;
    }
  }

  for (const row of standardRows) {
    totalWeight += standardWeight;
    if (row.vote_value === 'verified') {
      verifiedWeight += standardWeight;
    }
  }

  return verifiedWeight / totalWeight;
}

export function groupVerificationVotesByRestaurant(rows: VerificationVoteRow[]): Map<string, VerificationVoteRow[]> {
  return normalizeVoteRows(rows).reduce((acc, row) => {
    const existing = acc.get(row.restaurant_id) ?? [];
    existing.push(row);
    acc.set(row.restaurant_id, existing);
    return acc;
  }, new Map<string, VerificationVoteRow[]>());
}

export function getRestaurantVerificationState(
  restaurant: Pick<
    RestaurantCardData,
    'id' | 'verification_status' | 'base_verification_status' | 'last_checked_at' | 'created_at'
  >,
  rows: VerificationVoteRow[],
  deviceId: string,
  now: Date = new Date()
): RestaurantVerificationState {
  const baseVerificationStatus = getBaseVerificationStatus(restaurant);
  const userVote = rows.find((row) => row.device_id === deviceId)?.vote_value ?? null;
  const graceEndsAt = getVerifiedGraceEndsAt(restaurant);
  const verifiedShare = getWeightedVerifiedShare(rows);
  const graceIsActive = isGraceActive(graceEndsAt, now);

  if (baseVerificationStatus !== 'verified') {
    return {
      effectiveStatus: baseVerificationStatus,
      graceEndsAt,
      isGraceActive: false,
      showVotingControls: true,
      userVote,
      verifiedShare
    };
  }

  if (graceIsActive) {
    return {
      effectiveStatus: 'verified',
      graceEndsAt,
      isGraceActive: true,
      showVotingControls: true,
      userVote,
      verifiedShare
    };
  }

  const effectiveStatus = verifiedShare === null || verifiedShare > 0.5 ? 'verified' : 'needs_review';

  return {
    effectiveStatus,
    graceEndsAt,
    isGraceActive: false,
    showVotingControls: effectiveStatus === 'verified',
    userVote,
    verifiedShare
  };
}

export function loadLocalVerificationVotes(): VerificationVoteRow[] {
  if (typeof window === 'undefined') {
    return [];
  }

  const raw = window.localStorage.getItem(LOCAL_VERIFICATION_VOTES_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as VerificationVoteRow[];
    return Array.isArray(parsed) ? normalizeVoteRows(parsed) : [];
  } catch {
    return [];
  }
}

export function saveLocalVerificationVote(
  restaurantId: string,
  voteValue: VerificationVoteChoice | null,
  metadata: VerificationVoteMetadata | null = null
): VerificationVoteRow[] {
  const deviceId = getDeviceId();
  const now = toIsoString(new Date());
  const currentVotes = loadLocalVerificationVotes();
  const votesWithoutCurrentDevice = currentVotes.filter(
    (row) => !(row.restaurant_id === restaurantId && row.device_id === deviceId)
  );
  const nextVotes = normalizeVoteRows(
    voteValue === null
      ? votesWithoutCurrentDevice
      : [
          ...votesWithoutCurrentDevice,
          {
            restaurant_id: restaurantId,
            device_id: deviceId,
            vote_value: voteValue,
            downvote_reason: metadata?.downvote_reason ?? null,
            is_trusted_vote: false,
            created_at: now,
            updated_at: now
          }
        ]
  );

  if (typeof window !== 'undefined') {
    window.localStorage.setItem(LOCAL_VERIFICATION_VOTES_KEY, JSON.stringify(nextVotes));
  }

  return nextVotes;
}
