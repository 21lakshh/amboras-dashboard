export type AnalyticsEventType =
  | "page_view"
  | "add_to_cart"
  | "remove_from_cart"
  | "checkout_started"
  | "purchase"

export interface AnalyticsOverview {
  revenue: {
    today: number
    week: number
    month: number
  }
  eventCounts: Record<AnalyticsEventType, number>
  conversionRate: number
  currency: string
  timezone: string
  asOf: string
}

export interface TopProduct {
  productId: string
  revenueCents: number
  purchaseCount: number
}

export interface RecentActivityItem {
  eventId: string
  eventType: AnalyticsEventType
  timestamp: string
  productId: string | null
  amountCents: number | null
  currency: string | null
}

export interface DashboardSnapshot {
  overview: AnalyticsOverview
  topProducts: TopProduct[]
  recentActivity: RecentActivityItem[]
}
