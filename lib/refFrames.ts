// After extract-recipe returns, grab one thumbnail per step at ref_frame_sec from the local video
// and upload to bucket "frames". Replaces any server-side ffmpeg. Call from import.tsx after review.
import * as VideoThumbnails from 'expo-video-thumbnails';
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system';
import { supabase } from './supabase';
import type { Recipe } from './guards';

export async function uploadRefFrames(localVideoUri: string, recipeId: string, versionId: string, recipe: Recipe) {
  await Promise.all(recipe.steps.map(async step => {
    try {
      const { uri } = await VideoThumbnails.getThumbnailAsync(localVideoUri, { time: Math.round(step.ref_frame_sec * 1000), quality: 0.7 });
      const small = await ImageManipulator.manipulateAsync(uri, [{ resize: { width: 512 } }], { compress: 0.6, format: ImageManipulator.SaveFormat.JPEG, base64: true });
      const path = `${recipeId}/v1/step-${step.n}.jpg`;
      const bytes = Uint8Array.from(atob(small.base64!), c => c.charCodeAt(0));
      await supabase.storage.from('frames').upload(path, bytes, { contentType: 'image/jpeg', upsert: true });
      await supabase.from('ref_frames').upsert({ version_id: versionId, step_n: step.n, storage_path: path });
      await FileSystem.deleteAsync(uri, { idempotent: true });
    } catch (e) {
      console.warn(`ref frame step ${step.n} failed`, e); // coach-frame falls back to the visual cue
    }
  }));
}
