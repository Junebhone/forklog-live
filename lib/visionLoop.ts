// Live coaching loop: capture → downscale → scene check → coach-frame Edge Function → filtered event.
// Cadence rules (CLAUDE.md): send only when the scene changed AND ≥2 s since the last send; max 1 in flight.
import type { RefObject } from 'react';
import type { CameraView } from 'expo-camera';
import { supabase } from './supabase';
import { base64ToBytes, deleteQuietly, resizeJpeg } from './image';
import { CoachEventSchema, filterCoachEvent, sceneChanged, FRAME_LIMITS, type CoachEvent, type Recipe } from './guards';
import { isDemoMode } from './demo';
import { DEMO_COACH_SCRIPT } from './demoData';
import { demoDb } from './demoDb';

type Listener = (ev: CoachEvent, stepN: number) => void;
export type VisionStats = { sent: number; ok: number; skipped: number; lastLatencyMs: number | null; lastError: string | null };

export class VisionLoop {
  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight = 0;
  private lastSent = 0;
  private prevThumb: Uint8Array | null = null;
  private detected = new Set<string>();
  private stepStartedAt = Date.now();
  private stats: VisionStats = { sent: 0, ok: 0, skipped: 0, lastLatencyMs: null, lastError: null };
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
    this.timer = setInterval(() => void this.tick(), 700);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  setStep(n: number) {
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
      fired = true;
      this.stats.sent++;
      this.stats.ok++;
      this.stats.lastLatencyMs = 900 + Math.round(Math.random() * 500);
      const ev = filterCoachEvent(item.event, step.text);
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
    const now = Date.now();
    if (isDemoMode()) { this.tickDemo(now); return; }
    if (this.inFlight >= FRAME_LIMITS.maxInFlight) return;
    if (now - this.lastSent < FRAME_LIMITS.minIntervalMs) return;
    const cam = this.camera.current;
    if (!cam) return;

    this.inFlight++;
    let shotUri: string | undefined;
    let smallUri: string | undefined;
    let thumbUri: string | undefined;
    try {
      const shot = await cam.takePictureAsync({ quality: FRAME_LIMITS.jpegQuality, skipProcessing: true, shutterSound: false });
      if (!shot?.uri) return;
      shotUri = shot.uri;

      // Tiny thumbnail as a cheap "did anything change" check (compressed bytes, not true luma — good enough to skip a static counter).
      const thumb = await resizeJpeg(shot.uri, 16, 0.3);
      thumbUri = thumb.uri;
      const thumbBytes = base64ToBytes(thumb.base64);
      if (!sceneChanged(this.prevThumb, thumbBytes)) { this.stats.skipped++; this.emitStats(); return; }
      this.prevThumb = thumbBytes;

      const small = await resizeJpeg(shot.uri, FRAME_LIMITS.maxWidth, FRAME_LIMITS.jpegQuality);
      smallUri = small.uri;
      this.lastSent = now;
      this.stats.sent++;

      const step = this.recipe.steps.find(s => s.n === this.stepN);
      if (!step) return;
      const t0 = Date.now();
      const { data, error } = await supabase.functions.invoke<{ ok: boolean; event?: unknown; error?: string }>('coach-frame', {
        body: {
          recipe_id: this.recipeId,
          cook_id: this.cookId,
          step_n: this.stepN,
          user_frame_b64: small.base64,
          already_detected: [...this.detected],
          elapsed_sec: Math.round((now - this.stepStartedAt) / 1000),
        },
      });
      this.stats.lastLatencyMs = Date.now() - t0;
      if (error || !data?.ok) { this.stats.lastError = error?.message ?? data?.error ?? 'coach-frame failed'; return; }

      const parsed = CoachEventSchema.safeParse(data.event);
      if (!parsed.success) { this.stats.lastError = 'bad event json'; return; }
      this.stats.ok++;
      this.stats.lastError = null;
      const ev = filterCoachEvent(parsed.data, step.text);
      if (ev.ingredient_added) this.detected.add(ev.ingredient_added);
      this.onEvent(ev, this.stepN);
    } catch (e) {
      this.stats.lastError = (e as Error).message;
    } finally {
      this.inFlight--;
      deleteQuietly(shotUri);
      deleteQuietly(smallUri);
      deleteQuietly(thumbUri);
      this.emitStats();
    }
  }
}
