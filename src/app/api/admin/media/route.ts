import { NextResponse, type NextRequest } from "next/server";
import { signMediaUrl } from "@/lib/media";
import { requireSessionApi } from "@/lib/auth/api-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/media?path=audio/<id>.ogg
 *
 * Devolve uma URL assinada de curta duração pro player/imagem no painel
 * admin. O bucket é privado — a service_role gera a URL e a UI consome.
 */
export async function GET(req: NextRequest) {
  const gate = await requireSessionApi();
  if (gate instanceof NextResponse) return gate;
  const url = new URL(req.url);
  const path = url.searchParams.get("path");
  if (!path) {
    return NextResponse.json({ ok: false, error: "path obrigatório" }, { status: 400 });
  }

  // Sanity: só aceita prefixos conhecidos pra evitar traversal / abuso.
  if (!/^(audio|image|video)\/[\w.-]+$/.test(path)) {
    return NextResponse.json({ ok: false, error: "path inválido" }, { status: 400 });
  }

  try {
    const signed = await signMediaUrl(path, 900);
    return NextResponse.json({ ok: true, url: signed });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
