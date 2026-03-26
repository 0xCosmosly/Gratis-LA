import L from 'leaflet';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { RestaurantCardData } from '../types';
import { isChainRestaurant } from '../lib/chains';
import { getStatusLabel, getStatusTone } from '../lib/restaurantLabels';
import { getServiceStyleLabel } from '../lib/restaurantMetadata';
import { getRestaurantDisplayName, getRestaurantDisplayNeighborhood } from '../lib/restaurantDisplay';

const LA_CENTER: L.LatLngTuple = [34.0522, -118.2437];
const GREATER_LA_MAP_BOUNDS = L.latLngBounds([33.66, -118.93], [34.41, -117.74]);
const GREATER_LA_OVERVIEW_PADDING: L.PointTuple = [28, 28];
const GREATER_LA_OVERVIEW_ZOOM_OFFSET = 1;
const DEFAULT_FOCUS_PADDING: L.PointTuple = [72, 72];
const DEFAULT_ZOOM = 9;
const MIN_ZOOM = 8;
const USER_LOCATION_ZOOM = 14;

const markerColors: Record<string, string> = {
  no_tip: '#9CB495', // Mint/Green
  included: '#F4A261', // Orange
  unverified: '#D94848', // Red
  verified: '#9CB495',
  excluded: '#E5E1D8'
};

interface MapViewProps {
  restaurants: RestaurantCardData[];
  chainCounts: ReadonlyMap<string, number>;
  selectedId: string | null;
  onFocusNearestRestaurant?: () => void;
  onShowLosAngelesOverview?: () => void;
  onSelectRestaurant: (id: string) => void;
  onRequestUserLocation?: () => void;
  isVisible?: boolean;
  selectionFocusToken?: number;
  userLocation?: {
    lat: number;
    lng: number;
  } | null;
}

interface MarkerEntry {
  marker: L.CircleMarker;
  restaurant: RestaurantCardData;
}

function getPopupOptions(viewportWidth: number): L.PopupOptions {
  const horizontalPadding = viewportWidth <= 360 ? 18 : viewportWidth <= 475 ? 22 : 26;
  const bottomPadding = viewportWidth <= 475 ? 88 : 28;
  const popupWidth = Math.max(220, Math.min(viewportWidth - horizontalPadding * 2, viewportWidth <= 475 ? 272 : 320));

  return {
    autoPanPaddingBottomRight: [horizontalPadding, bottomPadding],
    autoPanPaddingTopLeft: [horizontalPadding, 16],
    className: 'map-leaflet-popup',
    closeButton: false,
    keepInView: false,
    maxWidth: popupWidth,
    minWidth: popupWidth,
    offset: [0, -10]
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildGoogleMapsUrl(restaurant: RestaurantCardData): string | null {
  if (!restaurant.address) {
    return null;
  }

  const query = encodeURIComponent(`${restaurant.name} ${restaurant.address}`);
  return `https://www.google.com/maps/search/?api=1&query=${query}`;
}

function getPopupPolicyLabel(restaurant: RestaurantCardData): string {
  if (restaurant.verification_status !== 'verified') {
    return 'Unverified';
  }

  if (restaurant.has_service_fee) {
    return 'Tip Included';
  }

  if (restaurant.has_no_tip_policy) {
    return 'No Tipping';
  }

  return getStatusLabel(restaurant);
}

function buildPopupContent(restaurant: RestaurantCardData, chainCounts: ReadonlyMap<string, number>): string {
  const isChain = isChainRestaurant(restaurant, chainCounts);
  const displayName = getRestaurantDisplayName(restaurant);
  const displayNeighborhood = isChain ? getRestaurantDisplayNeighborhood(restaurant) : null;
  const googleMapsUrl = buildGoogleMapsUrl(restaurant);
  const address = restaurant.address
    ? `<p>${googleMapsUrl ? `<a href="${escapeHtml(googleMapsUrl)}" rel="noreferrer" target="_blank">${escapeHtml(restaurant.address)}</a>` : escapeHtml(restaurant.address)}</p>`
    : '';
  const metadataLine = escapeHtml(
    [
      restaurant.food_type,
      getServiceStyleLabel(restaurant.service_style),
      isChainRestaurant(restaurant, chainCounts) ? 'Chain' : null
    ]
      .filter((value): value is string => Boolean(value))
      .join(', ')
  );
  const status = escapeHtml(getPopupPolicyLabel(restaurant));
  
  let statusClass = 'map-popup-status';
  const tone = getStatusTone(restaurant);
  if (tone === 'verified' || tone === 'no_tip') {
    statusClass += ' is-verified';
  } else if (tone === 'included') {
    statusClass += ' is-included';
  } else if (tone === 'unverified') {
    statusClass += ' is-unverified';
  }

  return `
    <div class="map-popup">
      <strong>${escapeHtml(displayName)}</strong>
      ${displayNeighborhood ? `<p><em>${escapeHtml(displayNeighborhood)}</em></p>` : ''}
      ${address}
      <p>${metadataLine}</p>
      <p><strong class="${statusClass}">${status}</strong></p>
    </div>
  `;
}

function focusMapOnUserLocation(map: L.Map, userLocation: { lat: number; lng: number }) {
  map.flyTo([userLocation.lat, userLocation.lng], USER_LOCATION_ZOOM, { duration: 0.8 });
}

function getLosAngelesOverviewZoom(map: L.Map) {
  const overviewPadding = L.point(...GREATER_LA_OVERVIEW_PADDING);
  const fittedZoom = map.getBoundsZoom(GREATER_LA_MAP_BOUNDS, false, overviewPadding);
  const isMobile = typeof window !== 'undefined' && window.innerWidth <= 1024;
  const zoomOffset = isMobile ? GREATER_LA_OVERVIEW_ZOOM_OFFSET + 1 : GREATER_LA_OVERVIEW_ZOOM_OFFSET;
  return Math.max(MIN_ZOOM, fittedZoom + zoomOffset);
}

function focusMapOnLosAngelesOverview(map: L.Map, animate = false) {
  const overviewCenter = GREATER_LA_MAP_BOUNDS.getCenter();
  const overviewZoom = getLosAngelesOverviewZoom(map);

  if (animate) {
    map.flyTo(overviewCenter, overviewZoom, { duration: 0.8 });
    return;
  }

  map.setView(overviewCenter, overviewZoom);
}

function focusMapOnUserAndRestaurant(
  map: L.Map,
  userLocation: { lat: number; lng: number } | null,
  restaurant: RestaurantCardData
) {
  if (!userLocation) {
    map.setView([restaurant.lat as number, restaurant.lng as number], DEFAULT_ZOOM);
    return;
  }

  const bounds = L.latLngBounds(
    [userLocation.lat, userLocation.lng],
    [restaurant.lat as number, restaurant.lng as number]
  );

  if (bounds.getSouthWest().equals(bounds.getNorthEast())) {
    focusMapOnUserLocation(map, userLocation);
    return;
  }

  map.flyToBounds(bounds, {
    maxZoom: USER_LOCATION_ZOOM,
    padding: DEFAULT_FOCUS_PADDING,
    duration: 0.8
  });
}

export function MapView({
  restaurants,
  chainCounts,
  selectedId,
  onFocusNearestRestaurant,
  onShowLosAngelesOverview,
  onSelectRestaurant,
  onRequestUserLocation,
  isVisible = true,
  selectionFocusToken = 0,
  userLocation = null
}: MapViewProps) {
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<MarkerEntry[]>([]);
  const userMarkerRef = useRef<L.Marker | null>(null);
  const userHaloRef = useRef<L.Marker | null>(null);
  const lastSelectionFocusTokenRef = useRef<number>(selectionFocusToken);
  const lastSelectedRestaurantIdRef = useRef<string | null>(selectedId);
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window === 'undefined' ? 1440 : window.innerWidth
  );

  const visibleRestaurants = useMemo(
    () => restaurants.filter((restaurant) => restaurant.lat !== null && restaurant.lng !== null),
    [restaurants]
  );

  const selectedRestaurant = visibleRestaurants.find((restaurant) => restaurant.id === selectedId) ?? null;
  const popupOptions = useMemo(() => getPopupOptions(viewportWidth), [viewportWidth]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const handleResize = () => {
      setViewportWidth(window.innerWidth);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handleFocusUserLocation = () => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    if (userLocation) {
      const currentZoom = map.getZoom();
      const currentCenter = map.getCenter();
      const dist = currentCenter.distanceTo([userLocation.lat, userLocation.lng]);
      
      // If we're already zoomed in close to the user, zoom out to fit all visible markers
      if (currentZoom >= USER_LOCATION_ZOOM - 1 && dist < 1000) {
        onShowLosAngelesOverview?.();
        focusMapOnLosAngelesOverview(map, true);
        return;
      }
    }

    if (onFocusNearestRestaurant) {
      onFocusNearestRestaurant();
      return;
    }

    if (!userLocation) {
      onRequestUserLocation?.();
      return;
    }

    map.flyTo([userLocation.lat, userLocation.lng], USER_LOCATION_ZOOM, { duration: 0.8 });
  };

  const handleZoomIn = () => {
    mapRef.current?.zoomIn();
  };

  const handleZoomOut = () => {
    mapRef.current?.zoomOut();
  };

  useEffect(() => {
    if (!mapElementRef.current || mapRef.current) {
      return;
    }

    const map = L.map(mapElementRef.current, {
      center: LA_CENTER,
      dragging: true,
      minZoom: MIN_ZOOM,
      scrollWheelZoom: false,
      touchZoom: true,
      zoom: DEFAULT_ZOOM,
      zoomControl: false,
      attributionControl: false
    });

    L.control.attribution({
      position: 'bottomleft',
      prefix: '<a href="https://leafletjs.com" rel="noreferrer" target="_blank">Leaflet</a>'
    }).addTo(map);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      attribution:
        '<a href="https://www.openstreetmap.org/copyright" rel="noreferrer" target="_blank">OpenStreetMap</a> | <a href="https://carto.com/attributions" rel="noreferrer" target="_blank">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 20
    }).addTo(map);

    focusMapOnLosAngelesOverview(map);

    mapRef.current = map;

    return () => {
      markersRef.current.forEach(({ marker }) => marker.remove());
      markersRef.current = [];
      userMarkerRef.current?.remove();
      userMarkerRef.current = null;
      userHaloRef.current?.remove();
      userHaloRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isVisible) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      map.invalidateSize();
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [isVisible, selectedId, userLocation, visibleRestaurants.length]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    userMarkerRef.current?.remove();
    userMarkerRef.current = null;
    userHaloRef.current?.remove();
    userHaloRef.current = null;

    if (!userLocation) {
      return;
    }

    const marker = L.marker([userLocation.lat, userLocation.lng], {
      icon: L.divIcon({
        className: 'user-location-marker-shell',
        html: '<div class="user-location-halo"></div><div class="user-location-dot"></div>',
        iconSize: [28, 28],
        iconAnchor: [14, 14]
      })
    });

    marker.addTo(map);
    userMarkerRef.current = marker;

    const updateScale = () => {
      const zoom = map.getZoom();
      const el = marker.getElement();
      if (el) {
        if (zoom >= 15) {
          el.classList.add('is-zoomed-in');
        } else {
          el.classList.remove('is-zoomed-in');
        }
      }
    };

    map.on('zoomend', updateScale);
    updateScale(); // initial check

    return () => {
      map.off('zoomend', updateScale);
    };
  }, [userLocation]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    markersRef.current.forEach(({ marker }) => marker.remove());

    markersRef.current = visibleRestaurants.map((restaurant) => {
      const isSelected = restaurant.id === selectedId;
      const isUnverified = getStatusTone(restaurant) === 'unverified';
      const marker = L.circleMarker([restaurant.lat as number, restaurant.lng as number], {
        color: isUnverified && !isSelected ? '#FFFFFF' : '#2A2825',
        fillColor: markerColors[getStatusTone(restaurant)] ?? '#E5E1D8',
        fillOpacity: 1,
        radius: 7,
        weight: 2,
        dashArray: isUnverified && !isSelected ? '2, 2' : undefined
      });

      marker.addTo(map);
      marker.bindPopup(buildPopupContent(restaurant, chainCounts), popupOptions);
      marker.on('click', () => onSelectRestaurant(restaurant.id));

      return { marker, restaurant };
    });

    

    if (visibleRestaurants.length === 0) {
      map.closePopup();
      return;
    }

    if (!selectedRestaurant) {
      map.closePopup();
      return;
    }

    const selectedEntry = markersRef.current.find(({ restaurant }) => restaurant.id === selectedRestaurant.id);
    if (!selectedEntry) {
      map.closePopup();
      return;
    }

    const openSelectedPopup = () => {
      selectedEntry.marker.openPopup();
      selectedEntry.marker.getPopup()?.update();
    };

    const hasNewSelectionFocusRequest = selectionFocusToken !== lastSelectionFocusTokenRef.current;
    const hasSelectedRestaurantChanged = selectedRestaurant.id !== lastSelectedRestaurantIdRef.current;
    lastSelectionFocusTokenRef.current = selectionFocusToken;
    lastSelectedRestaurantIdRef.current = selectedRestaurant.id;

    if (hasNewSelectionFocusRequest) {
      map.closePopup();
      map.once('moveend', openSelectedPopup);
      focusMapOnUserAndRestaurant(map, userLocation, selectedRestaurant);
    } else if (hasSelectedRestaurantChanged) {
      map.closePopup();
      const targetLatLng: L.LatLngTuple = [selectedRestaurant.lat as number, selectedRestaurant.lng as number];
      const currentZoom = map.getZoom() ?? DEFAULT_ZOOM;
      const nextZoom = currentZoom < DEFAULT_ZOOM ? DEFAULT_ZOOM : currentZoom;
      map.once('moveend', openSelectedPopup);
      map.setView(targetLatLng, nextZoom, { animate: false });
    } else if (map.getZoom() < 10) {
      map.once('moveend', openSelectedPopup);
      const targetLatLng: L.LatLngTuple = [selectedRestaurant.lat as number, selectedRestaurant.lng as number];
      map.flyTo(targetLatLng, USER_LOCATION_ZOOM, { duration: 0.8 });
    } else {
      window.requestAnimationFrame(openSelectedPopup);
    }

    return () => {
      map.off('moveend', openSelectedPopup);
    };
  }, [
    chainCounts,
    onSelectRestaurant,
    popupOptions,
    selectedId,
    selectedRestaurant,
    selectionFocusToken,
    userLocation,
    visibleRestaurants
  ]);

  return (
    <div className="map-root-shell">
      <div className="map-root" ref={mapElementRef} />
      <div className="map-control-cluster">
        <div aria-label="Map zoom controls" className="map-zoom-buttons">
          <button aria-label="Zoom in" className="map-control-button" onClick={handleZoomIn} type="button">
            +
          </button>
          <button aria-label="Zoom out" className="map-control-button" onClick={handleZoomOut} type="button">
            -
          </button>
        </div>

        <button
          aria-label={userLocation ? 'Focus on current location' : 'Use current location'}
          className="map-control-button map-location-button"
          onClick={handleFocusUserLocation}
          type="button"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path
              d="M12 3v3m0 12v3M3 12h3m12 0h3M12 8a4 4 0 1 0 0 8a4 4 0 0 0 0-8Z"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.8"
            />
          </svg>
        </button>
      </div>
      {visibleRestaurants.length === 0 ? (
        <div className="map-overlay">
          <p className="map-placeholder-kicker">No mapped results</p>
          <p>No visible listings currently include coordinates.</p>
        </div>
      ) : null}
    </div>
  );
}
