import { supabaseAdmin } from "@/lib/supabase";
import { sendMedia } from "@/lib/evolution";
import type { Foto, FotoCategoria } from "@/lib/empreendimentos-shared";

const BUCKET = "empreendimentos";
const DEFAULT_MAX = 4;

export type SendEmpreendimentoFotosInput = {
  empreendimento_id?: string;
  empreendimento_slug?: string;
  lead_phone: string;
  categoria?: FotoCategoria;
  max?: number;
};

export type SendEmpreendimentoFotosOutput =
  | {
      ok: true;
      empreendimento_id: string;
      empreendimento_nome: string;
      sent: number;
      categoria: FotoCategoria | "mix";
    }
  | {
      ok: false;
      reason:
        | "empreendimento_not_found"
        | "no_fotos"
        | "no_fotos_in_categoria"
        | "send_failed";
      message?: string;
    };

function mimeFromName(name: string): string {
  const n = name.toLowerCase();
  if (n.endsWith(".png")) return "image/png";
  if (n.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

function pickFotos(all: Foto[], categoria: FotoCategoria | undefined, max: number): Foto[] {
  const sorted = [...all].sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0));
  if (!categoria) {
    // Sem categoria: prioriza fachada > decorado > lazer > vista > planta > outros
    const priority: Record<FotoCategoria, number> = {
      fachada: 0,
      decorado: 1,
      lazer: 2,
      vista: 3,
      planta: 4,
      outros: 5,
    };
    sorted.sort((a, b) => {
      const pa = priority[a.categoria] ?? 99;
      const pb = priority[b.categoria] ?? 99;
      if (pa !== pb) return pa - pb;
      return (a.ordem ?? 0) - (b.ordem ?? 0);
    });
    return sorted.slice(0, max);
  }
  return sorted.filter((f) => f.categoria === categoria).slice(0, max);
}

/**
 * Baixa até N fotos do empreendimento do bucket e envia uma por uma
 * via WhatsApp (Evolution), com a legenda como caption (se houver).
 *
 * Política:
 *  - Se `categoria` dada, filtra por ela. Senão pega mix priorizando
 *    fachada/decorado/lazer (o que normalmente o lead quer ver).
 *  - Max default 4 (evita floodar o WhatsApp).
 *  - Delay crescente entre envios pra Evolution não derrubar por rate.
 *  - Falha de envio individual não aborta o batch — loga e segue.
 */
export async function sendEmpreendimentoFotos(
  input: SendEmpreendimentoFotosInput,
): Promise<SendEmpreendimentoFotosOutput> {
  const sb = supabaseAdmin();

  let q = sb
    .from("empreendimentos")
    .select("id, nome, fotos")
    .eq("ativo", true)
    .limit(1);
  if (input.empreendimento_id) q = q.eq("id", input.empreendimento_id);
  else if (input.empreendimento_slug) q = q.eq("slug", input.empreendimento_slug);
  else return { ok: false, reason: "empreendimento_not_found" };

  const { data: emp, error } = await q.maybeSingle();
  if (error || !emp) return { ok: false, reason: "empreendimento_not_found" };

  const fotos: Foto[] = Array.isArray(emp.fotos) ? (emp.fotos as Foto[]) : [];
  if (!fotos.length) return { ok: false, reason: "no_fotos" };

  const max = Math.max(1, Math.min(input.max ?? DEFAULT_MAX, 6));
  const picked = pickFotos(fotos, input.categoria, max);
  if (!picked.length) return { ok: false, reason: "no_fotos_in_categoria" };

  let sent = 0;
  let firstErr: string | null = null;

  for (let i = 0; i < picked.length; i++) {
    const f = picked[i];
    try {
      const { data: dl, error: dlErr } = await sb.storage.from(BUCKET).download(f.path);
      if (dlErr || !dl) {
        console.error("[send_fotos] download failed", f.path, dlErr?.message);
        continue;
      }
      const buf = Buffer.from(await dl.arrayBuffer());
      await sendMedia({
        to: input.lead_phone,
        mediatype: "image",
        mediaBase64: buf.toString("base64"),
        fileName: f.name,
        mimetype: mimeFromName(f.name),
        caption: f.legenda ?? undefined,
        delayMs: 800 + i * 300,
      });
      sent++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!firstErr) firstErr = msg;
      console.error("[send_fotos] evolution send failed", f.path, msg);
    }
  }

  if (sent === 0) {
    return { ok: false, reason: "send_failed", message: firstErr ?? "nenhuma foto enviada" };
  }

  return {
    ok: true,
    empreendimento_id: emp.id,
    empreendimento_nome: emp.nome,
    sent,
    categoria: input.categoria ?? "mix",
  };
}
