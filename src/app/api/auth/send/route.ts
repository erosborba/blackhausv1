import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/auth/supabase-server";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * POST /api/auth/send — dispara magic-link pro email.
 *
 * Valida que o email existe em `public.agents.email` antes de mandar —
 * assim evitamos criar auth.users "órfãos" de spam/digitação errada. O
 * próprio Supabase cria o auth.users no clique do link, e nosso trigger
 * `link_agent_on_user_signup` amarra em agents por email.
 *
 * Retorna 200 mesmo se o email não existir no agents (anti-enumeração
 * cautelosa — mas loga no servidor pra debug).
 */
const bodySchema = z.object({
  email: z.string().email().max(200).transform((s) => s.trim().toLowerCase()),
});

export async function POST(req: Request) {
  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
  }
  const { email } = parsed;

  // Lookup em agents — só dispara link se for pre-cadastrado e ativo.
  const admin = supabaseAdmin();
  const { data: agent } = await admin
    .from("agents")
    .select("id, active")
    .ilike("email", email)
    .maybeSingle();

  if (!agent || agent.active === false) {
    console.warn("[auth/send] email not in agents table:", email);
    // Retorna ok genérico pra não enumerar emails válidos.
    return NextResponse.json({ ok: true });
  }

  const supa = await supabaseServer();
  const origin = process.env.APP_BASE_URL ?? new URL(req.url).origin;
  const redirectTo = `${origin}/api/auth/callback`;

  const { error } = await supa.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: redirectTo,
      shouldCreateUser: true,
    },
  });

  if (error) {
    console.error("[auth/send]", error);
    return NextResponse.json({ ok: false, error: "send_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
