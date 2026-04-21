"use client";

import { useEffect } from "react";

/**
 * Registra o service worker quando o navegador suporta e estamos em prod
 * (ou em dev com flag explícita — útil pra testar Lighthouse local).
 *
 * Não bloqueia nada: o SW é progressive enhancement puro. Se falhar, só
 * perdemos cache offline + "Install App".
 */
export function PWARegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    // Em dev por padrão NÃO registra — HMR + SW se machucam. Liberar com
    // NEXT_PUBLIC_ENABLE_SW=1 pra debugar localmente.
    const enabled =
      process.env.NODE_ENV === "production" ||
      process.env.NEXT_PUBLIC_ENABLE_SW === "1";
    if (!enabled) return;

    const handle = () => {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .catch((err) => {
          console.warn("[pwa] SW register failed:", err);
        });
    };

    if (document.readyState === "complete") handle();
    else window.addEventListener("load", handle, { once: true });
    return () => window.removeEventListener("load", handle);
  }, []);

  return null;
}
