import { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { Body, Button, Card, Chip, ErrorBox, Muted, Screen, Title } from '@/components/ui';
import { colors, font, radius, space } from '@/constants/theme';
import { createRecipe, deleteRecipe, uploadVideo } from '@/lib/db';
import { CONF, RecipeSchema, VIDEO_LIMITS, type Recipe } from '@/lib/guards';
import { uploadRefFrames } from '@/lib/refFrames';
import { invokeFn, supabaseConfigured } from '@/lib/supabase';

type Picked = { uri: string; mimeType: string; durationSec: number | null; bytes: number | null; name: string };
type Phase = 'idle' | 'uploading' | 'extracting' | 'review';
type Result = { recipeId: string; versionId: string; recipe: Recipe };

export default function ImportScreen() {
  const [picked, setPicked] = useState<Picked | null>(null);
  const [caption, setCaption] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [frames, setFrames] = useState<{ done: number; total: number } | null>(null);

  async function pick() {
    setError(null);
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'], allowsEditing: false, videoMaxDuration: VIDEO_LIMITS.maxSeconds, quality: 1 });
    if (res.canceled || !res.assets[0]) return;
    const a = res.assets[0];
    const durationSec = a.duration != null ? a.duration / 1000 : null;
    if (durationSec && durationSec > VIDEO_LIMITS.maxSeconds) { setError(`That video is ${Math.round(durationSec)} s. Keep it under ${VIDEO_LIMITS.maxSeconds} s.`); return; }
    if (a.fileSize && a.fileSize > VIDEO_LIMITS.maxBytes) { setError(`That video is ${(a.fileSize / 1048576).toFixed(0)} MB. Max is ${VIDEO_LIMITS.maxBytes / 1048576} MB.`); return; }
    const mimeType = a.mimeType ?? (a.uri.toLowerCase().endsWith('.mov') ? 'video/quicktime' : 'video/mp4');
    if (!VIDEO_LIMITS.allowed.includes(mimeType)) { setError(`Unsupported format (${mimeType}). Use MP4 or MOV.`); return; }
    setPicked({ uri: a.uri, mimeType, durationSec, bytes: a.fileSize ?? null, name: a.fileName ?? 'video' });
  }

  async function extract() {
    if (!picked) return;
    if (!supabaseConfigured) { setError('Supabase is not configured. Add EXPO_PUBLIC_SUPABASE_URL and ANON_KEY to .env.'); return; }
    setError(null);
    let recipeId: string | null = null;
    try {
      setPhase('uploading');
      recipeId = await createRecipe();
      const path = await uploadVideo(picked.uri, recipeId, picked.mimeType);
      setPhase('extracting');
      const data = await invokeFn<{ ok: boolean; version_id: string; recipe: unknown }>('extract-recipe', { recipe_id: recipeId, video_path: path, caption_text: caption.trim() });
      const parsed = RecipeSchema.safeParse(data.recipe);
      if (!parsed.success) throw new Error(`Recipe failed validation: ${parsed.error.issues[0]?.message ?? 'unknown'}`);
      const recipe = parsed.data;
      setResult({ recipeId, versionId: data.version_id, recipe });
      setPhase('review');
      setFrames({ done: 0, total: recipe.steps.length });
      // Reference frames upload in the background; the coach falls back to visual cues for any that fail.
      uploadRefFrames(picked.uri, recipeId, data.version_id, recipe, (done, total) => setFrames({ done, total })).catch(() => {});
    } catch (e) {
      setError((e as Error).message);
      setPhase('idle');
      if (recipeId) deleteRecipe(recipeId).catch(() => {});
    }
  }

  function reset() {
    setPicked(null); setCaption(''); setResult(null); setFrames(null); setError(null); setPhase('idle');
  }

  if (phase === 'review' && result) {
    const r = result.recipe;
    return (
      <Screen>
        <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
          <Title>{r.title}</Title>
          <Muted>{r.source_summary}</Muted>
          <View style={s.chips}>
            {r.servings != null && <Chip label={`${r.servings} servings`} />}
            {r.total_minutes != null && <Chip label={`${r.total_minutes} min`} />}
            <Chip label={`${r.steps.length} steps`} />
            {frames && <Chip label={frames.done < frames.total ? `Reference frames ${frames.done}/${frames.total}` : 'Reference frames ready'} tone={frames.done < frames.total ? 'neutral' : 'good'} />}
          </View>
          {r.warnings.map((w, i) => <Chip key={i} label={`⚠ ${w}`} tone="warn" />)}

          <Text style={s.section}>Ingredients</Text>
          <Card>
            {r.ingredients.map((ing, i) => (
              <View key={i} style={s.ingRow}>
                <Body>{ing.confidence < CONF.recipeQty ? '~' : ''}{ing.qty}{ing.unit ? ` ${ing.unit}` : ''} {ing.name}</Body>
                <Muted size={13}>{ing.evidence}</Muted>
              </View>
            ))}
            <Muted size={13}>~ = the video didn't say; estimated from what was visible.</Muted>
          </Card>

          <Text style={s.section}>Steps</Text>
          {r.steps.map(st => (
            <Card key={st.n}>
              <View style={s.stepHead}>
                <Text style={s.stepN}>{st.n}</Text>
                <Body bold>{st.text}</Body>
              </View>
              <Muted size={15}>Looks done when: {st.visual_cue}</Muted>
              {st.duration_sec != null && <Muted size={13}>~{Math.round(st.duration_sec / 60) || '<1'} min</Muted>}
            </Card>
          ))}

          <Button title="Cook it now" size="lg" onPress={() => { const id = result.recipeId; reset(); router.push(`/cook/${id}`); }} />
          <Button title="Save to library" variant="ghost" onPress={() => { reset(); router.navigate('/'); }} />
        </ScrollView>
      </Screen>
    );
  }

  const busy = phase === 'uploading' || phase === 'extracting';
  return (
    <Screen>
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        <Title>Import a video</Title>
        <Muted>Pick a saved cooking clip (under {VIDEO_LIMITS.maxSeconds / 60} min). ForkLog watches and listens, then writes the recipe.</Muted>
        {error && <ErrorBox message={error} />}

        <Card>
          {picked ? (
            <>
              <Body bold>{picked.name}</Body>
              <View style={s.chips}>
                {picked.durationSec != null && <Chip label={`${Math.round(picked.durationSec)} s`} />}
                {picked.bytes != null && <Chip label={`${(picked.bytes / 1048576).toFixed(1)} MB`} />}
                <Chip label={picked.mimeType.replace('video/', '').toUpperCase()} />
              </View>
              {!busy && <Button title="Choose a different video" variant="ghost" onPress={pick} />}
            </>
          ) : (
            <Button title="Choose video" size="lg" onPress={pick} />
          )}
        </Card>

        <Text style={s.section}>Caption (optional)</Text>
        <TextInput
          style={s.input}
          placeholder="Paste the post caption — it often has the quantities."
          placeholderTextColor={colors.muted}
          multiline
          value={caption}
          onChangeText={setCaption}
          editable={!busy}
        />

        {busy ? (
          <Card style={s.progress}>
            <ActivityIndicator color={colors.accent} />
            <Body bold>{phase === 'uploading' ? 'Uploading video…' : 'Watching the video and writing the recipe…'}</Body>
            <Muted size={14}>{phase === 'uploading' ? 'Sending to your Supabase bucket.' : 'This takes about a minute for a 60 s clip.'}</Muted>
          </Card>
        ) : (
          <Button title="Extract recipe" size="lg" disabled={!picked} onPress={extract} />
        )}
      </ScrollView>
    </Screen>
  );
}

const s = StyleSheet.create({
  scroll: { gap: space.md, paddingVertical: space.md, paddingBottom: 120 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  section: { color: colors.text, fontSize: font.big, fontWeight: '700', marginTop: space.sm },
  ingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.sm },
  stepHead: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
  stepN: { color: colors.accent, fontSize: font.big, fontWeight: '800', width: 28 },
  input: { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, color: colors.text, fontSize: font.body, padding: space.md, minHeight: 96, textAlignVertical: 'top' },
  progress: { alignItems: 'center', paddingVertical: space.lg },
});
