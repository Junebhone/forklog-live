// One foreground job. Dependencies are injected so lifecycle/race checks need no native or cloud runtime.
import { RecipeSchema, type Recipe } from './guards';
import type { VersionRow, saveVersion } from './db';
import type { FrameProgress } from './refFrames';
export type Clip = { uri: string; mimeType: string; durationSec: number | null; bytes: number | null; name: string };
export type ImportInputs = { clip: Clip; caption: string; variation: string; source: string };
export type ImportStage = 'queued' | 'uploading' | 'extracting' | 'review-needed' | 'ready' | 'failed';
export type ImportJob = {
  id: string; inputs: ImportInputs; stage: ImportStage; startedAt: number; demo: boolean;
  recipeId?: string; path?: string; result?: { versionId: string; recipe: Recipe };
  frames: FrameProgress | null; referencesDone: boolean; error: string | null;
  draftInputs?: ImportInputs; extractionSent: boolean; applying: boolean; pendingNotes?: string; reviewed?: ImportInputs;
};
type Dependencies = {
  createRecipe(): Promise<string>; uploadVideo(uri: string, id: string, mime: string): Promise<string>;
  extract(id: string, path: string, caption: string): Promise<{ version_id: string; recipe: unknown }>;
  getVersions(id: string): Promise<VersionRow[]>; saveVersion: typeof saveVersion;
  frames(uri: string, id: string, version: string, recipe: Recipe, progress: (p: FrameProgress) => void): Promise<void>;
};
export class ImportController {
  private job: ImportJob | null = null;
  private listeners = new Set<() => void>();
  private notices = new Set<(job: ImportJob) => void>();
  private sequence = 0;
  private running = false;
  constructor(private deps: Dependencies) {}
  getSnapshot = () => this.job;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  onNotice = (fn: (job: ImportJob) => void) => { this.notices.add(fn); return () => { this.notices.delete(fn); }; };
  get locked() { return !!this.job && (this.running || this.job.applying || !this.job.referencesDone || this.job.stage === 'review-needed'); }
  dismiss(): boolean {
    if (this.locked) return false;
    this.job = null; this.listeners.forEach(fn => fn()); return true;
  }
  editInputs(patch: Partial<ImportInputs>) {
    if (!this.job || this.job.stage === 'ready' || this.job.applying) return;
    this.update(this.job.id, { draftInputs: { ...(this.job.draftInputs ?? this.job.inputs), ...patch } });
  }
  private update(id: string, patch: Partial<ImportJob>) {
    if (this.job?.id !== id) return;
    this.job = { ...this.job, ...patch }; this.listeners.forEach(fn => fn());
  }
  private notify(id: string) { if (this.job?.id === id) this.notices.forEach(fn => fn(this.job!)); }
  start(inputs: ImportInputs, demo: boolean): boolean {
    if (this.locked) return false;
    const snapshot = JSON.parse(JSON.stringify(inputs)) as ImportInputs;
    const id = `import-${Date.now()}-${++this.sequence}`;
    this.job = { id, inputs: snapshot, demo, stage: 'queued', startedAt: Date.now(), frames: null,
      referencesDone: true, error: null, extractionSent: false, applying: false };
    this.running = true; this.listeners.forEach(fn => fn()); void this.run(id); return true;
  }
  private async run(id: string) {
    const j = this.job!;
    try {
      this.update(id, { stage: 'uploading', error: null });
      const recipeId = j.recipeId ?? await this.deps.createRecipe();
      this.update(id, { recipeId });
      const path = j.path ?? await this.deps.uploadVideo(j.inputs.clip.uri, recipeId, j.inputs.clip.mimeType);
      this.update(id, { path, stage: 'extracting', extractionSent: true });
      const data = await this.deps.extract(recipeId, path, j.inputs.caption.trim());
      const recipe = RecipeSchema.parse(data.recipe);
      if (!data.version_id) throw new Error('Extraction did not return a saved version ID.');
      this.accept(id, data.version_id, recipe);
    } catch (e) {
      this.update(id, { stage: 'failed', error: (e as Error).message });
      // The server may have committed before the response was lost. Never delete or blindly resubmit.
      const recovered = this.job?.recipeId && this.job.extractionSent ? await this.reconcile(id) : false;
      if (!recovered) this.notify(id);
    } finally { this.running = false; this.update(id, {}); }
  }
  private accept(id: string, versionId: string, recipe: Recipe) {
    if (this.job?.id !== id) return;
    const j = this.job;
    this.update(id, { stage: 'review-needed', result: { versionId, recipe }, error: null,
      referencesDone: false, frames: { done: 0, total: recipe.steps.length, succeeded: 0, failed: 0, scripted: j.demo } });
    this.notify(id);
    void this.deps.frames(j.inputs.clip.uri, j.recipeId!, versionId, recipe, p => this.update(id, { frames: p }))
      .catch(e => this.update(id, { error: `Recipe saved; reference processing failed: ${(e as Error).message}. Written cues remain available.` }))
      .finally(() => this.update(id, { referencesDone: true }));
  }
  private async reconcile(id: string): Promise<boolean> {
    const j = this.job;
    if (!j?.recipeId || j.id !== id) return false;
    try {
      const versions = await this.deps.getVersions(j.recipeId);
      const v = j.pendingNotes !== undefined
        ? versions.find(v => v.parent_id === j.result?.versionId && v.notes === j.pendingNotes)
        : versions.find(v => v.number === 1);
      if (!v) return false;
      if (j.pendingNotes !== undefined) this.update(id, { stage: 'ready', result: { versionId: v.id, recipe: v.recipe_json }, pendingNotes: undefined, error: null });
      else this.accept(id, v.id, v.recipe_json);
      return true;
    } catch (e) { this.update(id, { error: `${j.error ?? 'Unknown outcome'}. Recovery read failed: ${(e as Error).message}` }); return false; }
  }
  async retry(): Promise<void> {
    const j = this.job;
    if (!j || this.running || j.applying || j.stage !== 'failed') return;
    this.running = true; this.update(j.id, {});
    try {
      if (await this.reconcile(j.id)) return;
      if (j.extractionSent || j.pendingNotes !== undefined || !j.recipeId) {
        this.update(j.id, { error: `${this.job?.error ?? 'Request failed'}. Outcome remains unconfirmed. Recovery only; extraction/save was not resubmitted. Check again or inspect recipe history.` });
        return;
      }
      await this.run(j.id); // upload failed before any extraction request: same recipe ID, safe upload retry
    } finally { this.running = false; this.update(j.id, {}); }
  }
  async applyReview(reviewed: ImportInputs): Promise<boolean> {
    const j = this.job;
    if (!j?.result || j.stage !== 'review-needed' || !j.referencesDone || this.running || j.applying) return false;
    const notes = JSON.stringify({ import_caption: j.inputs.caption, reviewed_caption: reviewed.caption,
      variation_notes: reviewed.variation, source_attribution: reviewed.source });
    this.update(j.id, { applying: true, reviewed: JSON.parse(JSON.stringify(reviewed)), pendingNotes: notes, error: null });
    try {
      const v = await this.deps.saveVersion({ recipeId: j.recipeId!, parentId: j.result.versionId,
        recipe: j.result.recipe, diff: [], rating: null, notes });
      this.update(j.id, { stage: 'ready', result: { versionId: v.id, recipe: v.recipe_json }, pendingNotes: undefined,
        error: v.save_warnings?.join(' ') ?? null });
      return true;
    } catch (e) {
      this.update(j.id, { stage: 'failed', error: `Review save outcome unknown: ${(e as Error).message}` });
      const recovered = await this.reconcile(j.id); if (!recovered) this.notify(j.id); return recovered;
    } finally { this.update(j.id, { applying: false }); }
  }
}
