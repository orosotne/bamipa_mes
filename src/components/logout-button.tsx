"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export function LogoutButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function odhlasit() {
    startTransition(async () => {
      await createSupabaseBrowserClient().auth.signOut();
      router.push("/login");
      router.refresh();
    });
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      className="w-full justify-start text-muted-foreground"
      onClick={odhlasit}
      disabled={pending}
    >
      <LogOut className="h-4 w-4" />
      {pending ? "Odhlasujem…" : "Odhlásiť"}
    </Button>
  );
}
