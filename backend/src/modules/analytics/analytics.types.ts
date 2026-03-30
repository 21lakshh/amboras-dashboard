import type { StoreContext } from '../auth/auth.types';

export const ANALYTICS_EVENT_TYPES = [
  'page_view',
  'add_to_cart',
  'remove_from_cart',
  'checkout_started',
  'purchase',
] as const;

export type AnalyticsEventType = (typeof ANALYTICS_EVENT_TYPES)[number];

export interface AnalyticsIngestPayload {
  event_id: string;
  store_id: string;
  event_type: AnalyticsEventType;
  timestamp: string;
  data?: {
    product_id?: string;
    amount?: number;
    currency?: string;
  };
}

export interface NormalizedAnalyticsEvent {
  eventId: string;
  storeId: string;
  eventType: AnalyticsEventType;
  timestamp: string;
  productId: string | null;
  amountCents: number | null;
  currency: string | null;
  rawData: Record<string, unknown>;
}

export interface AnalyticsOverviewResponse {
  revenue: {
    today: number;
    week: number;
    month: number;
  };
  eventCounts: Record<AnalyticsEventType, number>;
  conversionRate: number;
  currency: string;
  timezone: string;
  asOf: string;
}

export interface TopProductResponse {
  productId: string;
  revenueCents: number;
  purchaseCount: number;
}

export interface RecentActivityResponse {
  eventId: string;
  eventType: AnalyticsEventType;
  timestamp: string;
  productId: string | null;
  amountCents: number | null;
  currency: string | null;
}

export interface AnalyticsSnapshot {
  overview: AnalyticsOverviewResponse;
  topProducts: TopProductResponse[];
  recentActivity: RecentActivityResponse[];
}

export interface PersistedAnalyticsEvent extends NormalizedAnalyticsEvent {
  storeContext: Pick<StoreContext, 'currency' | 'timezone' | 'storeId'>;
}
