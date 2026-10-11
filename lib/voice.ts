// Voice output: TTS via Edge Function, cached per line on disk, single-speaker queue with interrupt rules.
// expo-audio (SDK 57). An alert interrupts a step read; a step read never interrupts an alert.
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import { supabase } from './supabase';
import { AlertGate } from './guards';
import { base64ToBytes } from './image';

export type Priority = 'step' | 'alert' | 'stop';
const ORDER: Record<Priority, number> = { step: 0, alert: 1, stop: 2 };

type Current = { player: AudioPlayer; prio: Priority; sub: { remove(): void } };

class Speaker {
  private current: Current | null = null;
  private queue: { text: string; prio: Priority }[] = [];
  private cache = new Map<string, string>(); // text -> file uri
  private muted = false;
  gate = new AlertGate();
  /** UI hook: the line currently being spoken (or null when silent). */
  onLine?: (text: string | null) => void;

  get isMuted() { return this.muted; }
  setMuted(m: boolean) { this.muted = m; if (m) void this.interrupt(); }

  /** Pre-generate audio for lines we know we will say (step intros). Failures are ignored. */
  async prefetch(lines: string[]) {
    await Promise.all(lines.map(l => this.toFile(l).catch(() => null)));
  }

  /**
   * Speak a line. `key` dedupes alerts through AlertGate (e.g. "dev:3"); steps use prio 'step' and no key.
   * At most one queued line per priority: a newer alert replaces an older unspoken one.
   */
  async say(text: string, prio: Priority = 'alert', key?: string, opts: { clamp?: boolean } = {}) {
    if (key && !this.gate.allow(key, prio === 'stop' ? 'stop' : 'warn')) return;
    const line = opts.clamp === false ? text.trim() : this.gate.clamp(text);
    if (this.muted) { this.onLine?.(line); return; }
    if (this.current && ORDER[prio] > ORDER[this.current.prio]) await this.interrupt();
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
    try { cur.sub.remove(); cur.player.pause(); cur.player.remove(); } catch { /* already released */ }
    this.onLine?.(null);
  }

  async stopAll() {
    this.queue = [];
    await this.interrupt();
  }

  private async play(text: string, prio: Priority) {
    let uri: string;
    try {
      uri = await this.toFile(text);
    } catch {
      // TTS unavailable: still surface the line as a caption, then move on.
      this.onLine?.(text);
      this.next();
      return;
    }
    const player = createAudioPlayer({ uri });
    const sub = player.addListener('playbackStatusUpdate', st => {
      if (!st.didJustFinish) return;
      if (this.current?.player !== player) return;
      this.current = null;
      try { sub.remove(); player.remove(); } catch { /* ignore */ }
      this.onLine?.(null);
      this.next();
    });
    this.current = { player, prio, sub };
    this.onLine?.(text);
    player.play();
  }

  private next() {
    const n = this.queue.shift();
    if (n) void this.play(n.text, n.prio);
  }

  private async toFile(text: string): Promise<string> {
    const hit = this.cache.get(text);
    if (hit) return hit;
    const { data, error } = await supabase.functions.invoke<{ ok: boolean; audio_b64?: string }>('tts', { body: { text } });
    if (error || !data?.ok || !data.audio_b64) throw new Error('tts failed');
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
