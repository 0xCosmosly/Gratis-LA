import type { RestaurantServiceStyle } from '../types';

interface RestaurantMetadata {
  food_type: string;
  service_style: RestaurantServiceStyle;
}

interface MetadataTarget {
  slug: string;
  is_fast_food: boolean;
  food_type?: string | null;
  service_style?: RestaurantServiceStyle | null;
}

const metadataRules: Array<{ pattern: RegExp; metadata: RestaurantMetadata }> = [
  {
    pattern: /^attari-sandwich-shop-/,
    metadata: { service_style: 'quick_service', food_type: 'Persian' }
  },
  {
    pattern: /^cheesesteaks-by-matu-/,
    metadata: { service_style: 'quick_service', food_type: 'Cheesesteaks' }
  },
  {
    pattern: /^epicuria-at-ackerman-/,
    metadata: { service_style: 'quick_service', food_type: 'Mediterranean' }
  },
  {
    pattern: /^greenzone-/,
    metadata: { service_style: 'sit_down', food_type: 'Pan-Asian' }
  },
  {
    pattern: /^hiho-/,
    metadata: { service_style: 'quick_service', food_type: 'Burgers' }
  },
  {
    pattern: /^hinoki-and-the-bird-/,
    metadata: { service_style: 'sit_down', food_type: 'Californian' }
  },
  {
    pattern: /^hironori-craft-ramen-/,
    metadata: { service_style: 'sit_down', food_type: 'Ramen' }
  },
  {
    pattern: /^kazunori-/,
    metadata: { service_style: 'sit_down', food_type: 'Sushi' }
  },
  {
    pattern: /^matu-beverly-hills$/,
    metadata: { service_style: 'sit_down', food_type: 'Steakhouse' }
  },
  {
    pattern: /^matu-kai-/,
    metadata: { service_style: 'sit_down', food_type: 'Steakhouse' }
  },
  {
    pattern: /^plateia-/,
    metadata: { service_style: 'sit_down', food_type: 'Mediterranean' }
  },
  {
    pattern: /^qin-west-noodle-/,
    metadata: { service_style: 'sit_down', food_type: 'Chinese' }
  },
  {
    pattern: /^saddle-peak-lodge-/,
    metadata: { service_style: 'sit_down', food_type: 'American' }
  },
  {
    pattern: /^sugarfish-/,
    metadata: { service_style: 'sit_down', food_type: 'Sushi' }
  },
  {
    pattern: /^uovo-/,
    metadata: { service_style: 'sit_down', food_type: 'Italian' }
  },
  {
    pattern: /^pasjoli-/,
    metadata: { service_style: 'sit_down', food_type: 'French' }
  },
  {
    pattern: /^petit-trois-/,
    metadata: { service_style: 'sit_down', food_type: 'French' }
  },
  {
    pattern: /^portos-bakery-/,
    metadata: { service_style: 'quick_service', food_type: 'Cuban' }
  },
  {
    pattern: /^shiki-seafood-buffet-/,
    metadata: { service_style: 'sit_down', food_type: 'Seafood Buffet' }
  },
  {
    pattern: /^wake-and-late-/,
    metadata: { service_style: 'quick_service', food_type: 'Breakfast' }
  },
  {
    pattern: /^risky-business-/,
    metadata: { service_style: 'bar', food_type: 'Cocktails' }
  },
  {
    pattern: /^viet-tapas-bar-/,
    metadata: { service_style: 'sit_down', food_type: 'Vietnamese' }
  },
  {
    pattern: /^the-mulberry$/,
    metadata: { service_style: 'sit_down', food_type: 'American' }
  }
];

function getFallbackMetadata(restaurant: MetadataTarget): RestaurantMetadata {
  return {
    service_style: restaurant.service_style ?? (restaurant.is_fast_food ? 'quick_service' : 'sit_down'),
    food_type: restaurant.food_type?.trim() || 'Restaurant'
  };
}

export function withRestaurantMetadata<T extends MetadataTarget>(restaurant: T): T & RestaurantMetadata {
  const matchedRule = metadataRules.find(({ pattern }) => pattern.test(restaurant.slug));
  const metadata = matchedRule?.metadata ?? getFallbackMetadata(restaurant);

  return {
    ...restaurant,
    ...metadata
  };
}

export function getServiceStyleLabel(serviceStyle: RestaurantServiceStyle): string {
  switch (serviceStyle) {
    case 'sit_down':
      return 'Sit Down';
    case 'quick_service':
      return 'Quick Service';
    case 'bar':
      return 'Bar';
  }
}
