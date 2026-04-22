/**
 * Streaming de mídia inbound (áudio/imagem/vídeo do lead) pro /inbox.
 *
 *   GET /api/media/play?path=audio/<id>.ogg
 *
 * Alternativa ao `/api/admin/media` (que devolve signed URL): aqui
 * streamamos o blob direto. Vantagens:
 *   - `<audio preload="none" src="/api/media/play?...">` só faz 1 request
 *     quando o corretor clica em play, sem ida-e-volta pra pegar URL
 *   - Cache HTTP funciona (signed URL muda a cada 15min, não cacheia)
 *   - Sem expiração — o blob é acessível enquanto o operador tiver
 *     sessão no app (a sessão porteira é o shell /inbox, mesmo contrato
 *     que `/api/admin/media` já assume hoje)
 *
 * Segurança: mesma regex restritiva do route admin:
 *   `^(audio|image|video)\/[\w.-]+$`
 * Bloqueia traversal (`..`), paths absolutos e qualquer coisa fora
 * dos 3 prefixos permitidos.
 *
 * Cache: paths incluem message_id único → blob nunca é reescrito.
 * Cache-Control `immutable` por 1 dia é seguro.
 */
import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKET = "messages-media";
const PATH_RE = /^(audio|image|video)\/[\w.-]+$/;

const MIME_BY_PREFIX: Record<string, string> = {
  audio: "audio/ogg",
  image: "image/jpeg",
  video: "video/mp4",
};

export async function GET(req: NextRequest) {
  const path = req.nextUrl.searchParams.get("path");
  if (!path) {
    return NextResponse.json({ ok: false, error: "path obrigatório" }, { status: 400 });
  }
  if (!PATH_RE.test(path)) {
    return NextResponse.json({ ok: false, error: "path inválido" }, { status: 400 });
  }

  try {
    const sb = supabaseAdmin();
    const { data, error } = await sb.storage.from(BUCKET).download(path);
    if (error || !data) {
      return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
    }
    const arr = await data.arrayBuffer();
    // Prefere o contentType do próprio blob (Supabase devolve), cai pro
    // mapa por prefixo se o driver não populou.
    const prefix = path.split("/", 1)[0];
    const contentType = (data as { type?: string }).type || MIME_BY_PREFIX[prefix] || "application/octet-stream";
    return new NextResponse(arr, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(arr.byteLength),
        "Cache-Control": "public, max-age=86400, immutable",
        "Accept-Ranges": "bytes",
      },
    });
  } catch (e) {
    console.error("[media/play] erro:", e);
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
