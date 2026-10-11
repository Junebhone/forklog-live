// After extract-recipe returns, grab one thumbnail per step at ref_frame_sec from the local video
// and upload to bucket "frames". Replaces any server-side ffmpeg. Call from import.tsx after review.
import * as VideoThumbnails from 'expo-video-thumbnails';
import { supabase } from './supabase';
import { base64ToArrayBuffer, deleteQuietly, resizeJpeg } from './image';
import type { Recipe } from './guards';

export async function uploadRefFrames(
  localVideoUri: string,
  recipeId: string,
  versionId: string,
  recipe: Recipe,
  onProgress?: (done: number, total: number) => void,
) {
  let done = 0;
  const total = recipe.steps.length;
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
    } catch (e) {
      console.warn(`ref frame step ${step.n} failed`, e); // coach-frame falls back to the visual cue
    } finally {
      deleteQuietly(thumbUri);
      deleteQuietly(smallUri);
      done++;
      onProgress?.(done, total);
    }
  }));
}
