import type {
  AnalyticsOverview,
  DashboardSnapshot,
  RecentActivityItem,
  TopProduct,
} from "@/lib/analytics-types"

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL

function getApiBaseUrl() {
  if (!API_BASE_URL) {
    throw new Error("NEXT_PUBLIC_API_BASE_URL is not configured.")
  }

  return API_BASE_URL.replace(/\/$/, "")
}

async function fetchAnalytics<T>(path: string, token: string): Promise<T> {
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    cache: "no-store",
  })

  if (!response.ok) {
    const message = await response.text()
    throw new Error(message || `Request failed with status ${response.status}`)
  }

  return (await response.json()) as T
}

export async function fetchDashboardSnapshot(token: string): Promise<DashboardSnapshot> {
  const [overview, topProducts, recentActivity] = await Promise.all([
    fetchAnalytics<AnalyticsOverview>("/api/v1/analytics/overview", token),
    fetchAnalytics<TopProduct[]>("/api/v1/analytics/top-products", token),
    fetchAnalytics<RecentActivityItem[]>("/api/v1/analytics/recent-activity", token),
  ])

  return {
    overview,
    topProducts,
    recentActivity,
  }
}

export async function fetchLiveSnapshot(token: string) {
  const [overview, topProducts, recentActivity] = await Promise.all([
    fetchAnalytics<AnalyticsOverview>("/api/v1/analytics/overview", token),
    fetchAnalytics<TopProduct[]>("/api/v1/analytics/top-products", token),
    fetchAnalytics<RecentActivityItem[]>("/api/v1/analytics/recent-activity", token),
  ])

  return {
    overview,
    topProducts,
    recentActivity,
  }
}
