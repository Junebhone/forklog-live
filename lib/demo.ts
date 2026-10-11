// Demo mode switch. When on, lib/db.ts, invokeFn, VisionLoop, refFrames and the speaker run against
// in-memory sample data (lib/demoDb.ts) with a scripted coach and device text-to-speech — no backend needed.
// Starts ON when no Supabase keys are configured, so a fresh checkout runs end to end in Expo Go.
import { useSyncExternalStore } from 'react';

const configured = Boolean(process.env.EXPO_PUBLIC_SUPABASE_URL && process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY);
let on = !configured;
const subs = new Set<() => void>();

export function isDemoMode() { return on; }

export function setDemoMode(v: boolean) {
  if (on === v) return;
  on = v;
  subs.forEach(f => f());
}

export function useDemoMode(): boolean {
  return useSyncExternalStore(
    cb => { subs.add(cb); return () => { subs.delete(cb); }; },
    () => on,
    () => on,
  );
}
