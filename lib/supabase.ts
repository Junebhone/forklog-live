import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL!,
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } }, // no auth for the hackathon; single demo user
);

export const DEMO_USER_ID = '00000000-0000-0000-0000-000000000001';
