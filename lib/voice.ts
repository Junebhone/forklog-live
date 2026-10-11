// Voice output: TTS via Edge Function, cached per line, single-speaker queue with interrupt rules.
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import { supabase } from './supabase';
import { AlertGate } from './guards';

type Priority = 'step' | 'alert' | 'stop';
const ORDER: Record<Priority, number> = { step: 0, alert: 1, stop: 2 };

class Speaker {
  private current: { sound: Audio.Sound; prio: Priority } | null = null;
  private queue: { text: string; prio: Priority }[] = [];
  private cache = new Map<string, string>(); // text -> file uri
  gate = new AlertGate();

  async prefetch(lines: string[]) { await Promise.all(lines.map(l => this.toFile(l).catch(() => null))); }

  /** key dedupes alerts (e.g. "dev:step3"). Steps use prio 'step' and no key. */
  async say(text: string, prio: Priority = 'alert', key?: string) {
    if (key && !this.gate.allow(key, prio === 'stop' ? 'stop' : 'warn')) return;
    const line = this.gate.clamp(text);
    if (this.current && ORDER[prio] > ORDER[this.current.prio]) await this.interrupt();
    if (this.current) { this.queue.push({ text: line, prio }); this.queue.sort((a, b) => ORDER[b.prio] - ORDER[a.prio]); return; }
    await this.play(line, prio);
  }

  async interrupt() {
    if (!this.current) return;
    try { await this.current.sound.stopAsync(); await this.current.sound.unloadAsync(); } catch {}
    this.current = null;
  }

  private async play(text: string, prio: Priority) {
    const uri = await this.toFile(text);
    const { sound } = await Audio.Sound.createAsync({ uri }, { shouldPlay: true });
    this.current = { sound, prio };
    sound.setOnPlaybackStatusUpdate(async st => {
      if (!st.isLoaded || !st.didJustFinish) return;
      await sound.unloadAsync();
      this.current = null;
      const next = this.queue.shift();
      if (next) await this.play(next.text, next.prio);
    });
  }

  private async toFile(text: string): Promise<string> {
    const hit = this.cache.get(text);
    if (hit) return hit;
    const { data, error } = await supabase.functions.invoke('tts', { body: { text } });
    if (error || !data?.audio_b64) throw new Error('tts failed');
    const uri = `${FileSystem.cacheDirectory}tts-${hash(text)}.mp3`;
    await FileSystem.writeAsStringAsync(uri, data.audio_b64, { encoding: FileSystem.EncodingType.Base64 });
    this.cache.set(text, uri);
    return uri;
  }
}

function hash(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }

export const speaker = new Speaker();

export async function initAudio() {
  await Audio.setAudioModeAsync({ playsInSilentModeIOS: true, allowsRecordingIOS: true, staysActiveInBackground: false });
}
