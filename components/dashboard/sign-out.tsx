"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function SignOutButton() {
  const router = useRouter();
  return (
    <button
      className="text-sm text-white/70 hover:text-white hover:underline"
      onClick={async () => {
        await createClient().auth.signOut();
        router.push("/dashboard/login");
        router.refresh();
      }}
    >
      Sign out
    </button>
  );
}
