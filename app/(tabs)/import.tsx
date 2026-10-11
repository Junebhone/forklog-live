import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { Body, Button, Card, Chip, ErrorBox, Muted, Screen, Title } from '@/components/ui';
import { colors, font, radius, space } from '@/constants/theme';
import { createRecipe, deleteRecipe, uploadVideo } from '@/lib/db';
import { useDemoMode } from '@/lib/demo';
import { DEMO_CLIP } from '@/lib/demoData';
import { CONF, RecipeSchema, VIDEO_LIMITS, type Recipe } from '@/lib/guards';
import { uploadRefFrames, type FrameProgress } from '@/lib/refFrames';
import { invokeFn, supabaseConfigured } from '@/lib/supabase';

type Picked = { uri: string; mimeType: string; durationSec: number | null; bytes: number | null; name: string };
type Phase = 'idle' | 'uploading' | 'extracting' | 'review';
type Result = { recipeId: string; versionId: string; recipe: Recipe };

export default function ImportScreen() {
  const demo = useDemoMode();
  const { autorun } = useLocalSearchParams<{ autorun?: string }>();
  const autoran = useRef(false);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [caption, setCaption] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0); // seconds in the extracting phase, shown so a slow Gemini call does not look hung
  const [result, setResult] = useState<Result | null>(null);
  const [frames, setFrames] = useState<FrameProgress | null>(null);
  const extracting = useRef(false);
  const picking = useRef(false);
  const frameRun = useRef(0);
  const navigating = useRef(false);
  useFocusEffect(useCallback(() => { navigating.current = false; }, []));

  async function pick() {
    if (picking.current || extracting.current) return;
    picking.current = true;
    try {
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
    } catch (e) { setError(`Could not choose video: ${(e as Error).message}. Try choosing it again.`); }
    finally { picking.current = false; }
  }

  async function extract(clip: Picked | null = picked) {
    if (!clip || extracting.current) return;
    const picked = clip;
    if (!supabaseConfigured && !demo) { setError('Supabase is not configured. Add EXPO_PUBLIC_SUPABASE_URL and ANON_KEY to .env, or start the demo from the Library tab.'); return; }
    setError(null);
    extracting.current = true;
    const run = ++frameRun.current;
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
      setFrames({ done: 0, total: recipe.steps.length, succeeded: 0, failed: 0, scripted: demo });
      // Reference frames upload in the background; the coach falls back to visual cues for any that fail.
      uploadRefFrames(picked.uri, recipeId, data.version_id, recipe, progress => { if (frameRun.current === run) setFrames(progress); }).catch(e => { if (frameRun.current === run) setError(`Recipe saved, but reference-frame processing failed: ${(e as Error).message}. Coaching will use visual cues.`); });
    } catch (e) {
      setError((e as Error).message);
      setPhase('idle');
      if (recipeId) deleteRecipe(recipeId).catch(() => {});
    } finally { extracting.current = false; }
  }

  useEffect(() => {
    if (phase !== 'extracting' && phase !== 'uploading') { setElapsed(0); return; }
    setElapsed(0);
    const start = Date.now();
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(t);
  }, [phase]);

  // Demo-only: /import?autorun=1 runs the demo clip through the whole flow (used for scripted walkthroughs).
  useEffect(() => {
    if (!demo || autorun !== '1' || autoran.current) return;
    autoran.current = true;
    setPicked(DEMO_CLIP);
    void extract(DEMO_CLIP);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo, autorun]);

  function reset() {
    frameRun.current++; // an earlier thumbnail job must not change a later import's status
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
            {frames && <Chip label={frames.scripted ? `Demo frame progress ${frames.done}/${frames.total} (no images uploaded)` : frames.done < frames.total ? `Processing references ${frames.done}/${frames.total}` : `References: ${frames.succeeded} ready · ${frames.failed} failed`} tone={frames.scripted || frames.done < frames.total ? 'neutral' : frames.failed ? 'warn' : 'good'} />}
          </View>
          {error && <ErrorBox message={error} />}
          {frames && !frames.scripted && frames.failed > 0 && <Muted size={14}>Some references failed. The saved recipe is available; coaching falls back to written visual cues for those steps.</Muted>}
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

          <Button title="Cook it now" size="lg" onPress={() => { if (navigating.current) return; navigating.current = true; const id = result.recipeId; reset(); router.push(`/cook/${id}`); }} />
          <Button title="Save to library" variant="ghost" onPress={() => { if (navigating.current) return; navigating.current = true; reset(); router.navigate('/'); }} />
        </ScrollView>
      </Screen>
    );
  }

  const busy = phase === 'uploading' || phase === 'extracting';
  return (
    <Screen>
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        <View style={s.titleRow}>
          <Title>Import a video</Title>
          {demo && <Chip label="DEMO" tone="active" />}
        </View>
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
            <>
              {demo && <Button title="Use the demo clip" size="lg" onPress={() => { setError(null); setPicked(DEMO_CLIP); }} />}
              <Button title="Choose video" size="lg" variant={demo ? 'ghost' : 'primary'} onPress={pick} />
            </>
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
            <Body bold>{phase === 'uploading' ? `Uploading video… ${elapsed}s` : `Watching the video and writing the recipe… ${elapsed}s`}</Body>
            <Muted size={14}>{phase === 'uploading' ? (demo ? 'Demo: pretending to upload.' : 'Sending to your Supabase bucket.') : demo ? 'Demo: returning the sample recipe.' : 'Usually 30–90 s for a 60 s clip. Gemini can be slower at peak times; this screen waits up to 2½ minutes.'}</Muted>
          </Card>
        ) : (
          <Button title="Extract recipe" size="lg" disabled={!picked} onPress={() => void extract()} />
        )}
      </ScrollView>
    </Screen>
  );
}

const s = StyleSheet.create({
  scroll: { gap: space.md, paddingVertical: space.md, paddingBottom: 120 },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  section: { color: colors.text, fontSize: font.big, fontWeight: '700', marginTop: space.sm },
  ingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.sm },
  stepHead: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
  stepN: { color: colors.accent, fontSize: font.big, fontWeight: '800', width: 28 },
  input: { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, color: colors.text, fontSize: font.body, padding: space.md, minHeight: 96, textAlignVertical: 'top' },
  progress: { alignItems: 'center', paddingVertical: space.lg },
});
