// Voice output: TTS via Edge Function, cached per line on disk, single-speaker queue with interrupt rules.
// expo-audio (SDK 57). An alert interrupts a step read; a step read never interrupts an alert.
// Fallback: if the tts function is unavailable (or demo mode is on) the line is spoken with the
// device voice (expo-speech) so the coach is never silent.
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import * as Speech from 'expo-speech';
import { supabase } from './supabase';
import { AlertGate } from './guards';
import { base64ToBytes } from './image';
import { isDemoMode } from './demo';

export type Priority = 'step' | 'alert' | 'stop';
const ORDER: Record<Priority, number> = { step: 0, alert: 1, stop: 2 };

type Current =
  | { kind: 'pending'; prio: Priority }
  | { kind: 'file'; prio: Priority; player: AudioPlayer; sub: { remove(): void } }
  | { kind: 'speech'; prio: Priority };

class Speaker {
  private current: Current | null = null;
  private queue: { text: string; prio: Priority }[] = [];
  private cache = new Map<string, string>(); // text -> file uri
  private generating = new Map<string, Promise<string>>();
  private stopping: Promise<void> | null = null;
  private generation = 0;
  private muted = false;
  gate = new AlertGate();
  /** UI hook: the line currently being spoken (or null when silent). */
  onLine?: (text: string | null) => void;
  onLoading?: (loading: boolean) => void;

  get isMuted() { return this.muted; }
  setMuted(m: boolean) { this.muted = m; if (m) void this.stopAll(); }

  /** Pre-generate audio for lines we know we will say (step intros). Failures are ignored. */
  async prefetch(lines: string[]) {
    if (isDemoMode()) return;
    await Promise.all(lines.map(l => this.toFile(l).catch(() => null)));
  }

  /**
   * Speak a line. `key` dedupes alerts through AlertGate (e.g. "dev:3"); steps use prio 'step' and no key.
   * At most one queued line per priority: a newer alert replaces an older unspoken one.
   */
  async say(text: string, prio: Priority = 'alert', key?: string, opts: { clamp?: boolean } = {}) {
    const generation = this.generation;
    if (key && !this.gate.allow(key, prio === 'stop' ? 'stop' : 'warn')) return;
    const line = opts.clamp === false ? text.trim() : this.gate.clamp(text);
    if (this.muted) { this.onLine?.(line); return; }
    if (this.stopping) await this.stopping;
    if (generation !== this.generation || this.muted) return;
    if (this.current && ORDER[prio] > ORDER[this.current.prio]) await this.interrupt();
    if (generation !== this.generation || this.muted) return;
    if (this.current) {
      this.queue = this.queue.filter(q => q.prio !== prio);
      this.queue.push({ text: line, prio });
      this.queue.sort((a, b) => ORDER[b.prio] - ORDER[a.prio]);
      return;
    }
    await this.play(line, prio);
  }

  async interrupt() {
    const cur = this.current;
    if (!cur) return;
    this.current = null;
    try {
      if (cur.kind === 'file') { cur.sub.remove(); cur.player.pause(); cur.player.remove(); }
      else if (cur.kind === 'speech') {
        const stopping = Speech.stop().catch(() => {});
        this.stopping = stopping;
        await stopping;
        if (this.stopping === stopping) this.stopping = null;
      }
    } catch { /* already released */ }
    if (!this.current) { this.onLine?.(null); this.onLoading?.(false); }
  }

  async stopAll() {
    this.generation++;
    this.queue = [];
    await this.interrupt();
  }

  private async play(text: string, prio: Priority) {
    if (this.muted) return;
    const pending: Current = { kind: 'pending', prio };
    this.current = pending; // reserve the speaker before awaiting TTS generation
    this.onLine?.(text);
    if (!isDemoMode()) {
      this.onLoading?.(true);
      try {
        const uri = await this.toFile(text);
        if (this.current !== pending || this.muted) return;
        this.playFile(uri, text, prio);
        if (__DEV__) console.log(`[voice] ElevenLabs: ${text}`);
        return;
      } catch (e) {
        if (this.current !== pending || this.muted) return;
        console.warn(`[voice] ElevenLabs failed, using device voice: ${(e as Error).message}`);
      }
    }
    if (this.current !== pending || this.muted) return;
    this.playSpeech(text, prio);
  }

  private playFile(uri: string, text: string, prio: Priority) {
    const player = createAudioPlayer({ uri });
    const cur: Current = { kind: 'file', prio, player, sub: { remove: () => {} } };
    const sub = player.addListener('playbackStatusUpdate', st => {
      if (!st.didJustFinish) return;
      if (this.current !== cur) return;
      try { sub.remove(); player.remove(); } catch { /* ignore */ }
      this.finish(cur);
    });
    cur.sub = sub;
    this.current = cur;
    this.onLoading?.(false);
    this.onLine?.(text);
    player.play();
  }

  private playSpeech(text: string, prio: Priority) {
    const cur: Current = { kind: 'speech', prio };
    this.current = cur;
    this.onLoading?.(false);
    this.onLine?.(text);
    Speech.speak(text, {
      rate: 1.02,
      onDone: () => this.finish(cur),
      onError: () => this.finish(cur),
    });
  }

  private finish(cur: Current) {
    if (this.current !== cur) return;
    this.current = null;
    this.onLine?.(null);
    this.next();
  }

  private next() {
    const n = this.queue.shift();
    if (n) void this.play(n.text, n.prio);
  }

  private async toFile(text: string): Promise<string> {
    const hit = this.cache.get(text);
    if (hit) return hit;
    const pending = this.generating.get(text);
    if (pending) return pending;
    const job = this.generateFile(text);
    this.generating.set(text, job);
    try { return await job; }
    finally { this.generating.delete(text); }
  }

  private async generateFile(text: string): Promise<string> {
    const { data, error } = await supabase.functions.invoke<{ ok: boolean; audio_b64?: string }>('tts', { body: { text } });
    if (error) throw new Error(`tts request: ${error.message}`);
    if (!data?.ok || !data.audio_b64) throw new Error(`tts: ${(data as { error?: string } | null)?.error ?? 'no audio'}`);
    const file = new File(Paths.cache, `tts-${hash(text)}.mp3`);
    file.write(base64ToBytes(data.audio_b64));
    this.cache.set(text, file.uri);
    return file.uri;
  }
}

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export const speaker = new Speaker();

export async function initAudio() {
  await setAudioModeAsync({
    playsInSilentMode: true,
    interruptionMode: 'duckOthers',
    allowsRecording: false,
    shouldPlayInBackground: false,
  });
}
