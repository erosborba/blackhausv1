import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { generateBrief } from "@/lib/brief";
import { closeBridge } from "@/lib/handoff";
import { getSession } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/leads/[id]/takeover
 * Corretor assume a conversa: pausa a Bia + gera brief (Claude) + grava
 * brief/brief_at. Não envia mensagem — o corretor decide o que dizer.
 *
 * DELETE /api/leads/[id]/takeover
 * Devolve o controle pra IA. Mantém o brief pra histórico (só flipa
 * human_takeover=false).
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { agent } = await getSession();
  if (!agent) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const sb = supabaseAdmin();

  // Tenta gerar brief — se falhar, ainda assim pausa a IA (corretor não
  // pode ser bloqueado por indisponibilidade da Anthropic).
  let brief: string | null = null;
  try {
    brief = await generateBrief(id);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[takeover] brief failed — continuando sem brief:", msg);
  }

  const patch: Record<string, unknown> = {
    human_takeover: true,
    assigned_agent_id: agent.id,
  };
  if (brief) {
    patch.brief = brief;
    patch.brief_at = new Date().toISOString();
  }

  const { data, error } = await sb
    .from("leads")
    .update(patch)
    .eq("id", id)
    .select("*")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ ok: false, error: "lead_not_found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, data, brief });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { agent } = await getSession();
  if (!agent) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  // Fecha ponte (se aberta), zera human_takeover e limpa sessão do corretor.
  // Mantém assigned_agent_id — corretor continua dono do lead, só a IA volta
  // a responder a próxima mensagem.
  await closeBridge(id);

  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("leads")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ ok: false, error: "lead_not_found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, data });
}
