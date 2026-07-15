"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ROLY, type UserRole } from "@/lib/enums";
import {
  nastavAktivnyAction,
  vytvorPouzivatelaAction,
  zmenRoluAction,
} from "./actions";

type Pouzivatel = {
  id: string;
  displayName: string;
  email: string | null;
  role: UserRole;
  isActive: boolean;
};

const ROLE_ITEMS = Object.fromEntries(
  Object.entries(ROLY).map(([k, v]) => [k, v]),
);

export function UsersManager({
  pouzivatelia,
  currentUserId,
}: {
  pouzivatelia: Pouzivatel[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [email, setEmail] = useState("");
  const [meno, setMeno] = useState("");
  const [rola, setRola] = useState<UserRole | "">("");
  const [heslo, setHeslo] = useState("");

  function vytvor() {
    if (!email.trim() || !meno.trim() || !rola || !heslo) {
      return toast.error("Vyplň email, meno, rolu aj dočasné heslo.");
    }
    startTransition(async () => {
      const r = await vytvorPouzivatelaAction({
        email,
        displayName: meno,
        role: rola,
        heslo,
      });
      if (r.ok) {
        toast.success("Používateľ vytvorený.");
        setEmail("");
        setMeno("");
        setRola("");
        setHeslo("");
        router.refresh();
      } else {
        toast.error(r.error);
      }
    });
  }

  function zmenRolu(id: string, novaRola: UserRole) {
    startTransition(async () => {
      const r = await zmenRoluAction({ id, role: novaRola });
      if (r.ok) {
        toast.success("Rola zmenená.");
        router.refresh();
      } else {
        toast.error(r.error);
      }
    });
  }

  function prepniAktivny(id: string, isActive: boolean) {
    startTransition(async () => {
      const r = await nastavAktivnyAction({ id, isActive });
      if (r.ok) {
        toast.success(isActive ? "Používateľ aktivovaný." : "Používateľ deaktivovaný.");
        router.refresh();
      } else {
        toast.error(r.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Nový používateľ</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="u-email">Email</Label>
              <Input
                id="u-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="u-meno">Meno</Label>
              <Input
                id="u-meno"
                value={meno}
                onChange={(e) => setMeno(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Rola</Label>
              <Select
                items={ROLE_ITEMS}
                value={rola}
                onValueChange={(v) => setRola((v as UserRole) ?? "")}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Vyber rolu" />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(ROLY) as UserRole[]).map((r) => (
                    <SelectItem key={r} value={r}>
                      {ROLY[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="u-heslo">Dočasné heslo</Label>
              <Input
                id="u-heslo"
                type="text"
                placeholder="min. 8 znakov"
                value={heslo}
                onChange={(e) => setHeslo(e.target.value)}
              />
            </div>
          </div>
          <Button className="self-start" disabled={pending} onClick={vytvor}>
            Vytvoriť používateľa
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Účty</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Meno</TableHead>
                <TableHead>Email</TableHead>
                <TableHead className="w-56">Rola</TableHead>
                <TableHead>Stav</TableHead>
                <TableHead className="text-right">Akcia</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pouzivatelia.map((u) => {
                const jaSam = u.id === currentUserId;
                return (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">{u.displayName}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {u.email ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Select
                        items={ROLE_ITEMS}
                        value={u.role}
                        onValueChange={(v) =>
                          v && v !== u.role && zmenRolu(u.id, v as UserRole)
                        }
                      >
                        <SelectTrigger size="sm" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(Object.keys(ROLY) as UserRole[]).map((r) => (
                            <SelectItem key={r} value={r}>
                              {ROLY[r]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      {u.isActive ? (
                        <Badge
                          variant="outline"
                          className="border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                        >
                          Aktívny
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="border-transparent bg-muted text-muted-foreground"
                        >
                          Neaktívny
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pending || (jaSam && u.isActive)}
                        title={
                          jaSam && u.isActive
                            ? "Nemôžeš deaktivovať vlastný účet"
                            : undefined
                        }
                        onClick={() => prepniAktivny(u.id, !u.isActive)}
                      >
                        {u.isActive ? "Deaktivovať" : "Aktivovať"}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
