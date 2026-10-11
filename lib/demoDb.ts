// In-memory stand-in for Supabase used by demo mode. Same shapes as lib/db.ts rows; resets on reload
// or when the user exits demo mode. Small delays keep spinners honest.
import type { CookRow, DiffItem, LibraryItem, VersionRow } from './db';
import type { CoachEvent, Recipe } from './guards';
import { DEMO_COACH_SCRIPT, DEMO_IDS, DEMO_RECAP, DEMO_RECIPE } from './demoData';

type RecipeRow = { id: string; title: string; source_summary: string | null; created_at: string };
type EventRow = { cook_id: string; step_n: number; at: string; event: CoachEvent };
type State = { recipes: RecipeRow[]; versions: VersionRow[]; cooks: CookRow[]; events: EventRow[] };

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const now = () => new Date().toISOString();
let seq = 1;
const newId = (kind: string) => `demo-${kind}-${seq++}`;

function seed(): State {
  const yesterday = new Date(Date.now() - 26 * 3600_000).toISOString();
  return {
    recipes: [{ id: DEMO_IDS.recipe, title: DEMO_RECIPE.title, source_summary: DEMO_RECIPE.source_summary, created_at: yesterday }],
    versions: [{
      id: DEMO_IDS.version1, recipe_id: DEMO_IDS.recipe, number: 1, parent_id: null, recipe_json: DEMO_RECIPE,
      diff_json: null, rating: null, notes: null, is_best: false, created_at: yesterday,
    }],
    cooks: [{
      id: DEMO_IDS.cook, recipe_id: DEMO_IDS.recipe, base_version_id: DEMO_IDS.version1,
      started_at: new Date(Date.now() - 40 * 60_000).toISOString(), ended_at: new Date(Date.now() - 20 * 60_000).toISOString(),
      rating: null, notes: null, saved_version_id: null,
    }],
    events: seedEvents(),
  };
}

/** The scripted coach events as if the seeded cook had already happened (no burnt garlic). */
function seedEvents(): EventRow[] {
  const t0 = Date.now() - 40 * 60_000;
  const out: EventRow[] = [];
  let offset = 0;
  for (const [stepN, items] of Object.entries(DEMO_COACH_SCRIPT)) {
    for (const it of items) {
      if (it.event.severity === 'stop') continue;
      out.push({ cook_id: DEMO_IDS.cook, step_n: Number(stepN), at: new Date(t0 + (offset + it.atSec) * 1000).toISOString(), event: it.event });
    }
    offset += 90;
  }
  return out;
}

let state = seed();
export function resetDemo() { state = seed(); }

function requireRecipe(id: string) {
  const r = state.recipes.find(x => x.id === id);
  if (!r) throw new Error('Recipe not found (demo)');
  return r;
}

export const demoDb = {
  async listLibrary(): Promise<LibraryItem[]> {
    await sleep(120);
    return [...state.recipes]
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map(r => {
        const vs = state.versions.filter(v => v.recipe_id === r.id);
        const ratings = vs.map(v => v.rating).filter((x): x is number => typeof x === 'number');
        return {
          id: r.id, title: r.title, source_summary: r.source_summary, created_at: r.created_at,
          latest: vs.reduce((m, v) => Math.max(m, v.number), 0),
          version_count: vs.length,
          best_rating: ratings.length ? Math.max(...ratings) : null,
        };
      });
  },

  async getRecipeTitle(recipeId: string) { return requireRecipe(recipeId).title; },

  async createRecipe(): Promise<string> {
    const id = newId('recipe');
    state.recipes.unshift({ id, title: 'Importing…', source_summary: null, created_at: now() });
    return id;
  },

  async setRecipeVideoPath() { /* nothing to store */ },

  async deleteRecipe(recipeId: string) {
    state.recipes = state.recipes.filter(r => r.id !== recipeId);
    state.versions = state.versions.filter(v => v.recipe_id !== recipeId);
    state.cooks = state.cooks.filter(c => c.recipe_id !== recipeId);
  },

  async uploadVideo(_uri: string, recipeId: string): Promise<string> {
    await sleep(1400);
    return `${recipeId}/source.mp4`;
  },

  async getVersions(recipeId: string): Promise<VersionRow[]> {
    await sleep(80);
    return state.versions.filter(v => v.recipe_id === recipeId).sort((a, b) => b.number - a.number);
  },

  async getVersion(versionId: string): Promise<VersionRow> {
    const v = state.versions.find(x => x.id === versionId);
    if (!v) throw new Error('Version not found (demo)');
    return v;
  },

  async getLatestVersion(recipeId: string): Promise<VersionRow> {
    const vs = await demoDb.getVersions(recipeId);
    if (!vs[0]) throw new Error('This recipe has no versions yet.');
    return vs[0];
  },

  async saveVersion(opts: { recipeId: string; parentId: string; recipe: Recipe; diff: DiffItem[]; rating: number | null; notes: string; cookId: string }): Promise<VersionRow> {
    await sleep(300);
    const vs = await demoDb.getVersions(opts.recipeId);
    const row: VersionRow = {
      id: newId('version'), recipe_id: opts.recipeId, number: (vs[0]?.number ?? 0) + 1, parent_id: opts.parentId,
      recipe_json: opts.recipe, diff_json: opts.diff, rating: opts.rating, notes: opts.notes || null, is_best: false, created_at: now(),
    };
    state.versions.push(row);
    const cook = state.cooks.find(c => c.id === opts.cookId);
    if (cook) { cook.saved_version_id = row.id; cook.rating = opts.rating; cook.notes = opts.notes || null; }
    const r = state.recipes.find(x => x.id === opts.recipeId);
    if (r) r.title = opts.recipe.title;
    return row;
  },

  async setBestVersion(recipeId: string, versionId: string) {
    for (const v of state.versions) if (v.recipe_id === recipeId) v.is_best = v.id === versionId;
  },

  async startCook(recipeId: string, versionId: string): Promise<string> {
    const id = newId('cook');
    state.cooks.push({ id, recipe_id: recipeId, base_version_id: versionId, started_at: now(), ended_at: null, rating: null, notes: null, saved_version_id: null });
    return id;
  },

  async endCook(cookId: string) {
    const c = state.cooks.find(x => x.id === cookId);
    if (c) c.ended_at = now();
  },

  async getCook(cookId: string): Promise<CookRow> {
    const c = state.cooks.find(x => x.id === cookId);
    if (!c) throw new Error('Cook not found (demo)');
    return c;
  },

  async countCookEvents(cookId: string) { return state.events.filter(e => e.cook_id === cookId).length; },

  recordEvent(cookId: string, stepN: number, event: CoachEvent) {
    state.events.push({ cook_id: cookId, step_n: stepN, at: now(), event });
  },
};

/** Demo replacement for supabase.functions.invoke — same response shapes as the real Edge Functions. */
export async function demoInvoke<T>(name: string, body: Record<string, unknown>): Promise<T> {
  switch (name) {
    case 'extract-recipe': {
      await sleep(2600);
      const recipeId = String(body.recipe_id);
      const ver: VersionRow = {
        id: newId('version'), recipe_id: recipeId, number: 1, parent_id: null, recipe_json: DEMO_RECIPE,
        diff_json: null, rating: null, notes: null, is_best: false, created_at: now(),
      };
      state.versions.push(ver);
      const r = state.recipes.find(x => x.id === recipeId);
      if (r) { r.title = DEMO_RECIPE.title; r.source_summary = DEMO_RECIPE.source_summary; }
      return { ok: true, version_id: ver.id, recipe: DEMO_RECIPE } as T;
    }
    case 'recap': {
      await sleep(1800);
      const cook = state.cooks.find(c => c.id === body.cook_id);
      const rating = typeof body.rating === 'number' ? body.rating : null;
      const notes = typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null;
      if (cook) { cook.ended_at = now(); cook.rating = rating; cook.notes = notes; }
      return {
        ok: true,
        ...DEMO_RECAP,
        proposed_version: { ...DEMO_RECAP.proposed_version, notes: notes ?? DEMO_RECAP.proposed_version.notes },
      } as T;
    }
    case 'coach-frame': {
      const first = DEMO_COACH_SCRIPT[Number(body.step_n) || 1]?.[0]?.event;
      return { ok: true, event: first } as T;
    }
    case 'tts':
      throw new Error('tts: not available in demo mode');
    default:
      throw new Error(`${name}: not available in demo mode`);
  }
}
