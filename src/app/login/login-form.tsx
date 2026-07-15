"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [heslo, setHeslo] = useState("");
  const [chyba, setChyba] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function prihlasit() {
    setChyba(null);
    if (!email.trim() || !heslo) {
      setChyba("Zadaj email aj heslo.");
      return;
    }
    startTransition(async () => {
      const { error } = await createSupabaseBrowserClient().auth.signInWithPassword({
        email: email.trim(),
        password: heslo,
      });
      if (error) {
        setChyba("Nesprávny email alebo heslo.");
        return;
      }
      router.push("/");
      router.refresh();
    });
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 pt-6">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            className="h-11"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && prihlasit()}
            autoFocus
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="heslo">Heslo</Label>
          <Input
            id="heslo"
            type="password"
            autoComplete="current-password"
            className="h-11"
            value={heslo}
            onChange={(e) => setHeslo(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && prihlasit()}
          />
        </div>
        {chyba && <p className="text-sm font-medium text-red-600">{chyba}</p>}
        <Button
          size="lg"
          className="h-11"
          disabled={pending}
          onClick={prihlasit}
        >
          {pending ? "Prihlasujem…" : "Prihlásiť sa"}
        </Button>
      </CardContent>
    </Card>
  );
}
