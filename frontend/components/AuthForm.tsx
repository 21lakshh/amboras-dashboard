"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { type FormEvent, useState, useTransition } from "react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { bootstrapOwnerProfile } from "@/lib/auth-api"
import { createSupabaseBrowserClient } from "@/lib/supabase/client"

interface AuthFormProps {
  mode: "login" | "signup"
}

export function AuthForm({ mode }: AuthFormProps) {
  const router = useRouter()
  const supabase = createSupabaseBrowserClient()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [errorMessage, setErrorMessage] = useState("")
  const [successMessage, setSuccessMessage] = useState("")
  const [isPending, startTransition] = useTransition()

  const title = mode === "login" ? "Welcome back" : "Create your Amboras account"
  const description =
    mode === "login"
      ? "Sign in to monitor your store performance in real time."
      : "Start managing revenue, conversions, and live store activity."

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setErrorMessage("")
    setSuccessMessage("")

    startTransition(async () => {
      const response =
        mode === "login"
          ? await supabase.auth.signInWithPassword({
              email,
              password,
            })
          : await supabase.auth.signUp({
              email,
              password,
            })

      if (response.error) {
        setErrorMessage(response.error.message)
        return
      }

      if (mode === "signup" && !response.data.session) {
        setSuccessMessage("Your account was created. Confirm your email, then sign in.")
        return
      }

      if (response.data.session?.access_token) {
        try {
          await bootstrapOwnerProfile(response.data.session.access_token)
        } catch (error) {
          setErrorMessage(error instanceof Error ? error.message : "We could not finish setting up your store.")
          return
        }
      }

      router.replace("/")
      router.refresh()
    })
  }

  return (
    <Card className="border-white/60 bg-white/90 shadow-2xl shadow-slate-200/60 backdrop-blur">
      <CardHeader className="space-y-3">
        <CardTitle className="text-3xl text-slate-950">{title}</CardTitle>
        <CardDescription className="text-base text-slate-600">{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700" htmlFor="email">
              Email
            </label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="owner@yourstore.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700" htmlFor="password">
              Password
            </label>
            <Input
              id="password"
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              placeholder="Minimum 6 characters"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              minLength={6}
              required
            />
          </div>

          {errorMessage ? <p className="text-sm text-rose-600">{errorMessage}</p> : null}
          {successMessage ? <p className="text-sm text-emerald-600">{successMessage}</p> : null}

          <Button className="h-11 w-full rounded-xl" disabled={isPending} type="submit">
            {isPending ? "Please wait..." : mode === "login" ? "Sign in" : "Create account"}
          </Button>
        </form>

        <p className="mt-6 text-sm text-slate-600">
          {mode === "login" ? "New to Amboras?" : "Already have an account?"}{" "}
          <Link
            className="font-medium text-slate-950 underline decoration-slate-300 underline-offset-4"
            href={mode === "login" ? "/signup" : "/login"}
          >
            {mode === "login" ? "Create an account" : "Sign in"}
          </Link>
        </p>
      </CardContent>
    </Card>
  )
}
