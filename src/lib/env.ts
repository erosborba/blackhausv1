import { z } from "zod";

const schema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SUPABASE_DB_URL: z.string().min(1),

  ANTHROPIC_API_KEY: z.string().min(1),
  ANTHROPIC_MODEL: z.string().default("claude-sonnet-4-6"),
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),

  // ElevenLabs TTS (Vanguard · Track 4). Voice ID default é uma voz PT-BR
  // feminina calibrada pra tom SDR ("Luna"). Trocar via env quando for
  // mapear por empreendimento/identidade do agente.
  ELEVENLABS_API_KEY: z.string().min(1),
  ELEVENLABS_VOICE_ID: z.string().default("aBaVz2FTZkqVNXrDkzMV"),
  ELEVENLABS_MODEL: z.string().default("eleven_turbo_v2_5"),

  EVOLUTION_BASE_URL: z.string().url(),
  EVOLUTION_API_KEY: z.string().min(1),
  EVOLUTION_INSTANCE: z.string().min(1),
  EVOLUTION_WEBHOOK_SECRET: z.string().min(1),

  APP_BASE_URL: z.string().url().default("http://localhost:3000"),

  // Secret pra cron job chamar /api/cron/cleanup. Vercel Cron manda
  // Authorization: Bearer <CRON_SECRET> automaticamente se a var existir.
  // Se não setada, o endpoint continua acessível só via Vercel (que passa o
  // header do ambiente). Em prod, SEMPRE setar.
  CRON_SECRET: z.string().optional(),
});

export const env = schema.parse(process.env);
export type Env = z.infer<typeof schema>;
