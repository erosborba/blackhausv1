import { supabaseAdmin } from "./supabase";

/**
 * Rotinas de limpeza (Fatia H). Chamadas pelo cron diário em
 * `/api/cron/cleanup` — cada uma independente, cada uma best-effort (erro em
 * uma não atrapalha as outras).
 *
 * Políticas (mudar aqui, não em magic numbers espalhados):
 *   - draft storage:       > 7 dias        (wizard abandonado)
 *   - ai_usage_log:        > 30 dias       (agregados no dashboard cobrem esse janela)
 *   - copilot_turns:       > 30 dias       (histórico útil pra Bia é curto)
 *   - leads inativos:      > 365 dias      (LGPD / direito ao esquecimento)
 *
 * Cada função retorna contadores pro log/response — facilita ver "quanto
 * limpou hoje" no dashboard sem precisar instrumentar métricas fancy.
 */

export type CleanupResult = {
  ok: boolean;
  task: string;
  removed: number;
  durationMs: number;
  error?: string;
  detail?: Record<string, unknown>;
};

// Políticas (dias). Centralizadas aqui.
export const CLEANUP_POLICY = {
  DRAFT_STORAGE_DAYS: 7,
  AI_USAGE_LOG_DAYS: 30,
  COPILOT_TURNS_DAYS: 30,
  INACTIVE_LEAD_DAYS: 365,
} as const;

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

async function timed(
  task: string,
  fn: () => Promise<{ removed: number; detail?: Record<string, unknown> }>,
): Promise<CleanupResult> {
  const t0 = Date.now();
  try {
    const { removed, detail } = await fn();
    return { ok: true, task, removed, durationMs: Date.now() - t0, detail };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[cleanup:${task}] failed:`, msg);
    return { ok: false, task, removed: 0, durationMs: Date.now() - t0, error: msg };
  }
}

/**
 * Varre o prefix `draft/` do bucket `empreendimentos` e apaga arquivos
 * com `created_at` > N dias. São uploads do wizard de criação que nunca
 * foram "salvos" (se fossem, o endpoint /api/admin/empreendimentos teria
 * movido pra `emp/{uuid}/`).
 *
 * Estratégia: lista todas as subpastas de `draft/`, depois os arquivos de
 * cada uma. Supabase não tem recursão nativa em `.list`, então iteramos.
 */
export async function cleanupDraftStorage(): Promise<CleanupResult> {
  return timed("draft_storage", async () => {
    const sb = supabaseAdmin();
    const cutoff = Date.now() - CLEANUP_POLICY.DRAFT_STORAGE_DAYS * 24 * 60 * 60 * 1000;

    // 1) Lista as pastas dentro de draft/ (cada wizard cria uma pasta própria).
    const { data: folders, error: listErr } = await sb.storage
      .from("empreendimentos")
      .list("draft", { limit: 1000 });
    if (listErr) throw new Error(`list draft/ falhou: ${listErr.message}`);
    if (!folders?.length) return { removed: 0, detail: { folders: 0 } };

    const pathsToDelete: string[] = [];
    let scannedFiles = 0;

    // 2) Pra cada pasta, lista arquivos e filtra pelos antigos. Paralelo em
    //    lotes de 10 pra não martelar o storage API.
    const folderNames = folders.map((f) => f.name);
    for (let i = 0; i < folderNames.length; i += 10) {
      const batch = folderNames.slice(i, i + 10);
      await Promise.all(
        batch.map(async (folderName) => {
          const { data: files, error } = await sb.storage
            .from("empreendimentos")
            .list(`draft/${folderName}`, { limit: 1000 });
          if (error) {
            console.warn(`[cleanup:draft_storage] list draft/${folderName} falhou:`, error.message);
            return;
          }
          for (const f of files ?? []) {
            scannedFiles += 1;
            // `f.created_at` existe nos objetos listados pelo Supabase Storage.
            // Se por algum motivo não vier, preferimos NÃO deletar (fail safe).
            const createdAt = f.created_at ? new Date(f.created_at).getTime() : null;
            if (createdAt !== null && createdAt < cutoff) {
              pathsToDelete.push(`draft/${folderName}/${f.name}`);
            }
          }
        }),
      );
    }

    if (!pathsToDelete.length) {
      return { removed: 0, detail: { folders: folders.length, scanned: scannedFiles } };
    }

    // 3) Remove em lotes de 100 (API aceita array).
    let removed = 0;
    for (let i = 0; i < pathsToDelete.length; i += 100) {
      const chunk = pathsToDelete.slice(i, i + 100);
      const { error } = await sb.storage.from("empreendimentos").remove(chunk);
      if (error) {
        console.warn(`[cleanup:draft_storage] remove batch falhou:`, error.message);
        continue;
      }
      removed += chunk.length;
    }

    return {
      removed,
      detail: {
        folders: folders.length,
        scanned: scannedFiles,
        attempted: pathsToDelete.length,
      },
    };
  });
}

/** Deleta linhas de ai_usage_log com created_at < cutoff. */
export async function cleanupAiUsageLog(): Promise<CleanupResult> {
  return timed("ai_usage_log", async () => {
    const sb = supabaseAdmin();
    const cutoff = daysAgo(CLEANUP_POLICY.AI_USAGE_LOG_DAYS);
    // `.delete().lt(...).select("id")` devolve as linhas deletadas pra
    // contar — Supabase não retorna row count bruto no delete.
    const { data, error } = await sb
      .from("ai_usage_log")
      .delete()
      .lt("created_at", cutoff)
      .select("id");
    if (error) throw new Error(error.message);
    return { removed: data?.length ?? 0, detail: { cutoff } };
  });
}

/** Deleta copilot_turns com created_at < cutoff. */
export async function cleanupCopilotTurns(): Promise<CleanupResult> {
  return timed("copilot_turns", async () => {
    const sb = supabaseAdmin();
    const cutoff = daysAgo(CLEANUP_POLICY.COPILOT_TURNS_DAYS);
    const { data, error } = await sb
      .from("copilot_turns")
      .delete()
      .lt("created_at", cutoff)
      .select("id");
    if (error) throw new Error(error.message);
    return { removed: data?.length ?? 0, detail: { cutoff } };
  });
}

/**
 * LGPD: apaga leads sem interação há > N dias. Cascade cuida de messages,
 * drafts, bridges, handoffs (todos tem FK on delete cascade).
 *
 * Critérios pra deletar:
 *   - last_message_at é null OU < cutoff
 *   - status NÃO está em estados "quentes" (qualified, scheduled, won)
 *   - bridge_active = false  (nunca apaga lead com ponte ativa por segurança)
 *
 * Lead "won" fica pra sempre — histórico de conversão é valioso pra treinar
 * o sistema depois. Se precisar apagar por LGPD específica, o corretor faz
 * manual via UI.
 */
export async function cleanupInactiveLeads(): Promise<CleanupResult> {
  return timed("inactive_leads", async () => {
    const sb = supabaseAdmin();
    const cutoff = daysAgo(CLEANUP_POLICY.INACTIVE_LEAD_DAYS);

    // Busca candidatos primeiro (pra poder logar quem foi apagado e pra não
    // precisar de uma query DELETE complicada com OR + NOT IN).
    const { data: candidates, error: selErr } = await sb
      .from("leads")
      .select("id, phone, last_message_at, status, bridge_active")
      .or(`last_message_at.lt.${cutoff},last_message_at.is.null`)
      .not("status", "in", "(qualified,scheduled,won)")
      .eq("bridge_active", false)
      .lt("created_at", cutoff) // dupla-trava: lead criado há menos de N dias nunca é apagado
      .limit(500);
    if (selErr) throw new Error(selErr.message);
    if (!candidates?.length) return { removed: 0, detail: { cutoff } };

    const ids = candidates.map((l) => l.id);
    const { error: delErr } = await sb.from("leads").delete().in("id", ids);
    if (delErr) throw new Error(delErr.message);

    return {
      removed: ids.length,
      detail: {
        cutoff,
        // Amostra (até 5) pra ver no log sem expor PII em volume
        sample: candidates.slice(0, 5).map((c) => ({
          phone_last4: c.phone.slice(-4),
          status: c.status,
        })),
      },
    };
  });
}

/**
 * Roda todas as rotinas em sequência. Não paraleliza pra manter o log
 * legível (1 linha por task) e evitar picos de pressure no banco.
 */
export async function runAllCleanup(): Promise<{
  ok: boolean;
  results: CleanupResult[];
  totalRemoved: number;
  durationMs: number;
}> {
  const t0 = Date.now();
  const results: CleanupResult[] = [];

  results.push(await cleanupDraftStorage());
  results.push(await cleanupAiUsageLog());
  results.push(await cleanupCopilotTurns());
  results.push(await cleanupInactiveLeads());

  const totalRemoved = results.reduce((s, r) => s + r.removed, 0);
  const ok = results.every((r) => r.ok);

  console.log("[cleanup] done", {
    ok,
    totalRemoved,
    durationMs: Date.now() - t0,
    tasks: results.map((r) => ({
      task: r.task,
      ok: r.ok,
      removed: r.removed,
      ms: r.durationMs,
    })),
  });

  return { ok, results, totalRemoved, durationMs: Date.now() - t0 };
}
