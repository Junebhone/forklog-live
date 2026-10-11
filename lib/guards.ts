// Guards: zod schemas for every model output, confidence thresholds, alert throttling,
// and food-safety filters. Copy to supabase/functions/_shared/guards.ts for Edge Functions.
import { z } from 'zod';

// ----- thresholds ---------------------------------------------------------
export const CONF = {
  ingredient: 0.6,   // show detection chip
  deviation: 0.7,    // speak a correction
  stepMatch: 0.75,   // auto-advance prompt
  diffItem: 0.6,     // include in saved diff
  recipeQty: 0.5,    // below this, show qty as "~" and ask user to confirm on review screen
} as const;

export const RAW_PROTEIN = /\b(chicken|beef|pork|lamb|turkey|shrimp|prawn|fish|salmon|tuna|egg|eggs|mince|ground)\b/i;

// ----- schemas ------------------------------------------------------------
export const IngredientSchema = z.object({
  name: z.string().min(1),
  qty: z.string(),
  unit: z.string(),
  confidence: z.number().min(0).max(1),
  evidence: z.enum(['spoken', 'visual', 'text', 'inferred']),
});

export const StepSchema = z.object({
  n: z.number().int().positive(),
  text: z.string().min(1).max(200),
  ingredients: z.array(z.string()),
  action: z.enum(['prep', 'heat', 'add', 'stir', 'simmer', 'fry', 'bake', 'rest', 'plate', 'other']),
  duration_sec: z.number().nullable(),
  visual_cue: z.string(),
  ref_frame_sec: z.number().nonnegative(),
  common_mistakes: z.array(z.string()).max(2),
});

export const RecipeSchema = z.object({
  title: z.string().min(1),
  source_summary: z.string(),
  servings: z.number().nullable(),
  total_minutes: z.number().nullable(),
  ingredients: z.array(IngredientSchema).min(1),
  steps: z.array(StepSchema).min(1),
  equipment: z.array(z.string()),
  warnings: z.array(z.string()),
  notes: z.string().optional(),
});
export type Recipe = z.infer<typeof RecipeSchema>;

export const CoachEventSchema = z.object({
  ingredient_added: z.string().nullable(),
  qty_estimate: z.string().nullable(),
  step_state: z.enum(['not_started', 'in_progress', 'matches_reference', 'overdone']),
  doneness: z.enum(['under', 'ready', 'over', 'unknown']),
  deviation: z.string().nullable(),
  action: z.string().nullable(),
  severity: z.enum(['info', 'warn', 'stop']),
  confidence: z.number().min(0).max(1),
});
export type CoachEvent = z.infer<typeof CoachEventSchema>;

export const DiffItemSchema = z.object({
  type: z.enum(['added', 'removed', 'changed_qty', 'changed_time', 'reordered', 'skipped']),
  step_n: z.number().nullable(),
  field: z.string(),
  from: z.string().nullable(),
  to: z.string().nullable(),
  confidence: z.number().min(0).max(1),
});

export const CookDiffSchema = z.object({
  diff: z.array(DiffItemSchema),
  proposed_version: RecipeSchema,
  spoken_recap: z.string().max(240),
  suggestion: z.string().nullable(),
});
export type CookDiff = z.infer<typeof CookDiffSchema>;

// ----- parsing ------------------------------------------------------------
export function parseModelJson<T>(schema: z.ZodSchema<T>, raw: string): { ok: true; data: T } | { ok: false; error: string } {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end < 0) return { ok: false, error: 'no json object' };
  try {
    const parsed = schema.safeParse(JSON.parse(cleaned.slice(start, end + 1)));
    return parsed.success ? { ok: true, data: parsed.data } : { ok: false, error: parsed.error.message };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// ----- coach event post-filter ----------------------------------------------
// Applies confidence + safety rules AFTER schema validation. Returns a possibly muted event.
export function filterCoachEvent(ev: CoachEvent, stepText: string): CoachEvent {
  const out = { ...ev };
  if (out.confidence < CONF.ingredient) out.ingredient_added = null;
  if (out.confidence < CONF.deviation) { out.deviation = null; out.action = null; }
  if (out.step_state === 'matches_reference' && out.confidence < CONF.stepMatch) out.step_state = 'in_progress';
  // Never declare raw protein ready from vision alone.
  if (RAW_PROTEIN.test(stepText) && out.doneness === 'ready') {
    out.doneness = 'unknown';
    out.action = 'Check with a thermometer or cut to confirm.';
  }
  // "stop" always speaks regardless of confidence, but must have an action.
  if (out.severity === 'stop' && !out.action) out.action = 'Pause. Check the pan.';
  return out;
}

// ----- alert throttling -----------------------------------------------------
// Prevents the voice from nagging. One line per key per window; "stop" bypasses the window.
export class AlertGate {
  private last = new Map<string, number>();
  constructor(private windowMs = 20_000, private maxWords = 14) {}

  allow(key: string, severity: 'info' | 'warn' | 'stop' = 'info', now = Date.now()): boolean {
    if (severity === 'stop') { this.last.set(key, now); return true; }
    const t = this.last.get(key) ?? 0;
    if (now - t < this.windowMs) return false;
    this.last.set(key, now);
    return true;
  }

  /** Trim a line to the word budget so TTS stays snappy. */
  clamp(line: string): string {
    const words = line.trim().split(/\s+/);
    return words.length <= this.maxWords ? line.trim() : words.slice(0, this.maxWords).join(' ') + '.';
  }

  reset() { this.last.clear(); }
}

// ----- scene change ----------------------------------------------------------
// Cheap "did anything change" check on a tiny grayscale thumbnail (e.g. 16x16 luma array).
export function sceneChanged(prev: Uint8Array | null, next: Uint8Array, threshold = 18): boolean {
  if (!prev || prev.length !== next.length) return true;
  let sum = 0;
  for (let i = 0; i < next.length; i++) sum += Math.abs(next[i] - prev[i]);
  return sum / next.length > threshold;
}

// ----- input guards -----------------------------------------------------------
export const VIDEO_LIMITS = { maxSeconds: 180, maxBytes: 120 * 1024 * 1024, allowed: ['video/mp4', 'video/quicktime'] };
export const FRAME_LIMITS = { maxWidth: 512, jpegQuality: 0.5, minIntervalMs: 2000, maxInFlight: 1 };
