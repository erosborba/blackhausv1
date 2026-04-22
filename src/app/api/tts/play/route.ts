/**
 * Vanguard · Track 4 · Slice 4.5 — playback de áudio TTS outbound.
 *
 *   GET /api/tts/play?key=<sha256>
 *
 * Baixa o mp3 cacheado no bucket `tts-cache` e devolve direto pro
 * `<audio>` do inbox. A chave é determinística (`sha256(voice+model+text)`),
 * então qualquer mensagem outbound que foi pra PTT tem o mesmo blob
 * disponível enquanto o cache não for invalidado.
 *
 * Por que não signed URL como `/api/admin/media`:
 *   - O cache do TTS é público "de fato" dentro da org (todo operador
 *     autorizado vê a mesma thread). Signed URL só adiciona ida-e-volta
 *     sem ganho de segurança real — é a mesma sessão.
 *   - Stream direto deixa o endpoint cacheável em Edge no futuro.
 *
 * Segurança:
 *   - Chave é validada como 64 hex chars (regex). Impede path traversal
 *     (`..`, `/`) mesmo que o Supabase já sanitize.
 *   - Bucket é privado (service_role lê). Sem a chave certa, 404.
 *
 * Cache HTTP: `public, max-age=86400, immutable` — o hash é o conteúdo,
 * então o blob nunca muda. Cliente pode cachear agressivamente.
 */
import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKET = "tts-cache";
const KEY_RE = /^[a-f0-9]{64}$/;

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (!key) {
    return NextResponse.json({ ok: false, error: "key obrigatório" }, { status: 400 });
  }
  if (!KEY_RE.test(key)) {
    // Regex defensivo: só aceita sha256 hex, 64 chars. Bloqueia `..`,
    // `/`, query injection e chaves curtas que podem existir por bug
    // em versões antigas.
    return NextResponse.json({ ok: false, error: "key inválida" }, { status: 400 });
  }

  try {
    const sb = supabaseAdmin();
    const { data, error } = await sb.storage.from(BUCKET).download(`${key}.mp3`);
    if (error || !data) {
      return NextResponse.json(
        { ok: false, error: "not_found" },
        { status: 404 },
      );
    }
    const arr = await data.arrayBuffer();
    return new NextResponse(arr, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(arr.byteLength),
        // Hash é o conteúdo: blob imutável. Cliente cacheia 1 dia.
        "Cache-Control": "public, max-age=86400, immutable",
        // Deixa o browser streamar / fazer range requests se quiser.
        "Accept-Ranges": "bytes",
      },
    });
  } catch (e) {
    console.error("[tts/play] erro inesperado:", e);
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
