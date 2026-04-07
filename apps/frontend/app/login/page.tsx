import { redirect } from "next/navigation"

import { AuthForm } from "@/components/AuthForm"
import { createSupabaseServerClient } from "@/lib/supabase/server"

export default async function LoginPage() {
  const supabase = await createSupabaseServerClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (session) {
    redirect("/")
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(14,165,233,0.2),_transparent_45%),linear-gradient(180deg,_#f8fafc_0%,_#e2e8f0_100%)] px-4 py-10">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-6xl items-center gap-12 lg:grid lg:grid-cols-[1.1fr_0.9fr]">
        <section className="hidden lg:block">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-sky-700">
            Amboras Analytics
          </p>
          <h1 className="mt-6 max-w-xl text-5xl font-semibold leading-tight text-slate-950">
            Real-time visibility for every store you launch.
          </h1>
          <p className="mt-6 max-w-xl text-lg text-slate-600">
            Track revenue, conversion trends, top products, and recent activity from a single
            storefront command center.
          </p>
        </section>
        <div className="w-full max-w-md justify-self-end">
          <AuthForm mode="login" />
        </div>
      </div>
    </main>
  )
}
