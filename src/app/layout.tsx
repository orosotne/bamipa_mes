import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { AppNav } from "@/components/app-nav";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin", "latin-ext"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin", "latin-ext"],
});

export const metadata: Metadata = {
  title: "BAMIPA — výrobno-nákladový systém",
  description: "Interný ERP/MES systém: faktúry, sklad, receptúry, výroba, labák.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="sk"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <div className="flex min-h-screen">
          <aside className="flex w-56 shrink-0 flex-col border-r bg-sidebar px-3 py-5">
            <div className="mb-6 px-3">
              <div className="text-lg font-semibold tracking-tight">BAMIPA</div>
              <div className="text-xs text-muted-foreground">
                výrobno-nákladový systém
              </div>
            </div>
            <AppNav />
          </aside>
          <main className="flex-1 overflow-x-auto px-8 py-6">{children}</main>
        </div>
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}
