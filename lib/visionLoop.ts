// Live coaching loop: capture → downscale → scene check → coach-frame Edge Function → filtered event.
import type { CameraView } from 'expo-camera';
import * as ImageManipulator from 'expo-image-manipulator';
import { supabase } from './supabase';
import { CoachEventSchema, filterCoachEvent, sceneChanged, FRAME_LIMITS, type CoachEvent, type Recipe } from './guards';

type Listener = (ev: CoachEvent, stepN: number) => void;

export class VisionLoop {
  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight = 0;
  private lastSent = 0;
  private prevThumb: Uint8Array | null = null;
  private detected = new Set<string>();
  private stepStartedAt = Date.now();
  stepN = 1;

  constructor(
    private camera: React.RefObject<CameraView>,
    private recipe: Recipe,
    private recipeId: string,
    private cookId: string,
    private onEvent: Listener,
  ) {}

  start() { this.timer = setInterval(() => void this.tick(), 700); }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }

  setStep(n: number) { this.stepN = n; this.stepStartedAt = Date.now(); this.detected.clear(); }

  private async tick() {
    const now = Date.now();
    if (this.inFlight >= FRAME_LIMITS.maxInFlight) return;
    if (now - this.lastSent < FRAME_LIMITS.minIntervalMs) return;
    const cam = this.camera.current;
    if (!cam) return;

    this.inFlight++;
    try {
      const shot = await cam.takePictureAsync({ quality: FRAME_LIMITS.jpegQuality, skipProcessing: true, base64: false });
      if (!shot?.uri) return;

      const small = await ImageManipulator.manipulateAsync(
        shot.uri,
        [{ resize: { width: FRAME_LIMITS.maxWidth } }],
        { compress: FRAME_LIMITS.jpegQuality, format: ImageManipulator.SaveFormat.JPEG, base64: true },
      );
      // Thumbnail for scene change: 16px wide, read as rough luma via base64 length proxy is too crude;
      // for the hackathon we use a 16px resize and compare base64 bytes. Good enough to skip static frames.
      const thumb = await ImageManipulator.manipulateAsync(shot.uri, [{ resize: { width: 16 } }], { compress: 0.3, base64: true, format: ImageManipulator.SaveFormat.JPEG });
      const thumbBytes = Uint8Array.from(atob(thumb.base64 ?? ''), c => c.charCodeAt(0));
      if (!sceneChanged(this.prevThumb, thumbBytes)) return;
      this.prevThumb = thumbBytes;
      this.lastSent = now;

      const step = this.recipe.steps.find(s => s.n === this.stepN)!;
      const { data, error } = await supabase.functions.invoke('coach-frame', {
        body: {
          recipe_id: this.recipeId,
          cook_id: this.cookId,
          step_n: this.stepN,
          user_frame_b64: small.base64,
          already_detected: [...this.detected],
          elapsed_sec: Math.round((now - this.stepStartedAt) / 1000),
        },
      });
      if (error || !data?.ok) return;

      const parsed = CoachEventSchema.safeParse(data.event);
      if (!parsed.success) return;
      const ev = filterCoachEvent(parsed.data, step.text);
      if (ev.ingredient_added) this.detected.add(ev.ingredient_added);
      this.onEvent(ev, this.stepN);
    } catch {
      // swallow; next tick retries
    } finally {
      this.inFlight--;
    }
  }
}
