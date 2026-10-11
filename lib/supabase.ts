import { createClient } from '@supabase/supabase-js';
import { isDemoMode } from './demo';
import { demoInvoke } from './demoDb';
import { ADAPTATION_CONTRACT } from './recipeOptions';

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

/** An old deployed function must never silently coach an adapted version using source expectations. */
export async function requireAdaptationBackend() {
  if (isDemoMode()) return;
  const responses = await Promise.all(['coach-frame', 'recap'].map(name => supabase.functions.invoke(name, { body: { capability_check: true } })));
  if (responses.some(({ data, error }) => error || data?.adaptation_contract !== ADAPTATION_CONTRACT)) {
    throw new Error('Adapted coaching is paused: deployed coach-frame and recap functions must support ingredient-options-v1. Ask the teammate to review/deploy the updated functions; retry after they are ready.');
  }
}

/** Unwrap a Supabase Edge Function response: throws a readable error on transport or `ok: false`. */
export async function invokeFn<T extends { ok: boolean }>(name: string, body: Record<string, unknown>): Promise<T> {
  if (isDemoMode()) return demoInvoke<T>(name, body);
  const { data, error } = await supabase.functions.invoke<T & { error?: string }>(name, { body });
  if (error) throw new Error(`${name}: ${error.message}`);
  if (!data) throw new Error(`${name}: empty response`);
  if (!data.ok) throw new Error(`${name}: ${data.error ?? 'failed'}`);
  return data;
}
