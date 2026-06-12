"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// PROTOTYPE ONLY: demo credentials are prefilled so product managers can
// walk straight in. Remove before any real restaurant goes live.
const DEMO_EMAIL = "owner@acsoulfood.test";
const DEMO_PASSWORD = "acsoul-da36ea3b";

export default function DashboardLogin() {
  const router = useRouter();
  const [email, setEmail] = useState(DEMO_EMAIL);
  const [password, setPassword] = useState(DEMO_PASSWORD);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function signIn(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError(error.message);
      setBusy(false);
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
      <form
        onSubmit={signIn}
        className="w-full max-w-sm rounded-xl border border-black/10 bg-white p-6 shadow-sm"
      >
        <h1 className="text-xl font-bold">OrderStack</h1>
        <p className="mb-4 text-sm text-gray-500">Restaurant dashboard sign-in</p>
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          <span className="font-bold">Prototype demo</span> — credentials are
          prefilled. Just hit{" "}
          <span className="font-semibold">Enter the demo dashboard</span>.
        </div>
        <input
          className="mb-3 w-full rounded-md border border-black/15 p-3 text-sm"
          type="email"
          placeholder="Email"
          value={email}
          autoComplete="username"
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          className="mb-4 w-full rounded-md border border-black/15 p-3 text-sm"
          type="password"
          placeholder="Password"
          value={password}
          autoComplete="current-password"
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && (
          <p className="mb-3 rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>
        )}
        <button
          disabled={busy || !email || !password}
          className="w-full rounded-md bg-gray-900 px-4 py-3 font-semibold text-white disabled:opacity-40"
        >
          {busy ? "Signing in…" : "Enter the demo dashboard →"}
        </button>
      </form>
    </main>
  );
}
