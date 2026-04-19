import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { generateBrief } from "@/lib/brief";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Corretor assume a conversa:
 *  1. Gera um brief do lead via Claude (histórico + qualificação).
 *  2. Pausa a Bia (human_takeover=true).
 *  3. Grava o brief + timestamp em leads.brief/brief_at.
 *
 * Não envia mensagem ao lead — o corretor decide o que dizer.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const sb = supabaseAdmin();

  let brief: string;
  try {
    brief = await generateBrief(id);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[takeover] brief failed:", msg);
    return NextResponse.json({ ok: false, stage: "brief", error: msg }, { status: 502 });
  }

  const { data, error } = await sb
    .from("leads")
    .update({
      human_takeover: true,
      brief,
      brief_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("*")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ ok: false, stage: "update", error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, data, brief });
}
