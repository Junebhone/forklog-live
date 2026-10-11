import { useSyncExternalStore } from 'react';
import { File, Paths } from 'expo-file-system';
import { speaker } from './voice';
import { PreferencesStore } from './preferencesStore';
// Device preferences are separate from demoDb and are never cleared by resetDemo.
export const preferences = new PreferencesStore({
  read: async () => { const file = new File(Paths.document, 'forklog-preferences.json'); return file.exists ? await file.text() : null; },
  write: text => { const file = new File(Paths.document, 'forklog-preferences.json'); if (!file.exists) file.create(); file.write(text); },
}, () => void speaker.stopAll());
export const usePreferences = () => useSyncExternalStore(preferences.subscribe, preferences.getSnapshot, preferences.getSnapshot);
