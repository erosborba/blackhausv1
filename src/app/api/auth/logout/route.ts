import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/auth/supabase-server";

/**
 * POST /api/auth/logout — encerra sessão (limpa cookies) e retorna 200.
 * Cliente faz location.href = "/login" depois.
 */
export async function POST() {
  const supa = await supabaseServer();
  await supa.auth.signOut();
  return NextResponse.json({ ok: true });
}
