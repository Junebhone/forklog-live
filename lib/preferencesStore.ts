import type { GuidanceLanguage } from './guidancePhrases';
import { RESTRICTIONS, type Restriction } from './restrictions';
export type Preferences = { language: GuidanceLanguage; restrictions: Restriction[]; loaded: boolean; error: string | null };
export class PreferencesStore {
  private value: Preferences = { language: 'en', restrictions: [], loaded: false, error: null };
  private revision = 0;
  private listeners = new Set<() => void>();
  constructor(private storage: { read(): Promise<string | null>; write(text: string): void }, private stopSpeech: () => unknown) {}
  getSnapshot = () => this.value;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private update(patch: Partial<Preferences>) { this.value = { ...this.value, ...patch }; this.listeners.forEach(fn => fn()); }
  async load() {
    const revision = this.revision;
    try {
      const text = await this.storage.read();
      if (revision !== this.revision) return;
      const data: unknown = text ? JSON.parse(text) : { language: 'en' };
      if (!data || typeof data !== 'object' || !('language' in data) || !['en', 'es'].includes(String(data.language))) throw Error('Invalid language preference; choose English or Spanish to save again.');
      const restrictions: unknown = 'restrictions' in data ? data.restrictions : [];
      if (!Array.isArray(restrictions) || restrictions.some(r => typeof r !== 'string' || !Object.hasOwn(RESTRICTIONS, r))) throw Error('Invalid restriction preferences; review settings.');
      this.stopSpeech(); this.update({ language: data.language as GuidanceLanguage, restrictions: [...new Set(restrictions)] as Restriction[], loaded: true, error: null });
    } catch (e) { if (revision === this.revision) this.update({ loaded: true, error: `Preferences: ${(e as Error).message}` }); }
  }
  setLanguage(language: GuidanceLanguage) {
    this.revision++; this.stopSpeech(); this.update({ language, loaded: true, error: null });
    this.persist();
  }
  setRestrictions(restrictions: Restriction[]) {
    this.revision++; this.stopSpeech(); this.update({ restrictions: [...new Set(restrictions)], loaded: true, error: null });
    this.persist();
  }
  private persist() {
    try { this.storage.write(JSON.stringify({ language: this.value.language, restrictions: this.value.restrictions })); }
    catch (e) { this.update({ error: `Preference changed for this session but could not be saved: ${(e as Error).message}` }); }
  }
}
