"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

export function TlacButton() {
  return (
    <Button onClick={() => window.print()}>
      <Printer className="h-4 w-4" />
      Tlačiť
    </Button>
  );
}
