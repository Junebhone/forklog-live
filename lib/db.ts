// Thin typed data layer over Supabase. Every recipe_json / diff_json read is validated with zod before use.
import { z } from 'zod';
import { File } from 'expo-file-system';
import { supabase, DEMO_USER_ID } from './supabase';
import { RecipeSchema, DiffItemSchema, type Recipe } from './guards';
import { isDemoMode } from './demo';
import { demoDb } from './demoDb';

export type DiffItem = z.infer<typeof DiffItemSchema>;

export const VersionRowSchema = z.object({
  id: z.string(),
  recipe_id: z.string(),
  number: z.number().int(),
  parent_id: z.string().nullable(),
  recipe_json: RecipeSchema,
  diff_json: z.array(DiffItemSchema).nullable(),
  rating: z.number().nullable(),
  notes: z.string().nullable(),
  is_best: z.boolean().nullable(),
  created_at: z.string(),
});
export type VersionRow = z.infer<typeof VersionRowSchema>;

export const CookRowSchema = z.object({
  id: z.string(),
  recipe_id: z.string(),
  base_version_id: z.string(),
  started_at: z.string(),
  ended_at: z.string().nullable(),
  rating: z.number().nullable(),
  notes: z.string().nullable(),
  saved_version_id: z.string().nullable(),
});
export type CookRow = z.infer<typeof CookRowSchema>;

export type LibraryItem = {
  id: string;
  title: string;
  source_summary: string | null;
  created_at: string;
  latest: number;
  version_count: number;
  best_rating: number | null;
};

function fail(ctx: string, error: { message: string } | null): never {
  throw new Error(`${ctx}: ${error?.message ?? 'unknown error'}`);
}

// ----- recipes ---------------------------------------------------------------

export async function listLibrary(): Promise<LibraryItem[]> {
  if (isDemoMode()) return demoDb.listLibrary();
  const { data, error } = await supabase
    .from('recipes')
    .select('id,title,source_summary,created_at,versions(number,rating)')
    .order('created_at', { ascending: false });
  if (error) fail('listLibrary', error);
  type Row = { id: string; title: string; source_summary: string | null; created_at: string; versions: { number: number; rating: number | null }[] | null };
  return ((data ?? []) as Row[]).map(r => {
    const vs = r.versions ?? [];
    const ratings = vs.map(v => v.rating).filter((x): x is number => typeof x === 'number');
    return {
      id: r.id,
      title: r.title,
      source_summary: r.source_summary,
      created_at: r.created_at,
      latest: vs.reduce((m, v) => Math.max(m, v.number), 0),
      version_count: vs.length,
      best_rating: ratings.length ? Math.max(...ratings) : null,
    };
  });
}

export async function getRecipeTitle(recipeId: string): Promise<string> {
  if (isDemoMode()) return demoDb.getRecipeTitle(recipeId);
  const { data, error } = await supabase.from('recipes').select('title').eq('id', recipeId).single();
  if (error) fail('getRecipeTitle', error);
  return (data as { title: string }).title;
}

export async function createRecipe(): Promise<string> {
  if (isDemoMode()) return demoDb.createRecipe();
  const { data, error } = await supabase
    .from('recipes')
    .insert({ user_id: DEMO_USER_ID, title: 'Importing…' })
    .select('id')
    .single();
  if (error) fail('createRecipe', error);
  return (data as { id: string }).id;
}

export async function setRecipeVideoPath(recipeId: string, path: string) {
  if (isDemoMode()) return demoDb.setRecipeVideoPath();
  const { error } = await supabase.from('recipes').update({ source_video_path: path }).eq('id', recipeId);
  if (error) fail('setRecipeVideoPath', error);
}

export async function deleteRecipe(recipeId: string) {
  if (isDemoMode()) return demoDb.deleteRecipe(recipeId);
  const { error } = await supabase.from('recipes').delete().eq('id', recipeId);
  if (error) fail('deleteRecipe', error);
}

/** Upload the picked video to bucket "videos". Returns the storage path. */
export async function uploadVideo(localUri: string, recipeId: string, mimeType: string): Promise<string> {
  if (isDemoMode()) return demoDb.uploadVideo(localUri, recipeId);
  const ext = mimeType.includes('quicktime') || localUri.toLowerCase().endsWith('.mov') ? 'mov' : 'mp4';
  const path = `${recipeId}/source.${ext}`;
  const bytes = await new File(localUri).arrayBuffer();
  const { error } = await supabase.storage.from('videos').upload(path, bytes, { contentType: mimeType, upsert: true });
  if (error) fail('uploadVideo', error);
  await setRecipeVideoPath(recipeId, path);
  return path;
}

// ----- versions --------------------------------------------------------------

function parseVersions(rows: unknown[], ctx: string): VersionRow[] {
  const out: VersionRow[] = [];
  for (const r of rows) {
    const p = VersionRowSchema.safeParse(r);
    if (p.success) out.push(p.data);
    else console.warn(`${ctx}: skipping invalid version row`, p.error.issues[0]?.message);
  }
  return out;
}

export async function getVersions(recipeId: string): Promise<VersionRow[]> {
  if (isDemoMode()) return demoDb.getVersions(recipeId);
  const { data, error } = await supabase.from('versions').select('*').eq('recipe_id', recipeId).order('number', { ascending: false });
  if (error) fail('getVersions', error);
  return parseVersions(data ?? [], 'getVersions');
}

export async function getVersion(versionId: string): Promise<VersionRow> {
  if (isDemoMode()) return demoDb.getVersion(versionId);
  const { data, error } = await supabase.from('versions').select('*').eq('id', versionId).single();
  if (error) fail('getVersion', error);
  const p = VersionRowSchema.safeParse(data);
  if (!p.success) throw new Error(`getVersion: invalid recipe data (${p.error.issues[0]?.message})`);
  return p.data;
}

export async function getLatestVersion(recipeId: string): Promise<VersionRow> {
  if (isDemoMode()) return demoDb.getLatestVersion(recipeId);
  const { data, error } = await supabase.from('versions').select('*').eq('recipe_id', recipeId).order('number', { ascending: false }).limit(1);
  if (error) fail('getLatestVersion', error);
  const rows = parseVersions(data ?? [], 'getLatestVersion');
  if (!rows[0]) throw new Error('This recipe has no versions yet.');
  return rows[0];
}

export async function saveVersion(opts: {
  recipeId: string;
  parentId: string;
  recipe: Recipe;
  diff: DiffItem[];
  rating: number | null;
  notes: string;
  cookId: string;
}): Promise<VersionRow> {
  if (isDemoMode()) return demoDb.saveVersion(opts);
  const existing = await getVersions(opts.recipeId);
  const number = (existing[0]?.number ?? 0) + 1;
  const { data, error } = await supabase
    .from('versions')
    .insert({ recipe_id: opts.recipeId, number, parent_id: opts.parentId, recipe_json: opts.recipe, diff_json: opts.diff, rating: opts.rating, notes: opts.notes || null })
    .select('*')
    .single();
  if (error) fail('saveVersion', error);
  const p = VersionRowSchema.safeParse(data);
  if (!p.success) throw new Error('saveVersion: row came back malformed');
  const saved = p.data;

  // Reuse the parent's reference frames so cooking the new version still gets creator images.
  const { data: frames } = await supabase.from('ref_frames').select('step_n,storage_path').eq('version_id', opts.parentId);
  if (frames?.length) {
    await supabase.from('ref_frames').upsert((frames as { step_n: number; storage_path: string }[]).map(f => ({ ...f, version_id: saved.id })));
  }
  await supabase.from('cooks').update({ saved_version_id: saved.id, rating: opts.rating, notes: opts.notes || null }).eq('id', opts.cookId);
  await supabase.from('recipes').update({ title: opts.recipe.title }).eq('id', opts.recipeId);
  return saved;
}

export async function setBestVersion(recipeId: string, versionId: string) {
  if (isDemoMode()) return demoDb.setBestVersion(recipeId, versionId);
  await supabase.from('versions').update({ is_best: false }).eq('recipe_id', recipeId);
  const { error } = await supabase.from('versions').update({ is_best: true }).eq('id', versionId);
  if (error) fail('setBestVersion', error);
}

// ----- cooks -----------------------------------------------------------------

export async function startCook(recipeId: string, versionId: string): Promise<string> {
  if (isDemoMode()) return demoDb.startCook(recipeId, versionId);
  const { data, error } = await supabase.from('cooks').insert({ recipe_id: recipeId, base_version_id: versionId }).select('id').single();
  if (error) fail('startCook', error);
  return (data as { id: string }).id;
}

export async function endCook(cookId: string) {
  if (isDemoMode()) return demoDb.endCook(cookId);
  const { error } = await supabase.from('cooks').update({ ended_at: new Date().toISOString() }).eq('id', cookId);
  if (error) fail('endCook', error);
}

export async function getCook(cookId: string): Promise<CookRow> {
  if (isDemoMode()) return demoDb.getCook(cookId);
  const { data, error } = await supabase.from('cooks').select('*').eq('id', cookId).single();
  if (error) fail('getCook', error);
  const p = CookRowSchema.safeParse(data);
  if (!p.success) throw new Error('getCook: malformed row');
  return p.data;
}

export async function countCookEvents(cookId: string): Promise<number> {
  if (isDemoMode()) return demoDb.countCookEvents(cookId);
  const { count, error } = await supabase.from('cook_events').select('id', { count: 'exact', head: true }).eq('cook_id', cookId);
  if (error) fail('countCookEvents', error);
  return count ?? 0;
}
