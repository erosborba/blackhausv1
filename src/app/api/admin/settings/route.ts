import { NextResponse, type NextRequest } from "next/server";
import { listSettings, updateSetting } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const settings = await listSettings();
    return NextResponse.json({ ok: true, data: settings });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  let body: { key: string; value: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  if (!body.key || body.value === undefined) {
    return NextResponse.json({ ok: false, error: "key e value obrigatórios" }, { status: 400 });
  }

  // Validações por chave conhecida
  if (body.key === "handoff_escalation_ms") {
    const n = Number(body.value);
    if (!Number.isFinite(n) || n < 60_000 || n > 3_600_000) {
      return NextResponse.json(
        { ok: false, error: "handoff_escalation_ms deve ser entre 60000 (1min) e 3600000 (1h)" },
        { status: 400 },
      );
    }
  }

  try {
    await updateSetting(body.key, String(body.value));
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
