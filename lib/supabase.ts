import { createClient } from '@supabase/supabase-js';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

/** False until .env has EXPO_PUBLIC_SUPABASE_URL + ANON_KEY. Screens show a setup hint instead of crashing. */
export const supabaseConfigured = Boolean(url && anon);

export const supabase = createClient(
  url ?? 'http://localhost:54321',
  anon ?? 'missing-anon-key',
  { auth: { persistSession: false } }, // no auth for the hackathon; single demo user
);

export const DEMO_USER_ID = '00000000-0000-0000-0000-000000000001';

/** Unwrap a Supabase Edge Function response: throws a readable error on transport or `ok: false`. */
export async function invokeFn<T extends { ok: boolean }>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T & { error?: string }>(name, { body });
  if (error) throw new Error(`${name}: ${error.message}`);
  if (!data) throw new Error(`${name}: empty response`);
  if (!data.ok) throw new Error(`${name}: ${data.error ?? 'failed'}`);
  return data;
}
