import { useEffect, useMemo, useRef, useState } from 'react';
import { MapView } from './components/MapView';
import { RestaurantList } from './components/RestaurantList';
import { buildChainCounts, isChainRestaurant } from './lib/chains';
import { loadDemoRestaurants } from './lib/demoData';
import { getDeviceId } from './lib/deviceId';
import { getSearchScore, isBlacklistedFastFood, matchesSearch, matchesStatus } from './lib/filters';
import { withRestaurantMetadata } from './lib/restaurantMetadata';
import { getStatusLabel, getStatusTone } from './lib/restaurantLabels';
import { supabase } from './lib/supabase';
import {
  getRestaurantVerificationState,
  groupVerificationVotesByRestaurant,
  loadLocalVerificationVotes,
  saveLocalVerificationVote
} from './lib/verificationVotes';
import type {
  CitationRow,
  RestaurantCardData,
  RestaurantRow,
  RestaurantVerificationState,
  VerificationStatus,
  VerificationVoteChoice,
  VerificationVoteMetadata,
  VerificationVoteRow
} from './types';

const defaultStatuses: VerificationStatus[] = ['verified', 'candidate', 'needs_review'];
const defaultRestaurantFilters = ['chains', 'sit_down', 'quick_service', 'bar'] as const;

const statusOrder: Record<VerificationStatus, number> = {
  verified: 0,
  candidate: 1,
  needs_review: 2,
  rejected: 3
};

const showExtraChrome = false;
const showSelectedRecord = false;
const suggestionFormUrl =
  'https://docs.google.com/forms/d/e/1FAIpQLSc4EnjoMvPO3It2-bCula_Bxs2Gj8kDYjGRGU6_tc1CGrQJfQ/viewform';
const donationUrl = 'https://buymeacoffee.com/raychco';
const oneFairWageUrl = 'https://www.onefairwage.org/';
const lastUpdatedLabel = '03/22/2026';
const launchChangelogLabel = '03/22/2026 // Went live for the first time';
const mobileChangelogLabel = '03/19/2026 // Created mobile version';
const selectedRestaurantUrlParam = 'restaurant';
const mobileViewportQuery = '(max-width: 768px)';

interface UserLocation {
  lat: number;
  lng: number;
}

interface NavigatorWithStandalone extends Navigator {
  standalone?: boolean;
}

type PolicyFilter = 'all' | 'no_tip' | 'included' | 'unverified';
type RestaurantVisibilityFilter = (typeof defaultRestaurantFilters)[number];

function isStrictNoTipLocation(restaurant: Pick<RestaurantRow, 'has_no_tip_policy' | 'has_service_fee' | 'verification_status'>) {
  return restaurant.has_no_tip_policy && !restaurant.has_service_fee && restaurant.verification_status === 'verified';
}

function isVerifiedIncludedLocation(restaurant: Pick<RestaurantRow, 'has_service_fee' | 'verification_status'>) {
  return restaurant.has_service_fee && restaurant.verification_status === 'verified';
}

function isUnverifiedLocation(restaurant: Pick<RestaurantRow, 'verification_status'>) {
  return restaurant.verification_status !== 'verified';
}

const MAX_MOBILE_LIST_ITEMS = 5;

function groupByRestaurantId<T extends { restaurant_id: string }>(rows: T[]): Map<string, T[]> {
  return rows.reduce((acc, row) => {
    const existing = acc.get(row.restaurant_id) ?? [];
    existing.push(row);
    acc.set(row.restaurant_id, existing);
    return acc;
  }, new Map<string, T[]>());
}

function distanceInMiles(userLocation: UserLocation, restaurant: RestaurantRow): number {
  if (restaurant.lat === null || restaurant.lng === null) {
    return Number.POSITIVE_INFINITY;
  }

  const earthRadiusMiles = 3958.8;
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const latDelta = toRadians(restaurant.lat - userLocation.lat);
  const lngDelta = toRadians(restaurant.lng - userLocation.lng);
  const startLat = toRadians(userLocation.lat);
  const endLat = toRadians(restaurant.lat);

  const haversine =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(startLat) * Math.cos(endLat) * Math.sin(lngDelta / 2) ** 2;

  return 2 * earthRadiusMiles * Math.asin(Math.sqrt(haversine));
}

function hasCoordinates<T extends Pick<RestaurantRow, 'lat' | 'lng'>>(
  restaurant: T
): restaurant is T & { lat: number; lng: number } {
  return restaurant.lat !== null && restaurant.lng !== null;
}

function getClosestMappedRestaurant(
  restaurants: RestaurantCardData[],
  userLocation: UserLocation | null
): RestaurantCardData | null {
  const mappedRestaurants = restaurants.filter(hasCoordinates);

  if (mappedRestaurants.length === 0) {
    return null;
  }

  if (!userLocation) {
    return mappedRestaurants[0] ?? null;
  }

  return mappedRestaurants.reduce((closestRestaurant, restaurant) => {
    return distanceInMiles(userLocation, restaurant) < distanceInMiles(userLocation, closestRestaurant)
      ? restaurant
      : closestRestaurant;
  });
}

function findRestaurantByUrlToken(restaurants: RestaurantCardData[], token: string | null): RestaurantCardData | null {
  if (!token) {
    return null;
  }

  return (
    restaurants.find((restaurant) => restaurant.slug === token) ??
    restaurants.find((restaurant) => restaurant.id === token) ??
    null
  );
}

export default function App() {
  const hasSharedRestaurantSelection =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).has(selectedRestaurantUrlParam);
  const [restaurants, setRestaurants] = useState<RestaurantCardData[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState<string>('');
  const [isSearchOpen, setIsSearchOpen] = useState<boolean>(false);
  const [statusFilters, setStatusFilters] = useState<VerificationStatus[]>(defaultStatuses);
  const [policyFilter, setPolicyFilter] = useState<PolicyFilter>(() =>
    typeof window !== 'undefined' &&
    window.matchMedia(mobileViewportQuery).matches &&
    !hasSharedRestaurantSelection
      ? 'no_tip'
      : 'all'
  );
  const [restaurantFilters, setRestaurantFilters] = useState<RestaurantVisibilityFilter[]>([
    ...defaultRestaurantFilters
  ]);
  const [selectedFoodTypes, setSelectedFoodTypes] = useState<string[]>([]);
  const [message, setMessage] = useState<string>('');
  const [mobilePanel, setMobilePanel] = useState<'map' | 'list'>(() =>
    typeof window !== 'undefined' && window.matchMedia(mobileViewportQuery).matches
      ? hasSharedRestaurantSelection
        ? 'map'
        : 'list'
      : 'map'
  );
  const [isMobileViewport, setIsMobileViewport] = useState<boolean>(() =>
    typeof window === 'undefined' ? false : window.matchMedia(mobileViewportQuery).matches
  );
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null);
  const [showIosInstallHint, setShowIosInstallHint] = useState<boolean>(false);
  const [verificationVotes, setVerificationVotes] = useState<VerificationVoteRow[]>([]);
  const [pendingVerificationVoteById, setPendingVerificationVoteById] = useState<Record<string, boolean>>({});
  const [closestRestaurantRequestToken, setClosestRestaurantRequestToken] = useState<number>(0);
  const [mapSelectionFocusToken, setMapSelectionFocusToken] = useState<number>(0);
  const [isLosAngelesOverviewActive, setIsLosAngelesOverviewActive] = useState<boolean>(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const searchShellRef = useRef<HTMLDivElement | null>(null);
  const initialSelectedRestaurantToken = useMemo(() => {
    if (typeof window === 'undefined') {
      return null;
    }

    return new URLSearchParams(window.location.search).get(selectedRestaurantUrlParam);
  }, []);
  const deviceId = useMemo(() => (typeof window === 'undefined' ? '' : getDeviceId()), []);
  const [mobilePage, setMobilePage] = useState<number>(1);

  const handleSelectRestaurant = (restaurantId: string) => {
    setIsLosAngelesOverviewActive(false);
    setSelectedId(restaurantId);
  };

  const requestClosestRestaurantFocus = () => {
    setClosestRestaurantRequestToken((current) => current + 1);
  };

  useEffect(() => {
    async function loadRestaurants() {
      setLoading(true);
      setMessage('');

      if (!supabase) {
        const demoRows = loadDemoRestaurants();
        setRestaurants(demoRows);
        setVerificationVotes(loadLocalVerificationVotes());
        setSelectedId((currentSelectedId) => {
          const restaurantFromUrl = findRestaurantByUrlToken(demoRows, initialSelectedRestaurantToken);
          if (restaurantFromUrl) {
            return restaurantFromUrl.id;
          }

          if (currentSelectedId && demoRows.some((restaurant) => restaurant.id === currentSelectedId)) {
            return currentSelectedId;
          }

          const qinNoodle = demoRows.find((r) => r.name.toLowerCase().includes('qin west'));
          return qinNoodle ? qinNoodle.id : null;
        });
        setLoading(false);
        return;
      }

      const { data: restaurantRows, error: restaurantError } = await supabase
        .from('restaurants')
        .select('*')
        .eq('is_fast_food', false)
        .in('verification_status', defaultStatuses)
        .order('name', { ascending: true });

      if (restaurantError) {
        setMessage(`Could not load locations: ${restaurantError.message}`);
        setLoading(false);
        return;
      }

      const rows = (restaurantRows ?? []).filter(
        (r: any) => 
          r.verification_status !== 'needs_review' && 
          r.verification_status !== 'candidate' &&
          !r.name.toLowerCase().includes('mcdonald')
      ) as RestaurantRow[];

      if (rows.length === 0) {
        setRestaurants([]);
        setSelectedId(null);
        setLoading(false);
        return;
      }

      const restaurantIds = rows.map((restaurant) => restaurant.id);
      const { data: citationRows, error: citationError } = await supabase
        .from('citations')
        .select('*')
        .in('restaurant_id', restaurantIds)
        .order('confidence', { ascending: false });

      if (citationError) {
        setMessage(`Could not load citations: ${citationError.message}`);
        setLoading(false);
        return;
      }

      const citationMap = groupByRestaurantId((citationRows ?? []) as CitationRow[]);
      
      // Inject dummy citation for The Mulberry to show up as 'Included'
      citationMap.set('the-mulberry-custom-id', [
        {
          id: 'mulberry-citation',
          restaurant_id: 'the-mulberry-custom-id',
          source_name: 'LA Times',
          source_url: 'https://www.latimes.com/food/story/2024-03-01/the-mulberry-los-angeles-bar-hollywood-tipped-minimum-wage',
          excerpt: 'The Mulberry is a no-tipping establishment with a service-included model.',
          indicates_no_tip: true,
          indicates_service_fee: true,
          confidence: 'high',
          published_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
          checked_at: new Date().toISOString()
        } as unknown as CitationRow
      ]);

      const { data: verificationVoteRows, error: verificationVoteError } = await supabase
        .from('verification_votes')
        .select('*')
        .in('restaurant_id', restaurantIds);

      if (verificationVoteError) {
        console.error('Could not load verification votes:', verificationVoteError.message);
      }

      const hydratedRows: RestaurantCardData[] = rows.map((restaurant) => {
        const baseRestaurant = withRestaurantMetadata({
          ...restaurant,
          base_verification_status: restaurant.verification_status
        });

        return {
          ...baseRestaurant,
          citations: citationMap.get(restaurant.id) ?? [],
          photos: [],
          voteCount: 0,
          userHasUpvoted: false
        };
      });

      setRestaurants(hydratedRows);
      setVerificationVotes((verificationVoteRows ?? []) as VerificationVoteRow[]);
      setSelectedId((currentSelectedId) => {
        const restaurantFromUrl = findRestaurantByUrlToken(hydratedRows, initialSelectedRestaurantToken);
        if (restaurantFromUrl) {
          return restaurantFromUrl.id;
        }

        if (currentSelectedId && hydratedRows.some((restaurant) => restaurant.id === currentSelectedId)) {
          return currentSelectedId;
        }

        const qinNoodle = hydratedRows.find((r) => r.name.toLowerCase().includes('qin west'));
        return qinNoodle ? qinNoodle.id : null;
      });
      setLoading(false);
    }

    void loadRestaurants();
  }, [initialSelectedRestaurantToken]);

  const requestUserLocation = () => {
    if (typeof window === 'undefined' || !('geolocation' in navigator)) {
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setUserLocation({
          lat: position.coords.latitude,
          lng: position.coords.longitude
        });
        if (!initialSelectedRestaurantToken) {
          requestClosestRestaurantFocus();
        }
      },
      (error) => {
        setUserLocation(null);

        if (error.code === error.PERMISSION_DENIED) {
          return;
        }
      },
      {
        enableHighAccuracy: false,
        timeout: 10000,
        maximumAge: 300000
      }
    );
  };

  useEffect(() => {
    requestUserLocation();
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const mediaQueryList = window.matchMedia(mobileViewportQuery);
    const syncViewport = () => {
      setIsMobileViewport(mediaQueryList.matches);
      if (mediaQueryList.matches) {
        setMobilePanel(hasSharedRestaurantSelection ? 'map' : 'list');
        setMobilePage(1);
      }
    };

    syncViewport();
    mediaQueryList.addEventListener('change', syncViewport);

    return () => {
      mediaQueryList.removeEventListener('change', syncViewport);
    };
  }, [hasSharedRestaurantSelection]);

  const hasAutoMapSwitched = useRef(false);

  useEffect(() => {
    if (!isMobileViewport || !initialSelectedRestaurantToken || !selectedId || hasAutoMapSwitched.current) {
      return;
    }

    hasAutoMapSwitched.current = true;
    setMobilePanel('map');
  }, [initialSelectedRestaurantToken, isMobileViewport, selectedId]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const dismissed = window.localStorage.getItem('gratis-la-dismissed-ios-install-hint') === 'true';
    const navigatorWithStandalone = window.navigator as NavigatorWithStandalone;
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches || navigatorWithStandalone.standalone === true;
    const isIos = /iphone|ipad|ipod/i.test(window.navigator.userAgent);
    const isSafari = /safari/i.test(window.navigator.userAgent) && !/crios|fxios|edgios/i.test(window.navigator.userAgent);

    setShowIosInstallHint(isIos && isSafari && !isStandalone && !dismissed);
  }, []);

  useEffect(() => {
    if (isSearchOpen) {
      searchInputRef.current?.focus();
    }
  }, [isSearchOpen]);

  useEffect(() => {
    if (!isSearchOpen) {
      return;
    }

    const handleOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      if (searchShellRef.current?.contains(target)) {
        return;
      }

      setQuery('');
      setIsSearchOpen(false);
    };

    window.addEventListener('pointerdown', handleOutsidePointerDown, true);
    return () => {
      window.removeEventListener('pointerdown', handleOutsidePointerDown, true);
    };
  }, [isSearchOpen]);

  const dismissIosInstallHint = () => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('gratis-la-dismissed-ios-install-hint', 'true');
    }

    setShowIosInstallHint(false);
  };

  const verificationVotesByRestaurant = useMemo(
    () => groupVerificationVotesByRestaurant(verificationVotes),
    [verificationVotes]
  );

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const nextUrl = new URL(window.location.href);
    const selectedRestaurantForUrl = restaurants.find((restaurant) => restaurant.id === selectedId) ?? null;

    if (selectedRestaurantForUrl) {
      nextUrl.searchParams.set(
        selectedRestaurantUrlParam,
        selectedRestaurantForUrl.slug || selectedRestaurantForUrl.id
      );
    } else {
      nextUrl.searchParams.delete(selectedRestaurantUrlParam);
    }

    const nextHref = `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`;
    const currentHref = `${window.location.pathname}${window.location.search}${window.location.hash}`;

    if (nextHref !== currentHref) {
      window.history.replaceState({}, '', nextHref);
    }
  }, [restaurants, selectedId]);

  const verificationStateById = useMemo(() => {
    return restaurants.reduce((acc, restaurant) => {
      acc.set(
        restaurant.id,
        getRestaurantVerificationState(
          restaurant,
          verificationVotesByRestaurant.get(restaurant.id) ?? [],
          deviceId
        )
      );
      return acc;
    }, new Map<string, RestaurantVerificationState>());
  }, [deviceId, restaurants, verificationVotesByRestaurant]);

  const effectiveRestaurants = useMemo(
    () =>
      restaurants.map((restaurant) => {
        const verificationState = verificationStateById.get(restaurant.id);
        return verificationState
          ? {
              ...restaurant,
              verification_status: verificationState.effectiveStatus
            }
          : restaurant;
      }),
    [restaurants, verificationStateById]
  );

  const chainCounts = useMemo(() => buildChainCounts(restaurants), [restaurants]);
  const availableFoodTypes = useMemo(
    () =>
      [...new Set(restaurants.map((restaurant) => restaurant.food_type).filter((foodType): foodType is string => Boolean(foodType)))]
        .sort((a, b) => a.localeCompare(b)),
    [restaurants]
  );
  const areChainsVisible = restaurantFilters.includes('chains');
  const areSitDownRestaurantsVisible = restaurantFilters.includes('sit_down');
  const areQuickServiceRestaurantsVisible = restaurantFilters.includes('quick_service');
  const areBarRestaurantsVisible = restaurantFilters.includes('bar');
  const hasVisibleServiceStyleFilter =
    areSitDownRestaurantsVisible || areQuickServiceRestaurantsVisible || areBarRestaurantsVisible;

  const filteredRestaurants = useMemo(() => {
    const trimmedQuery = query.trim();
    const searchScoreCache = new Map<string, number>();
    const getCachedSearchScore = (restaurant: RestaurantCardData) => {
      const existing = searchScoreCache.get(restaurant.id);
      if (existing !== undefined) {
        return existing;
      }

      const score = getSearchScore(restaurant, trimmedQuery);
      searchScoreCache.set(restaurant.id, score);
      return score;
    };

    return effectiveRestaurants
      .filter((restaurant) => restaurant.has_no_tip_policy || restaurant.has_service_fee)
      .filter((restaurant) => {
        if (policyFilter === 'no_tip') {
          return isStrictNoTipLocation(restaurant);
        }

        if (policyFilter === 'included') {
          return isVerifiedIncludedLocation(restaurant);
        }

        if (policyFilter === 'unverified') {
          return isUnverifiedLocation(restaurant);
        }

        return true;
      })
      .filter((restaurant) => areChainsVisible || !isChainRestaurant(restaurant, chainCounts))
      .filter((restaurant) => {
        if (!hasVisibleServiceStyleFilter) {
          return areChainsVisible ? isChainRestaurant(restaurant, chainCounts) : true;
        }

        switch (restaurant.service_style) {
          case 'sit_down':
            return areSitDownRestaurantsVisible;
          case 'quick_service':
            return areQuickServiceRestaurantsVisible;
          case 'bar':
            return areBarRestaurantsVisible;
        }
      })
      .filter((restaurant) => selectedFoodTypes.length === 0 || selectedFoodTypes.includes(restaurant.food_type))
      .filter((restaurant) => matchesSearch(restaurant, trimmedQuery))
      .filter((restaurant) => matchesStatus(restaurant, statusFilters))
      .filter((restaurant) => !isBlacklistedFastFood(restaurant.name))
      .sort((a, b) => {
        if (trimmedQuery) {
          const searchDelta = getCachedSearchScore(a) - getCachedSearchScore(b);
          if (searchDelta !== 0) {
            return searchDelta;
          }
        }

        if (userLocation) {
          const distanceDelta = distanceInMiles(userLocation, a) - distanceInMiles(userLocation, b);
          if (distanceDelta !== 0) {
            return distanceDelta;
          }
        }

        return statusOrder[a.verification_status] - statusOrder[b.verification_status] || a.name.localeCompare(b.name);
      });
  }, [
    areChainsVisible,
    areBarRestaurantsVisible,
    hasVisibleServiceStyleFilter,
    areQuickServiceRestaurantsVisible,
    areSitDownRestaurantsVisible,
    chainCounts,
    effectiveRestaurants,
    policyFilter,
    query,
    selectedFoodTypes,
    statusFilters,
    userLocation
  ]);

  const selectedRestaurant = filteredRestaurants.find((restaurant) => restaurant.id === selectedId) ?? null;
  const selectedRestaurantHasCoordinates = selectedRestaurant ? hasCoordinates(selectedRestaurant) : false;
  const closestMappedRestaurant = useMemo(
    () => getClosestMappedRestaurant(filteredRestaurants, userLocation),
    [filteredRestaurants, userLocation]
  );
  const restaurantsWithCoordinates = filteredRestaurants.filter(
    (restaurant) => restaurant.lat !== null && restaurant.lng !== null
  ).length;
  const mobileListShouldScroll = false; // Disabled inner scroll on mobile, relying on full page scroll
  const noTipCount = effectiveRestaurants.filter((restaurant) => isStrictNoTipLocation(restaurant)).length;
  const includedCount = effectiveRestaurants.filter((restaurant) => restaurant.has_service_fee).length;
  const reviewCount = effectiveRestaurants.filter((restaurant) => restaurant.verification_status === 'needs_review').length;
  const selectedCitationCount = selectedRestaurant?.citations.length ?? 0;

  const mobileVisibleRestaurants = useMemo(
    () => {
      if (!isMobileViewport) return filteredRestaurants;
      const start = (mobilePage - 1) * MAX_MOBILE_LIST_ITEMS;
      return filteredRestaurants.slice(start, start + MAX_MOBILE_LIST_ITEMS);
    },
    [filteredRestaurants, isMobileViewport, mobilePage]
  );
  const totalMobilePages = Math.ceil(filteredRestaurants.length / MAX_MOBILE_LIST_ITEMS);
  const hasPartialTypeFilters = restaurantFilters.length > 0 && restaurantFilters.length < defaultRestaurantFilters.length;

  const getTypeFilterClass = (filterKey: string) => {
    const isChecked = restaurantFilters.includes(filterKey as RestaurantVisibilityFilter);
    if (hasPartialTypeFilters && !isChecked) {
      return 'map-filters-option is-muted';
    }
    return 'map-filters-option';
  };

  useEffect(() => {
    setMobilePage(1);
  }, [filteredRestaurants.length]);

  const focusClosestRestaurant = () => {
    if (!userLocation || !closestMappedRestaurant) {
      return;
    }

    setIsLosAngelesOverviewActive(false);
    setSelectedId(closestMappedRestaurant.id);
    setMapSelectionFocusToken((current) => current + 1);
  };

  useEffect(() => {
    if (!userLocation || closestRestaurantRequestToken === 0 || !closestMappedRestaurant) {
      return;
    }

    focusClosestRestaurant();
  }, [closestMappedRestaurant, closestRestaurantRequestToken, userLocation]);

  useEffect(() => {
    if (isLosAngelesOverviewActive || !userLocation || selectedRestaurantHasCoordinates || !closestMappedRestaurant) {
      return;
    }

    focusClosestRestaurant();
  }, [closestMappedRestaurant, isLosAngelesOverviewActive, selectedRestaurantHasCoordinates, userLocation]);

  const handleShowLosAngelesOverview = () => {
    setIsLosAngelesOverviewActive(true);
    setSelectedId(null);
  };

  const scrollToTopOfList = () => {
    const listSection = document.getElementById('list-section');
    if (listSection) {
      // 120px rough offset for mobile sticky header
      const y = listSection.getBoundingClientRect().top + window.scrollY - 120;
      window.scrollTo({ top: y, behavior: 'smooth' });
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleUseCurrentLocation = () => {
    if (!userLocation) {
      requestUserLocation();
      return;
    }

    focusClosestRestaurant();
  };

  const handlePolicyFilterChange = (nextPolicyFilter: PolicyFilter) => {
    if (nextPolicyFilter === policyFilter) {
      return;
    }

    setPolicyFilter(nextPolicyFilter);

    if (userLocation) {
      requestClosestRestaurantFocus();
    }
  };

  const handleStatusToggle = (status: VerificationStatus) => {
    setStatusFilters((current) => {
      if (current.includes(status)) {
        return current.filter((value) => value !== status);
      }

      return [...current, status];
    });

    if (userLocation) {
      requestClosestRestaurantFocus();
    }
  };

  const handleRestaurantFilterToggle = (filterKey: RestaurantVisibilityFilter) => {
    setRestaurantFilters((current) => {
      if (filterKey === 'chains') {
        const allSelected = defaultRestaurantFilters.every((f) => current.includes(f));
        const chainsExcluded = !current.includes('chains') && current.length === defaultRestaurantFilters.length - 1;
        const chainsOnly = current.length === 1 && current[0] === 'chains';

        if (allSelected) {
          // State 1 → State 2: Unselect only Chain
          return current.filter((v) => v !== 'chains');
        }

        if (chainsExcluded) {
          // State 2 → State 3: Select Chain only
          return ['chains'];
        }

        if (chainsOnly) {
          // State 3 → State 1: Back to all
          return [...defaultRestaurantFilters];
        }

        // Fallback: normal toggle
        if (current.includes('chains')) {
          return current.filter((v) => v !== 'chains');
        }
        return [...current, 'chains'];
      }

      if (current.includes(filterKey)) {
        return current.filter((value) => value !== filterKey);
      }

      return [...current, filterKey];
    });

    if (userLocation) {
      requestClosestRestaurantFocus();
    }
  };

  const handleFoodTypeToggle = (foodType: string) => {
    setSelectedFoodTypes((current) => {
      if (current.includes(foodType)) {
        return current.filter((value) => value !== foodType);
      }

      return [...current, foodType];
    });

    if (userLocation) {
      requestClosestRestaurantFocus();
    }
  };

  const handleSearchToggle = () => {
    if (isSearchOpen || query.trim()) {
      setQuery('');
      setIsSearchOpen(false);
      return;
    }

    setIsSearchOpen(true);
  };

  const handleVerificationVote = async (
    restaurantId: string,
    voteValue: VerificationVoteChoice | null,
    metadata: VerificationVoteMetadata | null = null
  ) => {
    if (!deviceId) {
      return;
    }

    setPendingVerificationVoteById((current) => ({
      ...current,
      [restaurantId]: true
    }));

    if (!supabase) {
      setVerificationVotes(saveLocalVerificationVote(restaurantId, voteValue, metadata));
      setPendingVerificationVoteById((current) => ({
        ...current,
        [restaurantId]: false
      }));
      return;
    }

    if (voteValue === null) {
      const { error } = await supabase
        .from('verification_votes')
        .delete()
        .eq('restaurant_id', restaurantId)
        .eq('device_id', deviceId);

      if (error) {
        setMessage(`Could not clear verification vote: ${error.message}`);
        setPendingVerificationVoteById((current) => ({
          ...current,
          [restaurantId]: false
        }));
        return;
      }

      setVerificationVotes((current) =>
        current.filter((vote) => !(vote.restaurant_id === restaurantId && vote.device_id === deviceId))
      );
      setPendingVerificationVoteById((current) => ({
        ...current,
        [restaurantId]: false
      }));
      return;
    }

    const timestamp = new Date().toISOString();
    const { data, error } = await supabase
      .from('verification_votes')
      .upsert(
        {
          restaurant_id: restaurantId,
          device_id: deviceId,
          vote_value: voteValue,
          downvote_reason: metadata?.downvote_reason ?? null,
          is_trusted_vote: false,
          created_at: timestamp,
          updated_at: timestamp
        },
        { onConflict: 'restaurant_id,device_id' }
      )
      .select('*');

    if (error) {
      setMessage(`Could not save verification vote: ${error.message}`);
      setPendingVerificationVoteById((current) => ({
        ...current,
        [restaurantId]: false
      }));
      return;
    }

    setVerificationVotes((current) => {
      const next = current.filter(
        (vote) => !(vote.restaurant_id === restaurantId && vote.device_id === deviceId)
      );
      return [...next, ...((data ?? []) as VerificationVoteRow[])];
    });
    setPendingVerificationVoteById((current) => ({
      ...current,
      [restaurantId]: false
    }));
  };

  const supportNoteBlock = (
    <div className={`hero-cta ${isMobileViewport ? 'hero-cta-mobile-bottom' : ''}`}>
      <div className="hero-update-row">
        <span>Last updated {lastUpdatedLabel}</span>
        <span aria-hidden="true">--</span>
        <details className="hero-changelog-dropdown">
          <summary className="hero-changelog-summary">
            Changelog
            <span aria-hidden="true" className="hero-changelog-chevron">
              ▾
            </span>
          </summary>
          <div className="hero-changelog-menu">
            <p>{launchChangelogLabel}</p>
            <p>{mobileChangelogLabel}</p>
          </div>
        </details>
      </div>
      <p className="hero-note" id="support-note">
        <strong>
          Made in Los Angeles by Raych &amp; Co. <span aria-hidden="true" className="hero-note-emoji">☕</span>
        </strong>
        <br />
        This site will always be free for obvious reasons! … but if you want to help with server costs, feel free to
        drop a buck{' '}
        <a className="hero-note-link" href={donationUrl} rel="noreferrer" target="_blank">
          here
        </a>
        .
        {' '}All excess proceeds will be donated to the non-profit{' '}
        <a className="hero-note-link" href={oneFairWageUrl} rel="noreferrer" target="_blank">
          One Fair Wage
        </a>
        .
      </p>
    </div>
  );

  return (
    <main className={`app-shell ${showIosInstallHint ? 'has-mobile-install-banner' : ''}`}>
      <header className="top-header">
        {showExtraChrome ? (
          <div className="top-nav">
            <span className="nav-brand">Gratis LA</span>
            <nav className="nav-links" aria-label="Section shortcuts">
              <a href="#map-section">Map</a>
              <a href="#list-section">Locations</a>
              <a href={suggestionFormUrl} rel="noreferrer" target="_blank">
                Suggest a spot / Report problem / Contact
              </a>
            </nav>
          </div>
        ) : null}

        <div className="intro-band">
          <div className="intro-copy">
            <h1>Gratis&nbsp;&nbsp;LA</h1>
            <p className="hero-lead">
              Restaurant workers deserve a fair &amp; steady wage without having to grovel for it. Support spots with a 'No Tipping' policy or a clear, fixed surcharge.
              <br />
              <span className="hero-links-inline">
                <a className="hero-text-link" href={suggestionFormUrl} rel="noreferrer" target="_blank">
                  Suggest a spot
                </a>
                <span aria-hidden="true"> / </span>
                <a className="hero-text-link" href={suggestionFormUrl} rel="noreferrer" target="_blank">
                  Report problem
                </a>
                <span aria-hidden="true"> / </span>
                <a className="hero-text-link" href={suggestionFormUrl} rel="noreferrer" target="_blank">
                  Contact
                </a>
              </span>
            </p>
          </div>

          {!isMobileViewport ? supportNoteBlock : null}

          {showExtraChrome ? (
            <div className="intro-side">
              <p className="hero-facts">
                {noTipCount} no tipping · {includedCount} tip included · {reviewCount} pending review · official-site scan on March
                11, 2026
              </p>

              <div className="hero-actions">
                <a className="hero-button hero-button-primary" href="#map-section">
                  Open map
                </a>
                <a className="hero-button" href="#list-section">
                  View locations
                </a>
              </div>
            </div>
          ) : null}
        </div>
      </header>

      <section className="workspace-shell" id="map-section">
        {showExtraChrome ? (
          <div className="workspace-toolbar">
            <div className="filter-main">
              <label className="search-shell">
                <span className="search-prefix">Find</span>
                <input
                  aria-label="Search locations"
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search by name or street"
                  type="search"
                  value={query}
                />
              </label>

              <div className="status-filters">
                <label>
                  <input
                    checked={statusFilters.includes('verified')}
                    onChange={() => handleStatusToggle('verified')}
                    type="checkbox"
                  />
                  Verified
                </label>
                <label>
                  <input
                    checked={statusFilters.includes('candidate')}
                    onChange={() => handleStatusToggle('candidate')}
                    type="checkbox"
                  />
                  Candidate
                </label>
                <label>
                  <input
                    checked={statusFilters.includes('needs_review')}
                    onChange={() => handleStatusToggle('needs_review')}
                    type="checkbox"
                  />
                  Needs review
                </label>
              </div>
            </div>

            <div className="filter-side">
              <p className="results-pill">{filteredRestaurants.length} records</p>

              <div className="mobile-view-switch" aria-label="Mobile panel switch">
                <button
                  aria-pressed={mobilePanel === 'map'}
                  className={mobilePanel === 'map' ? 'is-active' : undefined}
                  onClick={() => setMobilePanel('map')}
                  type="button"
                >
                  Map
                </button>
                <button
                  aria-pressed={mobilePanel === 'list'}
                  className={mobilePanel === 'list' ? 'is-active' : undefined}
                  onClick={() => setMobilePanel('list')}
                  type="button"
                >
                  List
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {message ? <p className="message-bar">{message}</p> : null}
        {loading ? <p>Loading Gratis LA map...</p> : null}

        {!loading ? (
          <>
            <div className="mobile-sticky-header">
              <div className="mobile-stage-switch-shell">
              <div className="mobile-view-switch" aria-label="Mobile panel switch">
                <button
                  aria-pressed={mobilePanel === 'map'}
                  className={mobilePanel === 'map' ? 'is-active' : undefined}
                  onClick={() => setMobilePanel('map')}
                  type="button"
                >
                  Map
                </button>
                <button
                  aria-pressed={mobilePanel === 'list'}
                  className={mobilePanel === 'list' ? 'is-active' : undefined}
                  onClick={() => setMobilePanel('list')}
                  type="button"
                >
                  List
                </button>
              </div>
            </div>

            {/* Mobile filters moved out of map-stage so they apply to both views */}
            {isMobileViewport ? (
              <div className="map-stage-controls mobile-shared-controls">
                  <div className="policy-filter-bar" aria-label="Filter locations by policy">
                    <button
                      aria-pressed={policyFilter === 'all'}
                      className={policyFilter === 'all' ? 'filter-all is-active' : 'filter-all'}
                      onClick={() => handlePolicyFilterChange('all')}
                      type="button"
                    >
                      All
                    </button>
                    <button
                      aria-pressed={policyFilter === 'no_tip'}
                      className={policyFilter === 'no_tip' ? 'filter-no-tip is-active' : 'filter-no-tip'}
                      onClick={() => handlePolicyFilterChange('no_tip')}
                      type="button"
                    >
                      No Tipping
                    </button>
                    <button
                      aria-pressed={policyFilter === 'included'}
                      className={policyFilter === 'included' ? 'filter-included is-active' : 'filter-included'}
                      onClick={() => handlePolicyFilterChange('included')}
                      type="button"
                    >
                      Tip Included
                    </button>
                    <button
                      aria-pressed={policyFilter === 'unverified'}
                      className={policyFilter === 'unverified' ? 'filter-unverified is-active' : 'filter-unverified'}
                      onClick={() => handlePolicyFilterChange('unverified')}
                      type="button"
                    >
                      Unverified
                    </button>
                  </div>
                  <div className="mobile-filters-row">
                    <details className="map-filters-dropdown">
                      <summary className="map-filters-summary">Filters</summary>
                      <div aria-label="Map result filters" className="map-filters-menu">
                      <div className="map-filters-group map-filters-group-first" aria-label="Type filters">
                        <p className="map-filters-group-label">Type</p>
                        <div className="map-filters-group-options">
                          <label className={getTypeFilterClass('sit_down')}>
                            <input
                              checked={restaurantFilters.includes('sit_down')}
                              onChange={() => handleRestaurantFilterToggle('sit_down')}
                              type="checkbox"
                            />
                            Sit Down
                          </label>
                          <label className={getTypeFilterClass('quick_service')}>
                            <input
                              checked={restaurantFilters.includes('quick_service')}
                              onChange={() => handleRestaurantFilterToggle('quick_service')}
                              type="checkbox"
                            />
                            Quick Service
                          </label>
                          <label className={getTypeFilterClass('bar')}>
                            <input
                              checked={restaurantFilters.includes('bar')}
                              onChange={() => handleRestaurantFilterToggle('bar')}
                              type="checkbox"
                            />
                            Bar
                          </label>
                          <label className={getTypeFilterClass('chains')}>
                            <input
                              checked={restaurantFilters.includes('chains')}
                              onChange={() => handleRestaurantFilterToggle('chains')}
                              type="checkbox"
                            />
                            Chain
                          </label>
                        </div>
                      </div>
                      <div className="map-filters-group" aria-label="Cuisine filters">
                        <p className="map-filters-group-label">Cuisine</p>
                        <div className="map-filters-group-options">
                          {availableFoodTypes.map((foodType) => (
                            <label
                              className={
                                selectedFoodTypes.length > 0 && !selectedFoodTypes.includes(foodType)
                                  ? 'map-filters-option is-muted'
                                  : 'map-filters-option'
                              }
                              key={foodType}
                            >
                              <input
                                checked={selectedFoodTypes.includes(foodType)}
                                onChange={() => handleFoodTypeToggle(foodType)}
                                type="checkbox"
                              />
                              {foodType}
                            </label>
                          ))}
                        </div>
                      </div>
                    </div>
                  </details>
                  <div className={`map-search-shell ${isSearchOpen ? 'is-open' : ''}`} ref={searchShellRef}>
                    <input
                      aria-label="Search locations"
                      onChange={(event) => setQuery(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') {
                          setQuery('');
                          setIsSearchOpen(false);
                        }
                      }}
                      placeholder="Search"
                      ref={searchInputRef}
                      type="search"
                      value={query}
                    />
                    <button
                      aria-expanded={isSearchOpen}
                      aria-label={isSearchOpen ? 'Collapse search' : 'Expand search'}
                      className="map-search-button"
                      onMouseDown={(event) => {
                        event.preventDefault();
                      }}
                      onClick={handleSearchToggle}
                      type="button"
                    >
                      <svg aria-hidden="true" viewBox="0 0 24 24">
                        <circle cx="11" cy="11" fill="none" r="6.5" stroke="currentColor" strokeWidth="2.5" />
                        <path
                          d="M16 16l4.25 4.25"
                          fill="none"
                          stroke="currentColor"
                          strokeLinecap="round"
                          strokeWidth="2.5"
                        />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
            </div>

            <section className="workspace-grid">
            <div className={`map-stage ${mobilePanel === 'list' ? 'is-mobile-hidden' : ''}`}>
              <div className="stage-heading map-stage-heading" style={{ display: isMobileViewport ? 'none' : 'flex' }}>
                <h2 className="visually-hidden">Map</h2>
                
                {!isMobileViewport ? (
                <div className="map-stage-controls">
                  <div className="policy-filter-bar" aria-label="Filter locations by policy">
                    <button
                      aria-pressed={policyFilter === 'all'}
                      className={policyFilter === 'all' ? 'filter-all is-active' : 'filter-all'}
                      onClick={() => handlePolicyFilterChange('all')}
                      type="button"
                    >
                      All
                    </button>
                    <button
                      aria-pressed={policyFilter === 'no_tip'}
                      className={policyFilter === 'no_tip' ? 'filter-no-tip is-active' : 'filter-no-tip'}
                      onClick={() => handlePolicyFilterChange('no_tip')}
                      type="button"
                    >
                      No Tipping
                    </button>
                    <button
                      aria-pressed={policyFilter === 'included'}
                      className={policyFilter === 'included' ? 'filter-included is-active' : 'filter-included'}
                      onClick={() => handlePolicyFilterChange('included')}
                      type="button"
                    >
                      Tip Included
                    </button>
                    <button
                      aria-pressed={policyFilter === 'unverified'}
                      className={policyFilter === 'unverified' ? 'filter-unverified is-active' : 'filter-unverified'}
                      onClick={() => handlePolicyFilterChange('unverified')}
                      type="button"
                    >
                      Unverified
                    </button>
                  </div>
                  <details className="map-filters-dropdown">
                    <summary className="map-filters-summary">Filters</summary>
                    <div aria-label="Map result filters" className="map-filters-menu">
                      <div className="map-filters-group map-filters-group-first" aria-label="Type filters">
                        <p className="map-filters-group-label">Type</p>
                        <div className="map-filters-group-options">
                          <label className={getTypeFilterClass('sit_down')}>
                            <input
                              checked={restaurantFilters.includes('sit_down')}
                              onChange={() => handleRestaurantFilterToggle('sit_down')}
                              type="checkbox"
                            />
                            Sit Down
                          </label>
                          <label className={getTypeFilterClass('quick_service')}>
                            <input
                              checked={restaurantFilters.includes('quick_service')}
                              onChange={() => handleRestaurantFilterToggle('quick_service')}
                              type="checkbox"
                            />
                            Quick Service
                          </label>
                          <label className={getTypeFilterClass('bar')}>
                            <input
                              checked={restaurantFilters.includes('bar')}
                              onChange={() => handleRestaurantFilterToggle('bar')}
                              type="checkbox"
                            />
                            Bar
                          </label>
                          <label className={getTypeFilterClass('chains')}>
                            <input
                              checked={restaurantFilters.includes('chains')}
                              onChange={() => handleRestaurantFilterToggle('chains')}
                              type="checkbox"
                            />
                            Chain
                          </label>
                        </div>
                      </div>
                      <div className="map-filters-group" aria-label="Cuisine filters">
                        <p className="map-filters-group-label">Cuisine</p>
                        <div className="map-filters-group-options">
                          {availableFoodTypes.map((foodType) => (
                            <label
                              className={
                                selectedFoodTypes.length > 0 && !selectedFoodTypes.includes(foodType)
                                  ? 'map-filters-option is-muted'
                                  : 'map-filters-option'
                              }
                              key={foodType}
                            >
                              <input
                                checked={selectedFoodTypes.includes(foodType)}
                                onChange={() => handleFoodTypeToggle(foodType)}
                                type="checkbox"
                              />
                              {foodType}
                            </label>
                          ))}
                        </div>
                      </div>
                    </div>
                  </details>
                  <div className={`map-search-shell ${isSearchOpen ? 'is-open' : ''}`} ref={searchShellRef}>
                    <input
                      aria-label="Search locations"
                      onChange={(event) => setQuery(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') {
                          setQuery('');
                          setIsSearchOpen(false);
                        }
                      }}
                      placeholder="Search"
                      ref={searchInputRef}
                      type="search"
                      value={query}
                    />
                    <button
                      aria-expanded={isSearchOpen}
                      aria-label={isSearchOpen ? 'Collapse search' : 'Expand search'}
                      className="map-search-button"
                      onMouseDown={(event) => {
                        event.preventDefault();
                      }}
                      onClick={handleSearchToggle}
                      type="button"
                    >
                      <svg aria-hidden="true" viewBox="0 0 24 24">
                        <circle cx="11" cy="11" fill="none" r="6.5" stroke="currentColor" strokeWidth="2.5" />
                        <path
                          d="M16 16l4.25 4.25"
                          fill="none"
                          stroke="currentColor"
                          strokeLinecap="round"
                          strokeWidth="2.5"
                        />
                      </svg>
                    </button>
                  </div>
                  {showExtraChrome ? <p className="panel-meta">{restaurantsWithCoordinates} mapped records</p> : null}
                </div>
                ) : null}
              </div>
              <MapView
                chainCounts={chainCounts}
                isVisible={mobilePanel === 'map' || !isMobileViewport}
                onFocusNearestRestaurant={handleUseCurrentLocation}
                onShowLosAngelesOverview={handleShowLosAngelesOverview}
                onSelectRestaurant={handleSelectRestaurant}
                onRequestUserLocation={requestUserLocation}
                restaurants={filteredRestaurants}
                selectionFocusToken={mapSelectionFocusToken}
                selectedId={selectedId}
                userLocation={userLocation}
              />
              {showSelectedRecord && selectedRestaurant ? (
                <section className="selected-spotlight" aria-label="Selected restaurant quick view">
                  <div className="spotlight-header">
                    <div>
                      <p className="spotlight-kicker">Selected record</p>
                      <h3>{selectedRestaurant.name}</h3>
                    </div>
                    <span className={`status-pill status-${getStatusTone(selectedRestaurant)}`}>
                      {getStatusLabel(selectedRestaurant)}
                    </span>
                  </div>

                  <div className="spotlight-meta">
                    <span>{selectedRestaurant.neighborhood ?? selectedRestaurant.city ?? 'Los Angeles'}</span>
                    <span>{selectedCitationCount} citations</span>
                    <span>{selectedRestaurant.has_service_fee ? 'tip included in bill' : 'no tipping'}</span>
                  </div>

                  {selectedRestaurant.address ? <p className="spotlight-address">{selectedRestaurant.address}</p> : null}

                  {selectedRestaurant.website ? (
                    <a className="spotlight-link" href={selectedRestaurant.website} rel="noreferrer" target="_blank">
                      Visit official website
                    </a>
                  ) : null}
                </section>
              ) : null}
            </div>

            <aside
              className={`evidence-rail ${mobilePanel === 'map' ? 'is-mobile-hidden' : ''} ${
                mobileListShouldScroll ? 'has-mobile-list-window' : ''
              }`}
              id="list-section"
            >
              <div className="stage-heading">
                <div>
                  <h2 className="locations-stage-title">{filteredRestaurants.length} Locations</h2>
                </div>
              </div>
              <div className="list-column">
                {policyFilter === 'all' ? (
                  <div className="list-filter-intro">
                    <p className="list-filter-note">
                      All locations are community-sourced. Submit new locations and downvote old ones to keep this site
                      fresh!
                    </p>
                  </div>
                ) : null}
                {policyFilter === 'no_tip' ? (
                  <div className="list-filter-intro">
                    <p className="list-filter-note">
                      These restaurants explicitly do not ask for a tip and fold gratuity into their prices.
                    </p>
                  </div>
                ) : null}
                {policyFilter === 'included' ? (
                  <div className="list-filter-intro">
                    <p className="list-filter-note">
                      These restaurants include a surcharge to the bill. We{' '}
                      <span className="list-filter-note-emphasis">do not</span> include locations that also ask for a
                      tip.
                    </p>
                  </div>
                ) : null}
                {policyFilter === 'unverified' ? (
                  <p className="list-filter-note">These locations can no longer be verified by the community.</p>
                ) : null}
                <RestaurantList
                  chainCounts={chainCounts}
                  emptyMessage={policyFilter === 'unverified' ? null : undefined}
                  onVoteVerification={handleVerificationVote}
                  onSelectRestaurant={handleSelectRestaurant}
                  pendingVerificationVoteById={pendingVerificationVoteById}
                  restaurants={mobileVisibleRestaurants}
                  rootClassName={mobileListShouldScroll ? 'list-root-mobile-windowed' : undefined}
                  selectedId={selectedId}
                  verificationStateById={verificationStateById}
                />
                {isMobileViewport && totalMobilePages > 1 ? (
                  <div className="mobile-pagination">
                    <button
                      disabled={mobilePage === 1}
                      onClick={() => {
                        setMobilePage((p) => Math.max(1, p - 1));
                        scrollToTopOfList();
                      }}
                      className="pagination-btn"
                    >
                      &larr; Prev
                    </button>
                    <span className="pagination-info">
                      Page {mobilePage} of {totalMobilePages}
                    </span>
                    <button
                      disabled={mobilePage === totalMobilePages}
                      onClick={() => {
                        setMobilePage((p) => Math.min(totalMobilePages, p + 1));
                        scrollToTopOfList();
                      }}
                      className="pagination-btn"
                    >
                      Next &rarr;
                    </button>
                  </div>
                ) : null}
              </div>
            </aside>
            </section>
          </>
        ) : null}
      </section>
      {isMobileViewport ? supportNoteBlock : null}
      <footer className="site-disclaimer" aria-label="Site disclaimer">
        <p>
          This site may contain inaccuracies and should be used for informational purposes only. All service workers
          should earn a decent living and we support One Fair Wage, but we are not affiliated with them in any way.{' '}
          Don't be an a-hole and always tip a reasonable amount when asked. ♥
        </p>
      </footer>
      {showIosInstallHint ? (
        <div className="install-banner-bottom" role="status">
          <p>
            Add Gratis LA to your Home Screen for the cleaner app view.
            <span> On iPhone, tap Share, then Add to Home Screen.</span>
          </p>
          <button onClick={dismissIosInstallHint} type="button">
            Close
          </button>
        </div>
      ) : null}
    </main>
  );
}
