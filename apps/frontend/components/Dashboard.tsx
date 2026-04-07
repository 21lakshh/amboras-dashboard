"use client"

import { useEffect, useEffectEvent, useMemo, useState, useTransition } from "react"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { io, type Socket } from "socket.io-client"
import {
  BarChart3,
  Bell,
  ChevronDown,
  LoaderCircle,
  LogOut,
  Menu,
  RefreshCcw,
  ShoppingBag,
  ShoppingCart,
  TrendingUp,
  Wallet,
} from "lucide-react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useToast } from "@/hooks/use-toast"
import { Toaster } from "@/components/ui/toaster"
import { fetchDashboardSnapshot, fetchLiveSnapshot } from "@/lib/analytics-api"
import type { DashboardSnapshot, RecentActivityItem } from "@/lib/analytics-types"
import { createSupabaseBrowserClient } from "@/lib/supabase/client"

interface DashboardProps {
  initialSnapshot: DashboardSnapshot | null
  initialError: string | null
  userEmail: string
}

const EVENT_LABELS = {
  page_view: "Page Views",
  add_to_cart: "Add to Cart",
  remove_from_cart: "Remove from Cart",
  checkout_started: "Checkout Started",
  purchase: "Purchases",
}

const EVENT_COLORS = ["#3B82F6", "#10B981", "#F59E0B", "#8B5CF6", "#EF4444"]

function formatCurrency(amountCents: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amountCents / 100)
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value))
}

function getEventBadgeVariant(eventType: RecentActivityItem["eventType"]) {
  switch (eventType) {
    case "purchase":
      return "success"
    case "checkout_started":
      return "warning"
    default:
      return "secondary"
  }
}

function buildRevenueTrend(snapshot: DashboardSnapshot | null) {
  const revenue = snapshot?.overview.revenue ?? { today: 0, week: 0, month: 0 }

  return [
    { label: "Today", value: Math.round(revenue.today / 100) },
    { label: "Week", value: Math.round(revenue.week / 100) },
    { label: "Month", value: Math.round(revenue.month / 100) },
  ]
}

function buildFunnelData(snapshot: DashboardSnapshot | null) {
  const eventCounts = snapshot?.overview.eventCounts
  if (!eventCounts) return []

  const views = eventCounts.page_view || 0
  const cart = eventCounts.add_to_cart || 0
  const checkout = eventCounts.checkout_started || 0
  const purchase = eventCounts.purchase || 0

  return [
    { label: "Page Views", count: views, percentage: 100, color: "#3B82F6" },
    { label: "Add to Cart", count: cart, percentage: views > 0 ? Math.round((cart / views) * 100) : 0, color: "#10B981" },
    { label: "Checkout", count: checkout, percentage: cart > 0 ? Math.round((checkout / cart) * 100) : 0, color: "#F59E0B" },
    { label: "Purchase", count: purchase, percentage: checkout > 0 ? Math.round((purchase / checkout) * 100) : 0, color: "#8B5CF6" },
  ]
}

// Top products uses generic sorting at render step now

function MetricCard({
  icon,
  label,
  value,
  description,
  action,
}: {
  icon: React.ReactNode
  label: string
  value: string
  description: string
  action?: React.ReactNode
}) {
  return (
    <Card className="relative overflow-hidden w-full">
      {action && <div className="absolute top-2 right-2">{action}</div>}
      <CardContent className="p-4 flex flex-row items-center h-full w-full">
        <div className="bg-blue-50 p-3 rounded-full mr-4 text-blue-600 shrink-0">{icon}</div>
        <div className="flex-1 min-w-0 pr-8 overflow-hidden">
          <p className="text-sm text-gray-500 truncate">{label}</p>
          <h3 className="text-2xl font-bold truncate">{value}</h3>
          <p className="text-xs text-gray-500 truncate">{description}</p>
        </div>
      </CardContent>
    </Card>
  )
}

export default function Dashboard({ initialSnapshot, initialError, userEmail }: DashboardProps) {
  const router = useRouter()
  const supabase = createSupabaseBrowserClient()
  const { toast } = useToast()
  const [isMobile, setIsMobile] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [revenuePeriod, setRevenuePeriod] = useState<"today" | "week" | "month">("today")
  const [topProductMetric, setTopProductMetric] = useState<"revenue" | "purchases">("revenue")
  const [liveSnapshot, setLiveSnapshot] = useState(initialSnapshot)
  const [chartSnapshot, setChartSnapshot] = useState(initialSnapshot)
  const [errorMessage, setErrorMessage] = useState(initialError)
  const [refreshState, setRefreshState] = useState<"idle" | "syncing">("idle")
  const [isManualRefreshPending, startManualRefresh] = useTransition()
  const [isSigningOut, startSignOut] = useTransition()
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? ""

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768)
    }

    handleResize()
    window.addEventListener("resize", handleResize)

    return () => {
      window.removeEventListener("resize", handleResize)
    }
  }, [])

  const runLiveRefresh = useEffectEvent(async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession()

    if (!session?.access_token) {
      return
    }

    setRefreshState("syncing")

    try {
      const nextSnapshot = await fetchLiveSnapshot(session.access_token)
      const mergedSnapshot = {
        overview: nextSnapshot.overview,
        recentActivity: nextSnapshot.recentActivity,
        topProducts: nextSnapshot.topProducts,
      }
      setLiveSnapshot(mergedSnapshot)
      setChartSnapshot(mergedSnapshot)
      setErrorMessage(null)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Live refresh failed.")
    } finally {
      setRefreshState("idle")
    }
  })

  useEffect(() => {
    let socket: Socket | undefined
    let isMounted = true

    async function connectSocket() {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!isMounted || !session?.access_token) {
        return
      }

      if (!apiBaseUrl) {
        setErrorMessage("NEXT_PUBLIC_API_BASE_URL is not configured.")
        return
      }

      socket = io(`${apiBaseUrl}/analytics`, {
        transports: ["websocket"],
        auth: {
          token: session.access_token,
        },
      })

      socket.on("analytics.updated", async () => {
        await runLiveRefresh()
      })

      socket.on("connect_error", (error) => {
        setErrorMessage(error.message || "Realtime connection failed.")
      })
    }

    void connectSocket()

    return () => {
      isMounted = false
      socket?.disconnect()
    }
  }, [apiBaseUrl, runLiveRefresh, supabase])

  async function handleManualRefresh() {
    startManualRefresh(async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!session?.access_token) {
        router.replace("/login")
        return
      }

      setRefreshState("syncing")

      try {
        const nextSnapshot = await fetchDashboardSnapshot(session.access_token)
        setLiveSnapshot(nextSnapshot)
        setChartSnapshot(nextSnapshot)
        setErrorMessage(null)
        toast({
          title: "Dashboard refreshed",
          description: "Charts and top products were recomputed from the latest cache.",
        })
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "Refresh failed.")
      } finally {
        setRefreshState("idle")
      }
    })
  }

  function handleSignOut() {
    startSignOut(async () => {
      await supabase.auth.signOut()
      router.replace("/login")
      router.refresh()
    })
  }

  const currency = liveSnapshot?.overview.currency ?? "USD"
  const revenue = liveSnapshot?.overview.revenue ?? { today: 0, week: 0, month: 0 }
  const conversionRate = liveSnapshot?.overview.conversionRate ?? 0
  const revenueTrend = useMemo(() => buildRevenueTrend(chartSnapshot), [chartSnapshot])
  const funnelData = useMemo(() => buildFunnelData(chartSnapshot), [chartSnapshot])
  const topProductChart = useMemo(() => {
    if (!chartSnapshot) return []
    const sorted = [...chartSnapshot.topProducts]
    if (topProductMetric === "revenue") {
      sorted.sort((a, b) => b.revenueCents - a.revenueCents)
    } else {
      sorted.sort((a, b) => b.purchaseCount - a.purchaseCount)
    }
    return sorted.slice(0, 10).map((product) => ({
      name: product.productId.split("-").join(" ") || "Unknown",
      revenue: Math.round(product.revenueCents / 100),
      purchases: product.purchaseCount,
    }))
  }, [chartSnapshot, topProductMetric])

  const recentActivity = liveSnapshot?.recentActivity ?? []
  
  const purchasesCount = liveSnapshot?.overview.eventCounts?.purchase ?? 0
  const checkoutCount = liveSnapshot?.overview.eventCounts?.checkout_started ?? 0
  const currentTotalRevenue = revenue[revenuePeriod]
  const aov = purchasesCount > 0 ? currentTotalRevenue / purchasesCount : 0
  const abandonmentRate = checkoutCount > 0 ? (1 - purchasesCount / checkoutCount) * 100 : 0

  const storeName = userEmail.split("@")[0] || "Amboras"
  const asOf = liveSnapshot?.overview.asOf ? formatDateTime(liveSnapshot.overview.asOf) : "Awaiting data"

  return (
    <div className="flex h-screen bg-gray-100">
      <Toaster />

      {isMobile && (
        <Button
          variant="outline"
          size="icon"
          className="fixed bottom-4 right-4 z-50 rounded-full h-12 w-12 shadow-lg bg-white"
          onClick={() => setSidebarOpen(true)}
        >
          <Menu className="h-6 w-6" />
        </Button>
      )}

      <div
        className={`${isMobile ? "fixed inset-0 z-50 transform transition-transform duration-300 ease-in-out" : "w-64"} ${isMobile && !sidebarOpen ? "-translate-x-full" : "translate-x-0"} bg-white border-r border-gray-200 flex flex-col`}
      >
        {isMobile && (
          <div className="flex justify-end p-4">
            <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(false)}>
              <Menu className="h-6 w-6" />
            </Button>
          </div>
        )}
        <div className="p-6 border-b border-gray-200">
          <h1 className="text-2xl font-semibold text-purple-600">Amboras</h1>
          <p className="mt-2 text-sm text-gray-500">Store Analytics</p>
        </div>
        <div className="flex-1 py-4 overflow-y-auto">
          <nav className="space-y-1 px-2">
            <div className="flex items-center w-full px-4 py-3 text-sm font-medium rounded-r-md text-blue-600 bg-blue-50 border-l-4 border-blue-600">
              <BarChart3 className="mr-3 h-5 w-5" />
              Dashboard
            </div>
          </nav>
        </div>
        <div className="p-4 border-t border-gray-200">
          <Button variant="outline" className="w-full justify-start" onClick={handleSignOut} disabled={isSigningOut}>
            {isSigningOut ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <LogOut className="mr-2 h-4 w-4" />}
            Sign out
          </Button>
        </div>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-white border-b border-gray-200 flex items-center justify-between px-4 py-4 md:px-6">
          <div className="flex items-center">
            {isMobile && (
              <Button variant="ghost" size="icon" className="mr-2" onClick={() => setSidebarOpen(true)}>
                <Menu className="h-5 w-5" />
              </Button>
            )}
            <div>
              <h1 className="text-xl font-semibold text-gray-800">Dashboard</h1>
              <p className="text-sm text-gray-500">Revenue, conversion, top products, and realtime activity</p>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 md:p-6 bg-gray-50">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-sm text-gray-600">As of {asOf}</p>
              {errorMessage ? <p className="text-sm text-rose-600 mt-1">{errorMessage}</p> : null}
            </div>
            <Button variant="outline" size="sm" onClick={handleManualRefresh} disabled={isManualRefreshPending}>
              {isManualRefreshPending ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCcw className="mr-2 h-4 w-4" />}
              Refresh Dashboard
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6 mb-6">
            <MetricCard
              icon={
                revenuePeriod === "today" ? <Wallet className="h-6 w-6" /> :
                revenuePeriod === "week" ? <TrendingUp className="h-6 w-6" /> :
                <ShoppingBag className="h-6 w-6" />
              }
              label={`Revenue`}
              value={formatCurrency(revenue[revenuePeriod], currency)}
              description={
                revenuePeriod === "today" ? "Store-local daily revenue" :
                revenuePeriod === "week" ? "Current ISO week performance" :
                "Month-to-date sales total"
              }
              action={
                <DropdownMenu modal={false}>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-gray-500 hover:text-gray-900 border border-transparent hover:border-gray-200">
                      {revenuePeriod.charAt(0).toUpperCase() + revenuePeriod.slice(1)} <ChevronDown className="ml-1 h-3 w-3" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => setRevenuePeriod("today")}>Today</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setRevenuePeriod("week")}>Week</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setRevenuePeriod("month")}>Month</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              }
            />

            <MetricCard
              icon={<ShoppingCart className="h-6 w-6" />}
              label="Average Order Value"
              value={formatCurrency(aov, currency)}
              description={`Rev / Purchases (${revenuePeriod})`}
            />
            <MetricCard
              icon={<BarChart3 className="h-6 w-6" />}
              label="Conversion Rate"
              value={`${conversionRate.toFixed(2)}%`}
              description="Purchases divided by page views"
            />
            <MetricCard
              icon={<LogOut className="h-6 w-6" />}
              label="Checkout Abandonment"
              value={`${abandonmentRate.toFixed(2)}%`}
              description="Users who left during checkout"
            />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 md:gap-6 mb-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between p-4 pb-2">
                <div>
                  <CardTitle className="text-base font-medium">Revenue Overview</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="p-4 pt-0">
                <div className="h-[240px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={revenueTrend} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="label" axisLine={false} tickLine={false} />
                      <YAxis hide />
                      <Tooltip />
                      <Bar dataKey="value" fill="#3B82F6" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="p-4 pb-2">
                <CardTitle className="text-base font-medium">Conversion Funnel</CardTitle>
                <CardDescription>User drop-off by stage</CardDescription>
              </CardHeader>
              <CardContent className="p-4 pt-0 mt-4">
                <div className="flex flex-col space-y-6">
                  {funnelData.map((step, index) => (
                    <div key={step.label} className="relative">
                      <div className="flex justify-between text-sm mb-1">
                        <span className="font-medium text-gray-700">{step.label}</span>
                        <span className="text-gray-500">
                          {step.count} {index > 0 && `(${step.percentage}% from prev)`}
                        </span>
                      </div>
                      <div className="w-full bg-gray-100 rounded-full h-3">
                        <div
                          className="h-3 rounded-full transition-all duration-500"
                          style={{
                            width: `${funnelData[0].count > 0 ? (step.count / funnelData[0].count) * 100 : 0}%`,
                            backgroundColor: step.color,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="p-4 pb-2 flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-base font-medium">Top Products</CardTitle>
                  <CardDescription>Top 10 products tracking</CardDescription>
                </div>
                <DropdownMenu modal={false}>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-8 text-xs -mt-2">
                      By {topProductMetric === "revenue" ? "Revenue" : "Volume"} <ChevronDown className="ml-1 h-3 w-3" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => setTopProductMetric("revenue")}>By Revenue</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setTopProductMetric("purchases")}>By Volume</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </CardHeader>
              <CardContent className="p-4 pt-0">
                <div className="h-[240px] w-full mt-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={topProductChart} layout="vertical" margin={{ top: 10, right: 12, left: 12, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                      <XAxis hide type="number" />
                      <YAxis dataKey="name" tickLine={false} type="category" width={90} tick={{ fontSize: 12 }} />
                      <Tooltip />
                      <Bar dataKey={topProductMetric} fill={topProductMetric === "revenue" ? "#10B981" : "#8B5CF6"} radius={[0, 6, 6, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="p-4 pb-0">
              <CardTitle className="text-base font-medium">Recent Activity</CardTitle>
            </CardHeader>
            <CardContent className="p-4">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Event</TableHead>
                      <TableHead>Event ID</TableHead>
                      <TableHead>Product</TableHead>
                      <TableHead>Timestamp</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Revenue</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recentActivity.length ? (
                      recentActivity.map((event) => (
                        <TableRow key={event.eventId}>
                          <TableCell className="font-medium">{EVENT_LABELS[event.eventType]}</TableCell>
                          <TableCell>{event.eventId}</TableCell>
                          <TableCell>{event.productId ?? "--"}</TableCell>
                          <TableCell>{formatDateTime(event.timestamp)}</TableCell>
                          <TableCell>
                            <Badge variant={getEventBadgeVariant(event.eventType)}>
                              {event.eventType === "purchase"
                                ? "paid"
                                : event.eventType === "checkout_started"
                                  ? "checkout"
                                  : "live"}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {event.amountCents && event.currency
                              ? formatCurrency(event.amountCents, event.currency)
                              : "--"}
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={6} className="py-8 text-center text-gray-500">
                          No recent activity yet. Ingest store events and they will appear here in realtime.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </main>
      </div>
    </div>
  )
}
