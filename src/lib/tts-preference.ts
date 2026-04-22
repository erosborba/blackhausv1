/**
 * Vanguard · Track 4 · Slice 4.3 — preferência de áudio do lead.
 *
 * Sem coluna memoizada em `leads`. A preferência é computada on-the-fly
 * a cada resposta via query nas últimas N mensagens *inbound* do lead.
 * Se ≥1 delas foi áudio, o lead "prefere áudio" pro próximo outbound.
 *
 * Por que sem memoização:
 *   - Query é barata (índice composto lead_id+created_at já existe)
 *   - Consistência automática: nunca fica stale
 *   - Coluna memoizada exigiria trigger/update em cada insert, mais
 *     uma categoria de bug pra caçar
 *
 * Esta função toca DB — fica separada do classifier puro em
 * `tts-classify.ts` exatamente por essa razão. O webhook chama essa
 * helper, passa o boolean pra `shouldUseAudio`.
 */
import { supabaseAdmin } from "./supabase";

/**
 * Janela considerada — "últimas N mensagens do lead". 3 é o default
 * do design (track 4 no VANGUARD_SLICES.md). Fica parâmetro pra
 * testes e pra ajuste futuro sem mudar assinatura.
 */
const DEFAULT_WINDOW = 3;

/**
 * Retorna `true` se alguma das últimas `windowSize` mensagens INBOUND
 * (role='user') do lead foi áudio (media_type='audio').
 *
 * Mensagens outbound (Bia/corretor) são ignoradas — estamos tentando
 * ler o COMPORTAMENTO do lead, não o nosso histórico de resposta.
 *
 * Em caso de erro de DB, retorna false (fail-soft pra texto). Audio é
 * feature de humanização; melhor cair elegante pra texto do que
 * propagar erro de query pro webhook.
 */
export async function leadPrefersAudio(
  leadId: string,
  windowSize: number = DEFAULT_WINDOW,
): Promise<boolean> {
  try {
    const sb = supabaseAdmin();
    const { data, error } = await sb
      .from("messages")
      .select("media_type")
      .eq("lead_id", leadId)
      .eq("role", "user")
      .order("created_at", { ascending: false })
      .limit(windowSize);

    if (error) {
      console.error(`[tts-preference] query falhou (lead=${leadId}):`, error.message);
      return false;
    }
    if (!data || data.length === 0) return false;

    return data.some((m) => m.media_type === "audio");
  } catch (e) {
    console.error(`[tts-preference] leadPrefersAudio threw (lead=${leadId}):`, e);
    return false;
  }
}
