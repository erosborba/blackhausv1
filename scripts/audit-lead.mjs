#!/usr/bin/env node
/**
 * Auditoria de handoff de um lead específico.
 *
 *   node scripts/audit-lead.mjs <leadId>
 *   node scripts/audit-lead.mjs --phone=554195298060
 *
 * Mostra: estado do lead, eventos recentes, escalações pendentes/disparadas,
 * mensagens recentes, sugestões do copiloto e corretores ativos.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

function loadEnvFile(path) {
  if (!existsSync(path)) return {};
  const text = readFileSync(path, "utf8");
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

const root = process.cwd();
const env = {
  ...loadEnvFile(resolve(root, ".env")),
  ...loadEnvFile(resolve(root, ".env.local")),
  ...process.env,
};

const url = env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("faltando SUPABASE_URL / SUPABASE_SECRET_KEY");
  process.exit(1);
}

const args = process.argv.slice(2);
const phoneArg = args.find((a) => a.startsWith("--phone="));
const phone = phoneArg ? phoneArg.split("=")[1] : null;
const leadIdArg = args.find((a) => !a.startsWith("--"));

if (!leadIdArg && !phone) {
  console.error("uso: node scripts/audit-lead.mjs <leadId> | --phone=<numero>");
  process.exit(1);
}

const sb = createClient(url, key, { auth: { persistSession: false } });

function fmt(d) {
  if (!d) return "—";
  return new Date(d).toISOString().replace("T", " ").slice(0, 19) + "Z";
}

async function resolveLead() {
  if (leadIdArg) {
    const { data } = await sb.from("leads").select("*").eq("id", leadIdArg).maybeSingle();
    return data;
  }
  // tenta variantes do BR phone (com/sem 9)
  const digits = phone.replace(/\D/g, "");
  const variants = new Set([digits]);
  if (digits.length === 12) variants.add(digits.slice(0, 4) + "9" + digits.slice(4));
  if (digits.length === 13) variants.add(digits.slice(0, 4) + digits.slice(5));
  const { data } = await sb.from("leads").select("*").in("phone", [...variants]).limit(1).maybeSingle();
  return data;
}

const lead = await resolveLead();
if (!lead) {
  console.error("lead não encontrado");
  process.exit(1);
}

console.log("\n=== LEAD ===");
console.log(`id              ${lead.id}`);
console.log(`phone           ${lead.phone}`);
console.log(`push_name       ${lead.push_name ?? "—"}`);
console.log(`full_name       ${lead.full_name ?? "—"}`);
console.log(`stage           ${lead.stage ?? "—"}`);
console.log(`score           ${lead.score ?? "—"}`);
console.log(`assigned_agent  ${lead.assigned_agent_id ?? "—"}`);
console.log(`bridge_active   ${lead.bridge_active}`);
console.log(`human_takeover  ${lead.human_takeover}`);
console.log(`handoff_attempts        ${lead.handoff_attempts ?? 0}`);
console.log(`handoff_reason          ${lead.handoff_reason ?? "—"}`);
console.log(`handoff_urgency         ${lead.handoff_urgency ?? "—"}`);
console.log(`handoff_notified_at     ${fmt(lead.handoff_notified_at)}`);
console.log(`handoff_resolved_at     ${fmt(lead.handoff_resolved_at)}`);
console.log(`bridge_closed_at        ${fmt(lead.bridge_closed_at)}`);
console.log(`updated_at              ${fmt(lead.updated_at)}`);
console.log(`created_at              ${fmt(lead.created_at)}`);
console.log(`brief           ${lead.brief ? lead.brief.slice(0, 200) + "…" : "—"}`);

console.log("\n=== EVENTOS (últimos 30) ===");
const { data: events } = await sb
  .from("lead_events")
  .select("kind, actor, payload, at")
  .eq("lead_id", lead.id)
  .order("at", { ascending: false })
  .limit(30);
for (const e of events ?? []) {
  console.log(`  ${fmt(e.at)}  [${e.actor ?? "?"}] ${e.kind}  ${JSON.stringify(e.payload ?? {})}`);
}
if (!events?.length) console.log("  (nenhum)");

console.log("\n=== HANDOFF_ESCALATIONS ===");
const { data: escs } = await sb
  .from("handoff_escalations")
  .select("id, status, scheduled_for, created_at, updated_at")
  .eq("lead_id", lead.id)
  .order("created_at", { ascending: false })
  .limit(20);
for (const e of escs ?? []) {
  console.log(`  ${fmt(e.created_at)}  status=${e.status}  scheduled_for=${fmt(e.scheduled_for)}  updated=${fmt(e.updated_at)}`);
}
if (!escs?.length) console.log("  (nenhuma)");

console.log("\n=== MENSAGENS (últimas 20) ===");
const { data: msgs } = await sb
  .from("messages")
  .select("direction, role, content, created_at")
  .eq("lead_id", lead.id)
  .order("created_at", { ascending: false })
  .limit(20);
for (const m of (msgs ?? []).reverse()) {
  const c = (m.content ?? "").replace(/\s+/g, " ").slice(0, 140);
  console.log(`  ${fmt(m.created_at)}  ${m.direction.padEnd(8)} ${(m.role ?? "").padEnd(10)} ${c}`);
}
if (!msgs?.length) console.log("  (nenhuma)");

console.log("\n=== COPILOT_SUGGESTIONS ===");
const { data: sugs } = await sb
  .from("copilot_suggestions")
  .select("kind, status, created_at, sent_at, discarded_at")
  .eq("lead_id", lead.id)
  .order("created_at", { ascending: false })
  .limit(10);
for (const s of sugs ?? []) {
  console.log(`  ${fmt(s.created_at)}  ${s.kind}  status=${s.status}  sent=${fmt(s.sent_at)}  discarded=${fmt(s.discarded_at)}`);
}
if (!sugs?.length) console.log("  (nenhuma)");

console.log("\n=== AGENTES ATIVOS ===");
const { data: agents } = await sb
  .from("agents")
  .select("id, name, phone, active, current_lead_id, last_assigned_at")
  .order("last_assigned_at", { ascending: true, nullsFirst: true });
for (const a of agents ?? []) {
  const flag = a.active ? "✓" : "✗";
  console.log(`  ${flag} ${a.id}  ${(a.name ?? "—").padEnd(20)} ${a.phone}  current=${a.current_lead_id ?? "—"}  last_assigned=${fmt(a.last_assigned_at)}`);
}
if (!agents?.length) console.log("  (nenhum)");

console.log();
