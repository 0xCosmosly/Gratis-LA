import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { RestaurantCardData } from '../types';
import { getStatusLabel, getStatusTone } from '../lib/restaurantLabels';
import { isChainRestaurant } from '../lib/chains';
import { getServiceStyleLabel } from '../lib/restaurantMetadata';
import { getRestaurantDisplayName, getRestaurantDisplayNeighborhood } from '../lib/restaurantDisplay';
import type { RestaurantVerificationState, VerificationVoteChoice, VerificationVoteMetadata } from '../types';

interface RestaurantListProps {
  chainCounts: ReadonlyMap<string, number>;
  emptyMessage?: string | null;
  onVoteVerification: (
    restaurantId: string,
    voteValue: VerificationVoteChoice | null,
    metadata?: VerificationVoteMetadata | null
  ) => void;
  restaurants: RestaurantCardData[];
  pendingVerificationVoteById: Record<string, boolean>;
  rootClassName?: string;
  selectedId: string | null;
  onSelectRestaurant: (id: string) => void;
  verificationStateById: ReadonlyMap<string, RestaurantVerificationState>;
}

interface DownvotePopoverPosition {
  left: number;
  top: number;
}

function getDownvotePopoverPosition(trigger: HTMLButtonElement): DownvotePopoverPosition {
  const rect = trigger.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const popoverWidth = Math.min(512, viewportWidth - 32);
  const left = Math.min(rect.right + 12, viewportWidth - popoverWidth - 16);
  const top = Math.max(16, Math.min(rect.top, viewportHeight - 420));

  return {
    left: Math.max(16, left),
    top
  };
}

function buildGoogleMapsUrl(restaurant: RestaurantCardData): string | null {
  if (!restaurant.address) {
    return null;
  }

  const query = encodeURIComponent(`${restaurant.name} ${restaurant.address}`);
  return `https://www.google.com/maps/search/?api=1&query=${query}`;
}

function formatDisplayDate(value: string | null): string {
  if (!value) {
    return 'Unknown';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleDateString();
}

function getMostRecentDate(values: Array<string | null | undefined>): string | null {
  const datedValues = values
    .filter((value): value is string => Boolean(value))
    .map((value) => ({
      value,
      timestamp: new Date(value).getTime()
    }))
    .filter((entry) => !Number.isNaN(entry.timestamp))
    .sort((a, b) => b.timestamp - a.timestamp);

  return datedValues[0]?.value ?? null;
}

function getRestaurantLastUpdatedAt(
  restaurant: Pick<RestaurantCardData, 'citations' | 'last_checked_at' | 'created_at'>
): string | null {
  return getMostRecentDate([
    ...restaurant.citations.map((citation) => citation.published_at),
    ...restaurant.citations.map((citation) => citation.checked_at),
    restaurant.last_checked_at,
    restaurant.created_at
  ]);
}

function extractNoteTags(note: string): { message: string; tags: string[] } {
  const tags: string[] = [];
  let remaining = note.trim();

  while (true) {
    const match = remaining.match(/^\[([^\]]+)\]\s*/);

    if (!match) {
      break;
    }

    tags.push(match[1].trim());
    remaining = remaining.slice(match[0].length).trimStart();
  }

  return {
    message: remaining,
    tags
  };
}

function formatDirectQuote(value: string): string {
  const normalizedValue = value.trim().replace(/\s+/g, ' ').replace(/^["']+|["']+$/g, '');
  return `"${normalizedValue}"`;
}

function getPreferredCitationQuote(
  restaurant: Pick<RestaurantCardData, 'citations' | 'has_no_tip_policy' | 'has_service_fee'>
): string | null {
  const citationsWithExcerpt = restaurant.citations.filter((citation) => Boolean(citation.excerpt?.trim()));

  if (citationsWithExcerpt.length === 0) {
    return null;
  }

  const matchingCitation =
    citationsWithExcerpt.find((citation) => {
      if (restaurant.has_service_fee && citation.indicates_service_fee) {
        return true;
      }

      if (restaurant.has_no_tip_policy && citation.indicates_no_tip) {
        return true;
      }

      return false;
    }) ?? citationsWithExcerpt[0];

  return matchingCitation?.excerpt ? formatDirectQuote(matchingCitation.excerpt) : null;
}

function getVerificationDisplay(
  restaurant: Pick<RestaurantCardData, 'citations' | 'verification_notes' | 'has_no_tip_policy' | 'has_service_fee'>
): { message: string; attribution: string | null; tags: string[] } | null {
  const notes = restaurant.verification_notes?.trim();
  const citationQuote = getPreferredCitationQuote(restaurant);

  if (!notes && !citationQuote) {
    return null;
  }

  const cleanedNotes = notes ?? '';
  const parsedNote = extractNoteTags(cleanedNotes);

  if (citationQuote) {
    return {
      message: citationQuote,
      attribution: null,
      tags: parsedNote.tags
    };
  }

  return {
    message: parsedNote.message,
    attribution: null,
    tags: parsedNote.tags
  };
}

function ThumbShape({ direction }: { direction: 'up' | 'down' }) {
  const paths =
    direction === 'up'
      ? [
          'M22 10c0-1.1-.9-2-2-2h-6l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L13 1 6.59 7.41C6.22 7.78 6 8.3 6 8.83V19c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z',
          'M2 21h3V9H2v12z'
        ]
      : [
          'M15 3H6c-.83 0-1.54.5-1.84 1.22L1.14 11.27c-.09.23-.14.47-.14.73v2c0 1.1.9 2 2 2h6l-.95 4.57-.03.32c0 .41.17.79.44 1.06L10 23l6.41-6.41c.37-.37.59-.89.59-1.42V5c0-1.1-.9-2-2-2z',
          'M19 3h3v12h-3V3z'
        ];

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      {paths.map((path) => (
        <path d={path} key={path} />
      ))}
    </svg>
  );
}

export function RestaurantList({
  chainCounts,
  emptyMessage = 'No qualifying locations are loaded yet.',
  onVoteVerification,
  pendingVerificationVoteById,
  restaurants,
  rootClassName,
  selectedId,
  onSelectRestaurant,
  verificationStateById
}: RestaurantListProps) {
  const [openDownvoteRestaurantId, setOpenDownvoteRestaurantId] = useState<string | null>(null);
  const [downvoteDraftById, setDownvoteDraftById] = useState<Record<string, string>>({});
  const [downvotePopoverPosition, setDownvotePopoverPosition] = useState<DownvotePopoverPosition | null>(null);
  const [scrollbarMetrics, setScrollbarMetrics] = useState({ isVisible: false, offset: 0, thumbHeight: 0 });
  const scrollRootRef = useRef<HTMLDivElement | null>(null);

  const activeDownvoteRestaurant =
    restaurants.find((restaurant) => restaurant.id === openDownvoteRestaurantId) ?? null;
  const activeDownvoteReason = activeDownvoteRestaurant ? downvoteDraftById[activeDownvoteRestaurant.id] ?? '' : '';
  const activeDownvotePending = activeDownvoteRestaurant
    ? pendingVerificationVoteById[activeDownvoteRestaurant.id] ?? false
    : false;

  useEffect(() => {
    const element = scrollRootRef.current;
    if (!element) return;

    const updateScrollbar = () => {
      const { clientHeight, scrollHeight, scrollTop } = element;
      if (scrollHeight <= clientHeight + 1 || clientHeight === 0) {
        setScrollbarMetrics({ isVisible: false, offset: 0, thumbHeight: 0 });
        return;
      }

      const thumbHeight = Math.max(40, (clientHeight / scrollHeight) * clientHeight);
      const maxOffset = clientHeight - thumbHeight;
      const maxScrollTop = scrollHeight - clientHeight;
      const offset = maxScrollTop <= 0 ? 0 : (scrollTop / maxScrollTop) * maxOffset;

      setScrollbarMetrics({ isVisible: true, offset, thumbHeight });
    };

    const resizeObserver = new ResizeObserver(updateScrollbar);
    resizeObserver.observe(element);
    element.addEventListener('scroll', updateScrollbar, { passive: true });
    updateScrollbar();

    return () => {
      resizeObserver.disconnect();
      element.removeEventListener('scroll', updateScrollbar);
    };
  }, [restaurants]);

  if (restaurants.length === 0) {
    return emptyMessage ? <p className="empty-message">{emptyMessage}</p> : null;
  }

  return (
    <div className="list-panel">
      <div className={rootClassName ? `list-root ${rootClassName}` : 'list-root'} ref={scrollRootRef}>
        {restaurants.map((restaurant) => (
          <article
            className={`restaurant-card ${selectedId === restaurant.id ? 'is-selected' : ''}`}
            key={restaurant.id}
            onClick={() => onSelectRestaurant(restaurant.id)}
            onKeyUp={(event) => {
              if (event.key === 'Enter') {
                onSelectRestaurant(restaurant.id);
              }
            }}
            role="button"
            tabIndex={0}
          >
            {(() => {
              const googleMapsUrl = buildGoogleMapsUrl(restaurant);
              const statusTone = getStatusTone(restaurant);
              const verificationDisplay = getVerificationDisplay(restaurant);
              const verificationState = verificationStateById.get(restaurant.id) ?? null;
              const isChain = isChainRestaurant(restaurant, chainCounts);
              const isVotePending = pendingVerificationVoteById[restaurant.id] ?? false;
              const verifiedPercentage = Math.round(
                (verificationState?.verifiedShare ?? (verificationState?.effectiveStatus === 'verified' ? 1 : 0)) * 100
              );
              const serviceStyleLabel = getServiceStyleLabel(restaurant.service_style);
              const displayName = getRestaurantDisplayName(restaurant);
              const displayNeighborhood = isChain ? getRestaurantDisplayNeighborhood(restaurant) : null;
              const displayedVote =
                verificationState?.userVote ??
                ((verificationState?.verifiedShare === null || verificationState?.verifiedShare === 1) &&
                  verificationState?.effectiveStatus === 'verified'
                  ? 'verified'
                  : null);

              return (
                <>
                  <header className="restaurant-header">
                    <div className="restaurant-title-block">
                      <h3>{displayName}</h3>
                      {displayNeighborhood ? <p className="restaurant-subtitle">{displayNeighborhood}</p> : null}
                    </div>
                    <span className={`status-pill status-${statusTone}`}>{getStatusLabel(restaurant)}</span>
                  </header>

                  {googleMapsUrl ? (
                    <p className="restaurant-address">
                      <a href={googleMapsUrl} rel="noreferrer" target="_blank" onClick={(e) => e.stopPropagation()}>
                        {restaurant.address ?? 'Open in Google Maps'}
                      </a>
                    </p>
                  ) : null}

                  {verificationDisplay ? (
                    <p className="notes-text">
                      {verificationDisplay.tags.length ? (
                        <span className="notes-tags">
                          {verificationDisplay.tags.map((tag) => (
                            <span className="note-tag" key={tag}>
                              {tag}
                            </span>
                          ))}
                        </span>
                      ) : null}
                      {verificationDisplay.message}
                      {verificationDisplay.attribution ? (
                        <span className="notes-attribution">{verificationDisplay.attribution}</span>
                      ) : null}
                    </p>
                  ) : null}

                  {verificationState?.showVotingControls ? (
                    <div className="verification-controls-shell">
                      <div className="verification-controls" aria-label="Community verification">
                        <div className="verification-buttons">
                          <button
                            aria-label="Mark as verified"
                            className={
                              displayedVote === 'verified'
                                ? 'verification-button vote-verified is-active'
                                : 'verification-button vote-verified'
                            }
                            disabled={isVotePending}
                            onClick={(event) => {
                              event.stopPropagation();
                              setOpenDownvoteRestaurantId((current) => (current === restaurant.id ? null : current));
                              onVoteVerification(restaurant.id, verificationState?.userVote === 'verified' ? null : 'verified');
                            }}
                            type="button"
                          >
                            <ThumbShape direction="up" />
                          </button>
                          <button
                            aria-label="Mark as unverified"
                            className={
                              displayedVote === 'unverified'
                                ? 'verification-button vote-unverified is-active'
                                : 'verification-button vote-unverified'
                            }
                            disabled={isVotePending}
                            onClick={(event) => {
                              event.stopPropagation();
                              if (verificationState?.userVote === 'unverified') {
                                setOpenDownvoteRestaurantId((current) => (current === restaurant.id ? null : current));
                                setDownvotePopoverPosition(null);
                                onVoteVerification(restaurant.id, null);
                                return;
                              }

                              setDownvotePopoverPosition(getDownvotePopoverPosition(event.currentTarget));
                              setOpenDownvoteRestaurantId((current) => (current === restaurant.id ? null : restaurant.id));
                            }}
                            type="button"
                          >
                            <ThumbShape direction="down" />
                          </button>
                        </div>
                        <span className="verification-controls-label">{verifiedPercentage}% Verified</span>
                      </div>
                    </div>
                  ) : null}

                  <h4>Sources</h4>
                  <ul className="citation-list">
                    <li>
                      <a 
                        href={restaurant.yelp_url || `https://www.yelp.com/search?find_desc=${encodeURIComponent(restaurant.name)}&find_loc=Los+Angeles%2C+CA`} 
                        rel="noreferrer" 
                        target="_blank"
                        onClick={(e) => e.stopPropagation()}
                      >
                        Yelp Page
                      </a>
                    </li>
                    {restaurant.citations.map((citation) => (
                      <li key={citation.id}>
                        <a href={citation.source_url} rel="noreferrer" target="_blank" onClick={(e) => e.stopPropagation()}>
                          {citation.source_name}
                        </a>
                      </li>
                    ))}
                  </ul>

                  {isChain || restaurant.food_type ? (
                    <div className="card-tags" aria-label="Location tags">
                      {restaurant.food_type ? <span className="note-tag">{restaurant.food_type}</span> : null}
                      <span className="note-tag">{serviceStyleLabel}</span>
                      {isChain ? <span className="note-tag">Chain</span> : null}
                    </div>
                  ) : null}

                  <p className="last-updated">
                    Last updated: {formatDisplayDate(getRestaurantLastUpdatedAt(restaurant))}
                    {' • '}
                    Last checked: {restaurant.last_checked_at ? formatDisplayDate(restaurant.last_checked_at) : 'Not checked yet'}
                  </p>
                </>
              );
            })()}
          </article>
        ))}
      </div>

      {scrollbarMetrics.isVisible && (
        <div className="list-scrollbar-overlay" aria-hidden="true">
          <div 
            className="list-scrollbar-thumb"
            style={{
              height: `${scrollbarMetrics.thumbHeight}px`,
              transform: `translateY(${scrollbarMetrics.offset}px)`
            }}
          />
        </div>
      )}

      {activeDownvoteRestaurant && typeof document !== 'undefined'
        ? createPortal(
            <div
              className="verification-overlay"
              onClick={() => {
                setOpenDownvoteRestaurantId(null);
                setDownvotePopoverPosition(null);
              }}
            >
              <div
                className="verification-popover"
                onClick={(event) => event.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-labelledby={`downvote-title-${activeDownvoteRestaurant.id}`}
                style={
                  downvotePopoverPosition
                    ? {
                        left: `${downvotePopoverPosition.left}px`,
                        top: `${downvotePopoverPosition.top}px`
                      }
                    : undefined
                }
              >
                <div className="verification-popover-header">
                  <h4 id={`downvote-title-${activeDownvoteRestaurant.id}`}>Is this inaccurate?</h4>
                  <button
                    aria-label="Close report form"
                    className="verification-popover-close"
                    onClick={() => {
                      setOpenDownvoteRestaurantId(null);
                      setDownvotePopoverPosition(null);
                    }}
                    type="button"
                  >
                    ×
                  </button>
                </div>
                <textarea
                  id={`downvote-reason-${activeDownvoteRestaurant.id}`}
                  onChange={(event) =>
                    setDownvoteDraftById((current) => ({
                      ...current,
                      [activeDownvoteRestaurant.id]: event.target.value
                    }))
                  }
                  placeholder="Tell us why and we'll review the listing. Include your name if you'd like credit. :)"
                  rows={5}
                  value={activeDownvoteReason}
                />
                <div className="verification-popover-actions">
                  <button
                    className="verification-popover-button verification-popover-button-primary"
                    disabled={activeDownvotePending}
                    onClick={() => {
                      onVoteVerification(activeDownvoteRestaurant.id, 'unverified', {
                        downvote_reason: activeDownvoteReason.trim() || null
                      });
                      setOpenDownvoteRestaurantId(null);
                      setDownvotePopoverPosition(null);
                    }}
                    type="button"
                  >
                    Submit downvote
                  </button>
                  <button
                    className="verification-popover-button"
                    disabled={activeDownvotePending}
                    onClick={() => {
                      setOpenDownvoteRestaurantId(null);
                      setDownvotePopoverPosition(null);
                    }}
                    type="button"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
