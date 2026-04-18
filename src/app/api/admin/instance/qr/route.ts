import { NextResponse } from "next/server";
import { fetchQrCode } from "@/lib/evolution";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const r = await fetchQrCode();
    return NextResponse.json({ ok: true, data: r });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
