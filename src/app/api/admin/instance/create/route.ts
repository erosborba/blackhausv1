import { NextResponse } from "next/server";
import { createInstance } from "@/lib/evolution";
import { requireAdminApi } from "@/lib/auth/api-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const gate = await requireAdminApi();
  if (gate instanceof NextResponse) return gate;
  try {
    const r = await createInstance();
    return NextResponse.json({ ok: true, data: r });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
