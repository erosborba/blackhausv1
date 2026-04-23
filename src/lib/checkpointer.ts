import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import pg from "pg";
import { env } from "./env";

let _saver: PostgresSaver | null = null;
let _setupPromise: Promise<void> | null = null;

export async function checkpointer(): Promise<PostgresSaver> {
  if (_saver && _setupPromise) {
    await _setupPromise;
    return _saver;
  }
  _saver = PostgresSaver.fromConnString(env.SUPABASE_DB_URL);
  _setupPromise = _saver.setup();
  await _setupPromise;
  return _saver;
}

/**
 * Apaga o checkpoint de um `thread_id`. Usado pelo eval harness pra isolar
 * runs: sem isso, o thread `lead:<conv.id>` acumula mensagens entre rodadas
 * e a Bia passa a "ver" a mesma pergunta repetida N vezes, escalando por
 * conta própria. Não usar em produção (lead real perde continuidade).
 */
let _pool: pg.Pool | null = null;
export async function clearCheckpointThread(threadId: string): Promise<void> {
  if (!_pool) _pool = new pg.Pool({ connectionString: env.SUPABASE_DB_URL });
  const client = await _pool.connect();
  try {
    await client.query("DELETE FROM checkpoints WHERE thread_id = $1", [threadId]);
    await client.query("DELETE FROM checkpoint_blobs WHERE thread_id = $1", [threadId]);
    await client.query("DELETE FROM checkpoint_writes WHERE thread_id = $1", [threadId]);
  } finally {
    client.release();
  }
}
