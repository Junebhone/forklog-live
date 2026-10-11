// Sample data for demo mode. Single source of truth: the same sample.json files the Edge Functions
// return in STUB_MODE, validated here with the app's zod schemas so a bad sample fails loudly.
import extractSample from '../supabase/functions/extract-recipe/sample.json';
import recapSample from '../supabase/functions/recap/sample.json';
import { CookDiffSchema, RecipeSchema, type CoachEvent } from './guards';

export const DEMO_RECIPE = RecipeSchema.parse(extractSample.recipe);
export const DEMO_RECAP = CookDiffSchema.parse(recapSample);

export const DEMO_IDS = { recipe: 'demo-recipe-seed', version1: 'demo-version-seed', cook: 'demo-cook-seed' } as const;

/** Stands in for a picked video on the Import screen. */
export const DEMO_CLIP = {
  uri: 'demo://garlic-soy-butter-noodles.mp4',
  mimeType: 'video/mp4',
  durationSec: 44,
  bytes: Math.round(18.6 * 1048576),
  name: 'garlic-soy-butter-noodles.mp4',
};

// ----- scripted coach -----------------------------------------------------------
// Seconds after a step starts → the event the coach "sees". Mirrors the 3-minute demo script in
// HACKATHON.md: garlic gets noted, too much soy gets corrected, lingering on garlic triggers a stop.
const base: CoachEvent = {
  ingredient_added: null, qty_estimate: null, step_state: 'in_progress', doneness: 'unknown',
  deviation: null, action: null, severity: 'info', confidence: 0.8,
};
const added = (name: string, qty: string | null): CoachEvent => ({ ...base, ingredient_added: name, qty_estimate: qty, confidence: 0.86 });
const warn = (deviation: string, action: string): CoachEvent => ({ ...base, deviation, action, severity: 'warn', confidence: 0.8 });
const stop = (deviation: string, action: string): CoachEvent => ({ ...base, deviation, action, severity: 'stop', confidence: 0.92 });
const matches = (): CoachEvent => ({ ...base, step_state: 'matches_reference', doneness: 'ready', confidence: 0.83 });

export type ScriptedEvent = { atSec: number; event: CoachEvent };

export const DEMO_COACH_SCRIPT: Record<number, ScriptedEvent[]> = {
  1: [{ atSec: 4, event: added('noodles', 'about 200 grams') }, { atSec: 16, event: matches() }],
  2: [{ atSec: 3, event: added('butter', 'about 2 tablespoons') }, { atSec: 12, event: matches() }],
  3: [
    { atSec: 3, event: added('garlic', 'about 4 cloves') },
    { atSec: 12, event: warn('Garlic is darker than the video.', 'Lower the heat a touch.') },
    { atSec: 22, event: matches() },
    { atSec: 40, event: stop('Garlic is burning.', 'Pull the pan off the heat.') },
  ],
  4: [
    { atSec: 3, event: added('soy sauce', 'about 3 tablespoons') },
    { atSec: 7, event: warn('Creator used two tablespoons of soy.', 'Creator used less soy. Add a splash of water.') },
    { atSec: 11, event: added('honey', 'about 1 tablespoon') },
    { atSec: 18, event: matches() },
  ],
  5: [{ atSec: 3, event: added('chili flakes', 'about 1 teaspoon') }, { atSec: 14, event: matches() }],
  6: [
    { atSec: 4, event: added('noodles', null) },
    { atSec: 12, event: warn('Sauce is pooling under the noodles.', 'Toss thirty seconds more.') },
    { atSec: 20, event: matches() },
  ],
  7: [{ atSec: 3, event: added('scallions', null) }, { atSec: 8, event: matches() }],
};
