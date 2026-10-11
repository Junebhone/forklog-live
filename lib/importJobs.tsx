import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { Alert } from 'react-native';
import { router } from 'expo-router';
import { createRecipe, getVersions, saveVersion, uploadVideo } from './db';
import { invokeFn } from './supabase';
import { uploadRefFrames } from './refFrames';
import { ImportController } from './importController';
export const imports = new ImportController({ createRecipe, uploadVideo, getVersions, saveVersion, frames: uploadRefFrames,
  extract: (id, path, caption) => invokeFn<{ ok: boolean; version_id: string; recipe: unknown }>('extract-recipe', { recipe_id: id, video_path: path, caption_text: caption }) });
export const useImportJob = () => useSyncExternalStore(imports.subscribe, imports.getSnapshot, imports.getSnapshot);
export function ImportJobs({ children }: { children: ReactNode }) {
  useEffect(() => imports.onNotice(job => {
    Alert.alert(job.stage === 'failed' ? 'Import needs attention' : 'Recipe extracted — review needed',
      job.error ?? `${job.result?.recipe.title ?? job.inputs.clip.name}. Thumbnail readiness is shown separately.`,
      [{ text: 'Later', style: 'cancel' }, { text: 'Open result', onPress: () => {
        if (imports.getSnapshot()?.id === job.id) router.navigate({ pathname: '/import', params: { jobId: job.id } });
        else if (job.recipeId && job.result) router.push(`/history/${job.recipeId}`);
      } }]);
  }), []);
  return children;
}
