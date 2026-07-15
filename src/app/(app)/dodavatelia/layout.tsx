import { vyzadajModul } from "@/server/guard";

export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  await vyzadajModul("dodavatelia");
  return children;
}
