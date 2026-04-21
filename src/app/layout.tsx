import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "@/design/tokens.css";
import "@/design/primitives.css";
import "@/components/shell/shell.css";
import { PWARegister } from "@/components/pwa/PWARegister";

export const metadata: Metadata = {
  title: "Blackhaus SDR",
  description: "SDR de empreendimentos novos via WhatsApp",
  manifest: "/manifest.webmanifest",
  applicationName: "Blackhaus SDR",
  appleWebApp: {
    capable: true,
    title: "Blackhaus",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [{ url: "/icons/icon-192.svg", type: "image/svg+xml" }],
    apple: [{ url: "/icons/icon-192.svg", type: "image/svg+xml" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#0e1624",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <head>
        {/* Inter + Instrument Serif + JetBrains Mono — fonts do design system */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Instrument+Serif:ital@0;1&family=JetBrains+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body
        style={{
          margin: 0,
          padding: 0,
          // legacy color pra rotas /admin/* que ainda usam inline styles
          // próprios. Rotas novas sob (shell) aplicam `.bh` e sobrepõem.
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
          background: "#0b0b0d",
          color: "#e7e7ea",
        }}
      >
        {children}
        <PWARegister />
      </body>
    </html>
  );
}
