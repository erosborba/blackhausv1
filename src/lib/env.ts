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

  EVOLUTION_BASE_URL: z.string().url(),
  EVOLUTION_API_KEY: z.string().min(1),
  EVOLUTION_INSTANCE: z.string().min(1),
  EVOLUTION_WEBHOOK_SECRET: z.string().min(1),

  APP_BASE_URL: z.string().url().default("http://localhost:3000"),
});

export const env = schema.parse(process.env);
export type Env = z.infer<typeof schema>;
