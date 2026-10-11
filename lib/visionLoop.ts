// Live coaching loop: capture → downscale → scene check → coach-frame Edge Function → filtered event.
// Cadence rules (CLAUDE.md): send only when the scene changed AND ≥2 s since the last send; max 1 in flight.
import type { RefObject } from 'react';
import type { CameraView } from 'expo-camera';
import { supabase, requireAdaptationBackend } from './supabase';
import { base64ToBytes, deleteQuietly, resizeJpeg } from './image';
import { CoachEventSchema, filterCoachEvent, sceneChanged, FRAME_LIMITS, type CoachEvent, type Recipe } from './guards';
import { isDemoMode } from './demo';
import { DEMO_COACH_SCRIPT } from './demoData';
import { demoDb } from './demoDb';
import { adaptCoachEvent, hasAdaptations, stepOptions } from './recipeOptions';

type Listener = (ev: CoachEvent, stepN: number) => void;
export type VisionStats = { sent: number; ok: number; skipped: number; lastLatencyMs: number | null; lastError: string | null; processing: boolean; startedAt: number | null; scripted: boolean | null };

export class VisionLoop {
  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight = 0;
  private lastSent = 0;
  private prevThumb: Uint8Array | null = null;
  private detected = new Set<string>();
  private stepStartedAt = Date.now();
  private stats: VisionStats = { sent: 0, ok: 0, skipped: 0, lastLatencyMs: null, lastError: null, processing: false, startedAt: null, scripted: null };
  private revision = 0;
  private active = false;
  private backendReady = false;
  private demoFired = new Set<string>();
  stepN = 1;

  constructor(
    private camera: RefObject<CameraView | null>,
    private recipe: Recipe,
    private recipeId: string,
    private cookId: string,
    private onEvent: Listener,
    private onStats?: (s: VisionStats) => void,
  ) {}

  start() {
    if (this.timer) return;
    this.active = true;
    this.revision++;
    this.timer = setInterval(() => void this.tick(), 700);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.active = false;
    this.revision++;
  }

  setStep(n: number) {
    this.revision++;
    this.stepN = n;
    this.stepStartedAt = Date.now();
    this.detected.clear();
    this.prevThumb = null; // force a send on the new step
    this.demoFired.clear();
  }

  private emitStats() { this.onStats?.({ ...this.stats }); }

  /** Demo mode: no camera, no network. Replays the scripted events for the current step on the same cadence. */
  private tickDemo(now: number) {
    const step = this.recipe.steps.find(s => s.n === this.stepN);
    if (!step) return;
    const elapsed = (now - this.stepStartedAt) / 1000;
    let fired = false;
    for (const item of DEMO_COACH_SCRIPT[this.stepN] ?? []) {
      const key = `${this.stepN}:${item.atSec}`;
      if (elapsed < item.atSec || this.demoFired.has(key)) continue;
      this.demoFired.add(key);
      this.stats.lastLatencyMs = null; // scripted events are not a latency measurement
      this.stats.scripted = true;
      const adapted = adaptCoachEvent(item.event, this.recipe, this.stepN, true);
      if (!adapted) continue;
      fired = true;
      this.stats.sent++;
      this.stats.ok++;
      const ev = filterCoachEvent(adapted, step.text);
      if (ev.ingredient_added) this.detected.add(ev.ingredient_added);
      demoDb.recordEvent(this.cookId, this.stepN, ev);
      this.onEvent(ev, this.stepN);
    }
    if (now - this.lastSent >= FRAME_LIMITS.minIntervalMs) {
      this.lastSent = now;
      if (!fired) this.stats.skipped++;
    }
    this.emitStats();
  }

  private async tick() {
    if (!this.active) return;
    const now = Date.now();
    if (isDemoMode()) { this.tickDemo(now); return; }
    if (this.inFlight >= FRAME_LIMITS.maxInFlight) return;
    if (now - this.lastSent < FRAME_LIMITS.minIntervalMs) return;
    const { step, allOmitted } = stepOptions(this.recipe, this.stepN);
    if (!step || allOmitted) return;
    const cam = this.camera.current;
    if (!cam) return;

    this.inFlight++;
    const revision = this.revision;
    const stepN = this.stepN;
    const isCurrent = () => this.active && this.revision === revision;
    this.stats.processing = true;
    this.stats.startedAt = now;
    this.emitStats();
    let shotUri: string | undefined;
    let smallUri: string | undefined;
    let thumbUri: string | undefined;
    try {
      if (hasAdaptations(this.recipe) && !this.backendReady) {
        this.lastSent = now;
        await requireAdaptationBackend();
        if (!isCurrent()) return;
        this.backendReady = true;
      }
      const shot = await cam.takePictureAsync({ quality: FRAME_LIMITS.jpegQuality, skipProcessing: true, shutterSound: false });
      if (!shot?.uri) return;
      shotUri = shot.uri;
      if (!isCurrent()) return;

      // Tiny thumbnail as a cheap "did anything change" check (compressed bytes, not true luma — good enough to skip a static counter).
      const thumb = await resizeJpeg(shot.uri, 16, 0.3);
      thumbUri = thumb.uri;
      if (!isCurrent()) return;
      const thumbBytes = base64ToBytes(thumb.base64);
      if (!sceneChanged(this.prevThumb, thumbBytes)) { this.stats.skipped++; this.emitStats(); return; }
      this.prevThumb = thumbBytes;

      const small = await resizeJpeg(shot.uri, FRAME_LIMITS.maxWidth, FRAME_LIMITS.jpegQuality);
      smallUri = small.uri;
      if (!isCurrent()) return;
      this.lastSent = now;
      this.stats.sent++;

      const t0 = Date.now();
      const { data, error } = await supabase.functions.invoke<{ ok: boolean; event?: unknown; error?: string; scripted?: boolean }>('coach-frame', {
        body: {
          recipe_id: this.recipeId,
          cook_id: this.cookId,
          step_n: stepN,
          user_frame_b64: small.base64,
          already_detected: [...this.detected],
          elapsed_sec: Math.round((now - this.stepStartedAt) / 1000),
        },
      });
      if (!isCurrent()) return;
      this.stats.lastLatencyMs = Date.now() - t0;
      if (error || !data?.ok) { this.stats.lastError = error?.message ?? data?.error ?? 'coach-frame failed'; return; }
      this.stats.scripted = typeof data.scripted === 'boolean' ? data.scripted : null;

      if (data.event === null) { this.stats.lastError = null; return; }
      const parsed = CoachEventSchema.safeParse(data.event);
      if (!parsed.success) { this.stats.lastError = 'bad event json'; return; }
      this.stats.ok++;
      this.stats.lastError = null;
      const adapted = adaptCoachEvent(parsed.data, this.recipe, stepN);
      if (!adapted) return;
      const ev = filterCoachEvent(adapted, step.text);
      if (ev.ingredient_added) this.detected.add(ev.ingredient_added);
      this.onEvent(ev, stepN);
    } catch (e) {
      if (isCurrent()) this.stats.lastError = (e as Error).message;
    } finally {
      this.inFlight--;
      deleteQuietly(shotUri);
      deleteQuietly(smallUri);
      deleteQuietly(thumbUri);
      this.stats.processing = false;
      this.stats.startedAt = null;
      if (this.active) this.emitStats();
    }
  }
}
