import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/auth/supabase-server";

/**
 * POST /api/auth/verify — verifica código OTP de 6 dígitos e abre sessão.
 *
 * Substitui o fluxo de magic-link. O cliente manda { email, token } →
 * `verifyOtp` troca por sessão (cookies httpOnly setados via SSR client) →
 * cliente redireciona pro `next`.
 */
const bodySchema = z.object({
  email: z.string().email().max(200).transform((s) => s.trim().toLowerCase()),
  token: z
    .string()
    .trim()
    .regex(/^\d{4,10}$/, "token deve ser numérico (4-10 dígitos)"),
  next: z.string().optional(),
});

export async function POST(req: Request) {
  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
  }
  const { email, token, next } = parsed;

  const supa = await supabaseServer();

  // Tenta "email" primeiro (usuário existente); se falhar, tenta "signup"
  // (primeiro login — auth.users ainda não criado). Supabase não dá pra
  // saber o tipo antes de tentar.
  const first = await supa.auth.verifyOtp({ email, token, type: "email" });
  let error = first.error;
  if (error) {
    console.warn("[auth/verify] type=email falhou:", {
      status: error.status,
      code: error.code,
      message: error.message,
    });
    const fallback = await supa.auth.verifyOtp({ email, token, type: "signup" });
    if (!fallback.error) {
      error = null;
    } else {
      console.warn("[auth/verify] type=signup falhou:", {
        status: fallback.error.status,
        code: fallback.error.code,
        message: fallback.error.message,
      });
    }
  }

  if (error) {
    const msg = error.message?.toLowerCase() ?? "";
    const code = msg.includes("expired") ? "otp_expired" : "invalid_token";
    return NextResponse.json({ ok: false, error: code }, { status: 400 });
  }

  const safeNext =
    next && next.startsWith("/") && !next.startsWith("//") ? next : "/brief";
  return NextResponse.json({ ok: true, next: safeNext });
}
