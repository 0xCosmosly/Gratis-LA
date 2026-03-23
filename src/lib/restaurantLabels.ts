import type { RestaurantCardData } from '../types';

export function getStatusTone(
  restaurant: Pick<RestaurantCardData, 'verification_status' | 'has_service_fee' | 'has_no_tip_policy'>
): 'no_tip' | 'included' | 'unverified' | 'verified' | 'excluded' {
  if (restaurant.verification_status === 'rejected') {
    return 'excluded';
  }

  if (restaurant.verification_status !== 'verified') {
    return 'unverified';
  }

  if (restaurant.has_no_tip_policy && !restaurant.has_service_fee) {
    return 'no_tip';
  }

  if (restaurant.has_service_fee) {
    return 'included';
  }

  return 'verified';
}

export function getStatusLabel(
  restaurant: Pick<RestaurantCardData, 'verification_status' | 'has_service_fee' | 'has_no_tip_policy'>
): string {
  if (restaurant.verification_status === 'rejected') {
    return 'Excluded';
  }

  if (restaurant.verification_status !== 'verified') {
    return 'Unverified';
  }

  if (restaurant.has_no_tip_policy && !restaurant.has_service_fee) {
    return 'No Tipping';
  }

  if (restaurant.has_service_fee) {
    return 'Tip Included';
  }

  return 'Verified';
}
