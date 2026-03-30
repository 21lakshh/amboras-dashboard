import { redirect } from "next/navigation"
import { unstable_noStore as noStore } from "next/cache"

import Dashboard from "@/components/Dashboard"
import { fetchDashboardSnapshot } from "@/lib/analytics-api"
import type { DashboardSnapshot } from "@/lib/analytics-types"
import { createSupabaseServerClient } from "@/lib/supabase/server"

export default async function Home() {
  noStore()

  const supabase = await createSupabaseServerClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session) {
    redirect("/login")
  }

  let initialSnapshot: DashboardSnapshot | null = null
  let initialError: string | null = null

  try {
    initialSnapshot = await fetchDashboardSnapshot(session.access_token)
  } catch (error) {
    initialError = error instanceof Error ? error.message : "Unable to load analytics."
  }

  return (
    <Dashboard
      initialError={initialError}
      initialSnapshot={initialSnapshot}
      userEmail={session.user.email ?? "Store owner"}
    />
  )
}
