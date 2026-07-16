"use client";

import {
  Calculator,
  FileText,
  FlaskConical,
  Footprints,
  Layers,
  LayoutDashboard,
  Package,
  Settings2,
  Truck,
  Users,
  Warehouse,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { UserRole } from "@/lib/enums";
import { type Modul, smieVidiet } from "@/server/rbac";
import { cn } from "@/lib/utils";

const SEKCIE: {
  href: string;
  label: string;
  icon: typeof FileText;
  modul: Modul;
}[] = [
  { href: "/", label: "Prehľad", icon: LayoutDashboard, modul: "prehlad" },
  { href: "/faktury", label: "Faktúry", icon: FileText, modul: "faktury" },
  { href: "/dodavatelia", label: "Dodávatelia", icon: Truck, modul: "dodavatelia" },
  { href: "/sklad", label: "Sklad", icon: Warehouse, modul: "sklad" },
  { href: "/receptury", label: "Receptúry", icon: Layers, modul: "receptury" },
  { href: "/vyroba", label: "Výroba", icon: Package, modul: "vyroba" },
  { href: "/labak", label: "Labák", icon: FlaskConical, modul: "labak" },
  { href: "/lisovna", label: "Lisovňa", icon: Footprints, modul: "lisovna" },
  { href: "/kalkulacie", label: "Kalkulácie", icon: Calculator, modul: "kalkulacie" },
  { href: "/ciselniky", label: "Číselníky", icon: Settings2, modul: "ciselniky" },
  { href: "/pouzivatelia", label: "Používatelia", icon: Users, modul: "pouzivatelia" },
];

export function AppNav({ role }: { role: UserRole }) {
  const pathname = usePathname();
  const sekcie = SEKCIE.filter((s) => smieVidiet(role, s.modul));

  return (
    <nav className="flex flex-col gap-1">
      {sekcie.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          className={cn(
            "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
            (href === "/" ? pathname === "/" : pathname.startsWith(href))
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          <Icon className="h-4 w-4" />
          {label}
        </Link>
      ))}
    </nav>
  );
}
