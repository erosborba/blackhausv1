import { supabaseAdmin } from "@/lib/supabase";
import { sendDocument } from "@/lib/evolution";

const BUCKET = "empreendimentos";

export type SendEmpreendimentoBookingInput = {
  empreendimento_id?: string;
  empreendimento_slug?: string;
  lead_phone: string;
  caption?: string;
};

export type SendEmpreendimentoBookingOutput =
  | {
      ok: true;
      empreendimento_id: string;
      empreendimento_nome: string;
      file_name: string;
    }
  | {
      ok: false;
      reason:
        | "empreendimento_not_found"
        | "no_booking"
        | "download_failed"
        | "send_failed";
      message?: string;
    };

function slugify(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

/**
 * Envia o PDF de booking digital do empreendimento pro lead via WhatsApp.
 *
 * O path fica em `empreendimentos.booking_digital_path` (bucket
 * `empreendimentos`). Baixa, converte em base64 e manda como document
 * (mimetype application/pdf). Se não houver booking cadastrado, devolve
 * erro estruturado — quem chamou decide a copy pro lead.
 */
export async function sendEmpreendimentoBooking(
  input: SendEmpreendimentoBookingInput,
): Promise<SendEmpreendimentoBookingOutput> {
  const sb = supabaseAdmin();

  let q = sb
    .from("empreendimentos")
    .select("id, nome, booking_digital_path")
    .eq("ativo", true)
    .limit(1);
  if (input.empreendimento_id) q = q.eq("id", input.empreendimento_id);
  else if (input.empreendimento_slug) q = q.eq("slug", input.empreendimento_slug);
  else return { ok: false, reason: "empreendimento_not_found" };

  const { data: emp, error } = await q.maybeSingle();
  if (error || !emp) return { ok: false, reason: "empreendimento_not_found" };

  const path = emp.booking_digital_path;
  if (!path || typeof path !== "string") {
    return { ok: false, reason: "no_booking" };
  }

  const { data: dl, error: dlErr } = await sb.storage.from(BUCKET).download(path);
  if (dlErr || !dl) {
    return {
      ok: false,
      reason: "download_failed",
      message: dlErr?.message ?? "arquivo não encontrado no storage",
    };
  }

  const buf = Buffer.from(await dl.arrayBuffer());
  const fileName = `${slugify(emp.nome) || "booking"}.pdf`;

  try {
    await sendDocument({
      to: input.lead_phone,
      mediaBase64: buf.toString("base64"),
      fileName,
      mimetype: "application/pdf",
      caption: input.caption ?? `Apresentação — ${emp.nome}`,
      delayMs: 1200,
    });
  } catch (e) {
    return {
      ok: false,
      reason: "send_failed",
      message: e instanceof Error ? e.message : String(e),
    };
  }

  return {
    ok: true,
    empreendimento_id: emp.id,
    empreendimento_nome: emp.nome,
    file_name: fileName,
  };
}
