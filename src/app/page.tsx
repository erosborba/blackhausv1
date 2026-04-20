import { supabaseAdmin } from "@/lib/supabase";
import { getInstanceStatus } from "@/lib/evolution";

export const dynamic = "force-dynamic";

async function loadOverview() {
  const sb = supabaseAdmin();
  const [{ count: leadsCount }, { data: lastLeads }, { count: empCount }] = await Promise.all([
    sb.from("leads").select("*", { count: "exact", head: true }),
    sb.from("leads").select("phone, push_name, status, stage, updated_at").order("updated_at", { ascending: false }).limit(8),
    sb.from("empreendimentos").select("*", { count: "exact", head: true }).eq("ativo", true),
  ]);
  return { leadsCount: leadsCount ?? 0, lastLeads: lastLeads ?? [], empCount: empCount ?? 0 };
}

async function loadEvolution() {
  try {
    const r = await getInstanceStatus();
    return { ok: true, raw: r };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export default async function Page() {
  const [overview, evo] = await Promise.all([loadOverview(), loadEvolution()]);
  return (
    <main style={{ maxWidth: 920, margin: "40px auto", padding: 24 }}>
      <h1 style={{ margin: 0 }}>Blackhaus SDR</h1>
      <p style={{ opacity: 0.7, marginTop: 4 }}>
        Painel rápido — leads, empreendimentos e estado da instância WhatsApp.
      </p>

      <nav style={{ display: "flex", gap: 12, marginTop: 16, flexWrap: "wrap" }}>
        <a href="/admin/leads" style={navBtn}>Inbox</a>
        <a href="/admin/empreendimentos" style={navBtn}>Empreendimentos</a>
        <a href="/admin/empreendimentos/new" style={navBtn}>+ Novo empreendimento</a>
        <a href="/admin/drafts" style={navBtn}>Drafts</a>
        <a href="/admin/usage" style={navBtn}>Uso de IA</a>
        <a href="/admin/cleanup" style={navBtn}>Manutenção</a>
      </nav>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginTop: 32 }}>
        <Card title="Leads" value={overview.leadsCount} />
        <Card title="Empreendimentos ativos" value={overview.empCount} />
        <Card
          title="Evolution"
          value={evo.ok ? "conectado" : "offline"}
          tone={evo.ok ? "ok" : "warn"}
        />
      </section>

      <section style={{ marginTop: 32 }}>
        <h2 style={{ fontSize: 16, opacity: 0.8 }}>Últimos leads</h2>
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}>
          <thead>
            <tr style={{ textAlign: "left", opacity: 0.6, fontSize: 12 }}>
              <th style={th}>Telefone</th>
              <th style={th}>Nome</th>
              <th style={th}>Status</th>
              <th style={th}>Estágio</th>
              <th style={th}>Atualizado</th>
            </tr>
          </thead>
          <tbody>
            {overview.lastLeads.map((l) => (
              <tr key={l.phone} style={{ borderTop: "1px solid #222" }}>
                <td style={td}>{l.phone}</td>
                <td style={td}>{l.push_name ?? "—"}</td>
                <td style={td}>{l.status}</td>
                <td style={td}>{l.stage ?? "—"}</td>
                <td style={td}>{new Date(l.updated_at).toLocaleString("pt-BR")}</td>
              </tr>
            ))}
            {overview.lastLeads.length === 0 && (
              <tr>
                <td style={td} colSpan={5}>
                  Nenhum lead ainda. Conecte a instância WhatsApp e mande uma mensagem.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section style={{ marginTop: 32, fontSize: 13, opacity: 0.7 }}>
        <p>
          <strong>Webhook:</strong> <code>POST /api/webhook/evolution</code>
        </p>
        <p>
          <strong>Conectar instância:</strong> <code>POST /api/admin/instance/create</code> e depois{" "}
          <code>GET /api/admin/instance/qr</code> para ler o QR.
        </p>
      </section>
    </main>
  );
}

const th: React.CSSProperties = { padding: "8px 6px", fontWeight: 500 };
const td: React.CSSProperties = { padding: "10px 6px", fontSize: 14 };
const navBtn: React.CSSProperties = {
  background: "#2a2a32",
  color: "#e7e7ea",
  padding: "8px 14px",
  borderRadius: 8,
  textDecoration: "none",
  fontSize: 13,
};

function Card({ title, value, tone }: { title: string; value: string | number; tone?: "ok" | "warn" }) {
  const color = tone === "warn" ? "#f59e0b" : tone === "ok" ? "#22c55e" : "#e7e7ea";
  return (
    <div style={{ background: "#15151a", borderRadius: 12, padding: 16 }}>
      <div style={{ fontSize: 12, opacity: 0.6 }}>{title}</div>
      <div style={{ fontSize: 28, marginTop: 6, color }}>{value}</div>
    </div>
  );
}
