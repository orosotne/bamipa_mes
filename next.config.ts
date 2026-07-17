import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    // Manuál bol pôvodne statický public/manual.html — staré odkazy a záložky
    // presmeruj na internú stránku /manual (v appke, so sidebar-om).
    return [
      { source: "/manual.html", destination: "/manual", permanent: false },
    ];
  },
};

export default nextConfig;
