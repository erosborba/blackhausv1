"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";

/**
 * Seção de upload/confirmação da tabela de preços do empreendimento.
 *
 * Fluxo:
 *  1. GET inicial → mostra header atual (version, uploaded_at, warnings)
 *  2. Upload arquivo → POST preview → state { parsed, expectedVersion }
 *  3. Revisão: mostra amostras + warnings + total; botão Confirmar
 *  4. PUT confirm → se 409, recarrega e avisa que outro admin mexeu
 *  5. Remover → DELETE com expected_version
 *
 * Não usa emoji gratuito; sinaliza estado com cor + texto.
 */

type TabelaHeader = {
  id: string;
  version: number;
  file_name: string | null;
  uploaded_at: string;
  uploaded_by: string | null;
  parsed_rows_count: number;
  entrega_prevista: string | null;
  disclaimers: string[];
  parse_warnings: Array<{
    numero: string | null;
    kind: "aritmetica" | "schema" | "duplicado";
    detalhe: string;
    soma_calc?: number;
    preco_total?: number;
    diff?: number;
  }>;
};

type ParsedUnidade = {
  numero: string;
  andar: number | null;
  tipologia: string;
  area_privativa: number | null;
  area_terraco: number | null;
  preco_total: number;
  plano_pagamento: {
    sinal: { parcelas: number; valor: number };
    mensais: { parcelas: number; valor: number };
    reforcos: Array<{ data: string; valor: number }>;
    saldo_final: { data: string | null; valor: number };
  };
  is_comercial: boolean;
};

type Parsed = {
  tipologias_encontradas: string[];
  disclaimers: string[];
  entrega_prevista: string | null;
  unidades: ParsedUnidade[];
  warnings: TabelaHeader["parse_warnings"];
  file: { name: string; mime: string; hash: string; bytes: number };
};

type Preview = {
  parsed: Parsed;
  file_path: string;
  expected_version: number;
};

const card: CSSProperties = {
  background: "#15151a",
  border: "1px solid #2a2a32",
  borderRadius: 12,
  padding: 24,
  marginBottom: 20,
};
const button = (variant: "primary" | "ghost" | "danger" = "ghost"): CSSProperties => ({
  background: variant === "primary" ? "#3b82f6" : variant === "danger" ? "#5a2222" : "#2a2a32",
  color: variant === "primary" ? "#fff" : variant === "danger" ? "#ffb0b0" : "#e7e7ea",
  border: "none",
  borderRadius: 8,
  padding: "10px 18px",
  fontSize: 14,
  cursor: "pointer",
  fontWeight: 500,
});
const chip = (bg: string, fg: string): CSSProperties => ({
  background: bg,
  color: fg,
  padding: "3px 8px",
  borderRadius: 4,
  fontSize: 11,
  display: "inline-block",
  fontWeight: 500,
});

function fmtBRL(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function TabelaPrecosSection({ empreendimentoId }: { empreendimentoId: string }) {
  const [header, setHeader] = useState<TabelaHeader | null>(null);
  const [loadingHeader, setLoadingHeader] = useState(true);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [uploading, setUploading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function refresh() {
    setLoadingHeader(true);
    try {
      const res = await fetch(`/api/admin/empreendimentos/${empreendimentoId}/tabela-precos`);
      const json = await res.json();
      if (json.ok) setHeader(json.header);
    } finally {
      setLoadingHeader(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empreendimentoId]);

  async function handleUpload(files: FileList | null) {
    if (!files || !files.length) return;
    setUploading(true);
    setError(null);
    setLastResult(null);
    try {
      const fd = new FormData();
      fd.append("file", files[0]);
      const res = await fetch(`/api/admin/empreendimentos/${empreendimentoId}/tabela-precos`, {
        method: "POST",
        body: fd,
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(typeof json.error === "string" ? json.error : "Parser falhou");
      }
      setPreview({
        parsed: json.parsed,
        file_path: json.file_path,
        expected_version: json.expected_version,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleConfirm() {
    if (!preview) return;
    setConfirming(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/empreendimentos/${empreendimentoId}/tabela-precos`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parsed: preview.parsed,
          file_path: preview.file_path,
          expected_version: preview.expected_version,
        }),
      });
      const json = await res.json();
      if (res.status === 409) {
        setError(
          `Outro admin atualizou a tabela (version ${json.current_version}). Recarregue e suba de novo.`,
        );
        setPreview(null);
        await refresh();
        return;
      }
      if (!res.ok || !json.ok) {
        throw new Error(typeof json.error === "string" ? json.error : "Falha ao confirmar");
      }
      setLastResult(
        `OK — ${json.inserted} inseridas, ${json.updated} atualizadas, ${json.preserved_manual} preservadas (manual), ${json.orphaned} órfãs. Versão agora: ${json.header.version}.`,
      );
      setPreview(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setConfirming(false);
    }
  }

  async function handleDelete() {
    if (!header) return;
    if (!confirm(`Remover tabela v${header.version}? Unidades source='tabela_precos' serão apagadas (linhas manuais ficam).`)) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/empreendimentos/${empreendimentoId}/tabela-precos`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expected_version: header.version }),
      });
      const json = await res.json();
      if (res.status === 409) {
        setError(`Outro admin atualizou (version ${json.current_version}). Recarregue.`);
        await refresh();
        return;
      }
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Falha ao remover");
      setLastResult("Tabela removida.");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <section style={card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>
          Tabela de Preços{" "}
          {header ? (
            <span style={{ color: "#8f8f9a", fontSize: 12, fontWeight: 400 }}>
              · v{header.version} · {header.parsed_rows_count} unidades
            </span>
          ) : (
            <span style={{ color: "#8f8f9a", fontSize: 12, fontWeight: 400 }}>· não cadastrada</span>
          )}
        </h2>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.xlsx,.xls,.csv,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
            onChange={(e) => handleUpload(e.target.files)}
            style={{ display: "none" }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || confirming}
            style={{ ...button("primary"), opacity: uploading ? 0.5 : 1 }}
          >
            {uploading ? "Extraindo..." : header ? "Substituir tabela" : "Subir tabela"}
          </button>
          {header && (
            <button
              onClick={handleDelete}
              disabled={deleting || confirming || uploading}
              style={{ ...button("danger"), opacity: deleting ? 0.5 : 1 }}
            >
              Remover
            </button>
          )}
        </div>
      </div>

      <div style={{ color: "#8f8f9a", fontSize: 12, marginBottom: 16 }}>
        Aceita PDF, XLSX ou CSV. Parsing roda no upload; você revisa a prévia antes de confirmar.
        Unidades marcadas manualmente (estoque do corretor) não são tocadas pelo re-upload.
      </div>

      {/* Header atual */}
      {loadingHeader ? (
        <div style={{ color: "#8f8f9a", fontSize: 13 }}>Carregando...</div>
      ) : header ? (
        <div style={{ fontSize: 13, color: "#c9c9cf", marginBottom: 16 }}>
          <div>
            <strong>{header.file_name ?? "—"}</strong> · enviada por {header.uploaded_by ?? "desconhecido"} em{" "}
            {new Date(header.uploaded_at).toLocaleString("pt-BR")}
          </div>
          {header.entrega_prevista && (
            <div style={{ marginTop: 4 }}>
              Entrega prevista: <strong>{header.entrega_prevista}</strong>
            </div>
          )}
          {header.disclaimers.length > 0 && (
            <details style={{ marginTop: 8 }}>
              <summary style={{ cursor: "pointer", color: "#8f8f9a" }}>
                {header.disclaimers.length} disclaimer(s) extraído(s)
              </summary>
              <ul style={{ marginTop: 6, paddingLeft: 18 }}>
                {header.disclaimers.map((d, i) => (
                  <li key={i} style={{ marginBottom: 2 }}>{d}</li>
                ))}
              </ul>
            </details>
          )}
          {header.parse_warnings.length > 0 && (
            <details style={{ marginTop: 8 }}>
              <summary style={{ cursor: "pointer", color: "#d9a66b" }}>
                ⚠ {header.parse_warnings.length} warning(s) de parse
              </summary>
              <ul style={{ marginTop: 6, paddingLeft: 18 }}>
                {header.parse_warnings.slice(0, 20).map((w, i) => (
                  <li key={i} style={{ fontSize: 12, marginBottom: 2 }}>
                    <span style={chip("#3a2e1e", "#d9a66b")}>{w.kind}</span>{" "}
                    <strong>{w.numero ?? "?"}</strong> — {w.detalhe}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      ) : (
        <div style={{ color: "#8f8f9a", fontSize: 13, marginBottom: 16 }}>
          Nenhuma tabela cadastrada. A Bia responderá "ainda não tenho a tabela carregada"
          quando o lead perguntar de unidade específica.
        </div>
      )}

      {/* Preview em revisão */}
      {preview && (
        <div
          style={{
            ...card,
            background: "#0f1a1c",
            borderColor: "#2a4048",
            padding: 16,
          }}
        >
          <h3 style={{ margin: "0 0 10px", fontSize: 14 }}>
            Prévia · {preview.parsed.unidades.length} unidades · aguardando confirmação
          </h3>
          <div style={{ fontSize: 12, color: "#c9c9cf", marginBottom: 10 }}>
            Tipologias: {preview.parsed.tipologias_encontradas.join(", ")}
            {preview.parsed.entrega_prevista ? ` · Entrega ${preview.parsed.entrega_prevista}` : ""}
            {" · "}
            expected_version={preview.expected_version}
          </div>

          {preview.parsed.warnings.length > 0 && (
            <div
              style={{
                background: "#2a1e0e",
                border: "1px solid #4a3819",
                borderRadius: 6,
                padding: 10,
                marginBottom: 10,
                fontSize: 12,
              }}
            >
              <strong style={{ color: "#d9a66b" }}>
                ⚠ {preview.parsed.warnings.length} warning(s) — revise antes de confirmar:
              </strong>
              <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                {preview.parsed.warnings.slice(0, 10).map((w, i) => (
                  <li key={i}>
                    <span style={chip("#3a2e1e", "#d9a66b")}>{w.kind}</span>{" "}
                    <strong>{w.numero ?? "?"}</strong> — {w.detalhe}
                  </li>
                ))}
                {preview.parsed.warnings.length > 10 && (
                  <li style={{ color: "#8f8f9a" }}>
                    ... e mais {preview.parsed.warnings.length - 10}.
                  </li>
                )}
              </ul>
            </div>
          )}

          <div style={{ overflowX: "auto", marginBottom: 10 }}>
            <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#1a2a2c", color: "#8f8f9a" }}>
                  <th style={{ padding: "6px 8px", textAlign: "left" }}>Número</th>
                  <th style={{ padding: "6px 8px", textAlign: "left" }}>Tipologia</th>
                  <th style={{ padding: "6px 8px", textAlign: "right" }}>Área</th>
                  <th style={{ padding: "6px 8px", textAlign: "right" }}>Total</th>
                  <th style={{ padding: "6px 8px", textAlign: "right" }}>Sinal</th>
                  <th style={{ padding: "6px 8px", textAlign: "right" }}>Mensal × n</th>
                  <th style={{ padding: "6px 8px", textAlign: "right" }}>Saldo final</th>
                </tr>
              </thead>
              <tbody>
                {preview.parsed.unidades.slice(0, 10).map((u) => (
                  <tr key={u.numero} style={{ borderTop: "1px solid #2a3a3c" }}>
                    <td style={{ padding: "6px 8px" }}>{u.numero}</td>
                    <td style={{ padding: "6px 8px" }}>{u.tipologia}</td>
                    <td style={{ padding: "6px 8px", textAlign: "right" }}>
                      {u.area_privativa ? `${u.area_privativa} m²` : "—"}
                    </td>
                    <td style={{ padding: "6px 8px", textAlign: "right" }}>{fmtBRL(u.preco_total)}</td>
                    <td style={{ padding: "6px 8px", textAlign: "right" }}>
                      {fmtBRL(u.plano_pagamento.sinal.valor)}
                    </td>
                    <td style={{ padding: "6px 8px", textAlign: "right" }}>
                      {fmtBRL(u.plano_pagamento.mensais.valor)} × {u.plano_pagamento.mensais.parcelas}
                    </td>
                    <td style={{ padding: "6px 8px", textAlign: "right" }}>
                      {fmtBRL(u.plano_pagamento.saldo_final.valor)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ fontSize: 11, color: "#8f8f9a", marginTop: 6 }}>
              Mostrando 10 de {preview.parsed.unidades.length}.
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button onClick={() => setPreview(null)} disabled={confirming} style={button()}>
              Descartar prévia
            </button>
            <button
              onClick={handleConfirm}
              disabled={confirming}
              style={{ ...button("primary"), opacity: confirming ? 0.5 : 1 }}
            >
              {confirming ? "Gravando..." : `Confirmar e gravar v${preview.expected_version + 1}`}
            </button>
          </div>
        </div>
      )}

      {lastResult && (
        <div
          style={{
            background: "#1a2a1e",
            border: "1px solid #2b4a36",
            borderRadius: 6,
            padding: 10,
            fontSize: 13,
            color: "#6bd99b",
            marginTop: 8,
          }}
        >
          {lastResult}
        </div>
      )}
      {error && (
        <div
          style={{
            background: "#3a1818",
            border: "1px solid #8b2a2a",
            borderRadius: 6,
            padding: 10,
            fontSize: 13,
            color: "#f9a0a0",
            marginTop: 8,
          }}
        >
          <strong>Erro:</strong> {error}
        </div>
      )}
    </section>
  );
}
