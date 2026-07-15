"use client";

import {
  FileText,
  FlaskConical,
  Layers,
  Package,
  Settings2,
  Truck,
  Warehouse,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const SEKCIE = [
  { href: "/faktury", label: "Faktúry", icon: FileText, aktivne: true },
  { href: "/dodavatelia", label: "Dodávatelia", icon: Truck, aktivne: true },
  { href: "/sklad", label: "Sklad", icon: Warehouse, aktivne: true },
  { href: "/receptury", label: "Receptúry", icon: Layers, aktivne: true },
  { href: "/vyroba", label: "Výroba", icon: Package, aktivne: true },
  { href: "/ciselniky", label: "Číselníky", icon: Settings2, aktivne: true },
  { href: "/labak", label: "Labák", icon: FlaskConical, aktivne: false },
] as const;

export function AppNav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-1">
      {SEKCIE.map(({ href, label, icon: Icon, aktivne }) =>
        aktivne ? (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              pathname.startsWith(href)
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </Link>
        ) : (
          <span
            key={href}
            title="Pripravujeme (ďalšia fáza)"
            className="flex cursor-not-allowed items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground/40"
          >
            <Icon className="h-4 w-4" />
            {label}
          </span>
        ),
      )}
    </nav>
  );
}
