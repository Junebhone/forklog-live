// After extract-recipe returns, grab one thumbnail per step at ref_frame_sec from the local video
// and upload to bucket "frames". Replaces any server-side ffmpeg. Call from import.tsx after review.
import * as VideoThumbnails from 'expo-video-thumbnails';
import { supabase } from './supabase';
import { base64ToArrayBuffer, deleteQuietly, resizeJpeg } from './image';
import { isDemoMode } from './demo';
import type { Recipe } from './guards';

export type FrameProgress = { done: number; total: number; succeeded: number; failed: number; scripted: boolean };

export async function uploadRefFrames(
  localVideoUri: string,
  recipeId: string,
  versionId: string,
  recipe: Recipe,
  onProgress?: (progress: FrameProgress) => void,
) {
  const total = recipe.steps.length;
  if (isDemoMode()) {
    for (let i = 1; i <= total; i++) {
      await new Promise(r => setTimeout(r, 350));
      onProgress?.({ done: i, total, succeeded: 0, failed: 0, scripted: true });
    }
    return;
  }
  let done = 0;
  let succeeded = 0;
  let failed = 0;
  await Promise.all(recipe.steps.map(async step => {
    let thumbUri: string | undefined;
    let smallUri: string | undefined;
    try {
      const { uri } = await VideoThumbnails.getThumbnailAsync(localVideoUri, { time: Math.round(step.ref_frame_sec * 1000), quality: 0.7 });
      thumbUri = uri;
      const small = await resizeJpeg(uri, 512, 0.6);
      smallUri = small.uri;
      const path = `${recipeId}/${versionId}/step-${step.n}.jpg`;
      const { error } = await supabase.storage.from('frames').upload(path, base64ToArrayBuffer(small.base64), { contentType: 'image/jpeg', upsert: true });
      if (error) throw error;
      const { error: e2 } = await supabase.from('ref_frames').upsert({ version_id: versionId, step_n: step.n, storage_path: path });
      if (e2) throw e2;
      succeeded++;
    } catch (e) {
      failed++;
      console.warn(`ref frame step ${step.n} failed`, e); // coach-frame falls back to the visual cue
    } finally {
      deleteQuietly(thumbUri);
      deleteQuietly(smallUri);
      done++;
      onProgress?.({ done, total, succeeded, failed, scripted: false });
    }
  }));
}
