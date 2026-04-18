import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Blackhaus SDR",
  description: "SDR de empreendimentos novos via WhatsApp",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body
        style={{
          margin: 0,
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
          background: "#0b0b0d",
          color: "#e7e7ea",
        }}
      >
        {children}
      </body>
    </html>
  );
}
