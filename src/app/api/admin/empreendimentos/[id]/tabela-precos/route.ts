import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireAdminApi } from "@/lib/auth/api-guard";
import {
  confirmarTabelaPrecos,
  getTabelaPrecosHeader,
  removerTabelaPrecos,
} from "@/lib/tabela-precos";
import {
  parseTabelaPrecos,
  type ParsedTabelaPrecos,
} from "@/lib/tabela-precos-parser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Endpoints de tabela de preços:
 *
 *  - GET   → header atual + version (pra UI saber expectedVersion pro PUT)
 *  - POST  → parse preview (multipart com file). Sobe no storage em
 *            `emp/{id}/tabela-precos/`, parseia, devolve estrutura sem
 *            persistir. UI mostra warnings e o corretor confirma.
 *  - PUT   → confirma um preview. Body: { parsed, file_path, expected_version }.
 *            Aplica o upsert com lock otimista. Retorna 409 se version
 *            divergir.
 *  - DELETE → remove a tabela toda. Body: { expected_version }.
 *
 * Por que separar POST preview de PUT confirm: o parser custa tempo/token
 * (Claude). O corretor precisa ver o que o parser extraiu ANTES de commitar
 * (review de warnings aritméticos, tipologias detectadas). Commit rápido
 * pula o parser — só aplica o que já foi validado.
 */

// ─── GET ─────────────────────────────────────────────────────────────────────

export async function GET(_req: NextRequest, ctx: Ctx) {
  const gate = await requireAdminApi();
  if (gate instanceof NextResponse) return gate;
  const { id } = await ctx.params;
  const header = await getTabelaPrecosHeader(id);
  return NextResponse.json({
    ok: true,
    header,
    // version=0 quando ainda não existe header — UI usa no expected_version.
    version: header?.version ?? 0,
  });
}

// ─── POST (preview / parse) ──────────────────────────────────────────────────

export async function POST(req: NextRequest, ctx: Ctx) {
  const gate = await requireAdminApi();
  if (gate instanceof NextResponse) return gate;
  const { id } = await ctx.params;

  const sb = supabaseAdmin();
  const { data: emp, error: empErr } = await sb
    .from("empreendimentos")
    .select("id, nome")
    .eq("id", id)
    .maybeSingle();
  if (empErr) {
    return NextResponse.json({ ok: false, error: empErr.message }, { status: 500 });
  }
  if (!emp) {
    return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  }

  const form = await req.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ ok: false, error: "multipart inválido" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ ok: false, error: "arquivo ausente" }, { status: 400 });
  }

  let parsed: ParsedTabelaPrecos;
  try {
    parsed = await parseTabelaPrecos({ file, empreendimentoId: id });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }

  if (!parsed.unidades.length) {
    return NextResponse.json(
      {
        ok: false,
        error: "parser não achou unidades na tabela",
        warnings: parsed.warnings,
      },
      { status: 422 },
    );
  }

  // Sobe no storage em `emp/{id}/tabela-precos/<hash>-<nome>` — hash no path
  // evita colisão se o corretor refazer preview com mesmo nome.
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const filePath = `emp/${id}/tabela-precos/${parsed.file.hash.slice(0, 12)}-${safeName}`;
  const buf = Buffer.from(await file.arrayBuffer());
  const { error: upErr } = await sb.storage
    .from("empreendimentos")
    .upload(filePath, buf, {
      contentType: file.type || "application/octet-stream",
      upsert: true,
    });
  if (upErr) {
    return NextResponse.json(
      { ok: false, error: `upload storage falhou: ${upErr.message}` },
      { status: 500 },
    );
  }

  const header = await getTabelaPrecosHeader(id);
  return NextResponse.json({
    ok: true,
    parsed,
    file_path: filePath,
    expected_version: header?.version ?? 0,
  });
}

// ─── PUT (confirm) ───────────────────────────────────────────────────────────

export async function PUT(req: NextRequest, ctx: Ctx) {
  const gate = await requireAdminApi();
  if (gate instanceof NextResponse) return gate;
  const { id } = await ctx.params;

  const body = (await req.json().catch(() => null)) as
    | {
        parsed?: ParsedTabelaPrecos;
        file_path?: string | null;
        expected_version?: number;
      }
    | null;
  if (!body || !body.parsed || typeof body.expected_version !== "number") {
    return NextResponse.json(
      { ok: false, error: "body: { parsed, expected_version } obrigatórios" },
      { status: 400 },
    );
  }

  const result = await confirmarTabelaPrecos({
    empreendimentoId: id,
    parsed: body.parsed,
    filePath: body.file_path ?? null,
    uploadedBy: gate.user.email ?? gate.agent.id,
    expectedVersion: body.expected_version,
  });

  if (!result.ok && result.code === "version_conflict") {
    return NextResponse.json(
      {
        ok: false,
        code: "version_conflict",
        current_version: result.current_version,
        message:
          "Outro admin já atualizou a tabela. Recarregue e suba o arquivo de novo.",
      },
      { status: 409 },
    );
  }
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    header: result.header,
    inserted: result.inserted,
    updated: result.updated,
    preserved_manual: result.preserved_manual,
    orphaned: result.orphaned,
  });
}

// ─── DELETE ──────────────────────────────────────────────────────────────────

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const gate = await requireAdminApi();
  if (gate instanceof NextResponse) return gate;
  const { id } = await ctx.params;

  const body = (await req.json().catch(() => null)) as { expected_version?: number } | null;
  if (!body || typeof body.expected_version !== "number") {
    return NextResponse.json(
      { ok: false, error: "body: { expected_version } obrigatório" },
      { status: 400 },
    );
  }

  const result = await removerTabelaPrecos(id, body.expected_version);
  if (!result.ok && result.code === "version_conflict") {
    return NextResponse.json(
      {
        ok: false,
        code: "version_conflict",
        current_version: result.current_version,
      },
      { status: 409 },
    );
  }
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
