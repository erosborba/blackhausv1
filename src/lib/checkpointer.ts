import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
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
