import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useKeepAwake } from 'expo-keep-awake';
import * as Haptics from 'expo-haptics';
import { Button, Centered, Chip, ErrorBox, Muted } from '@/components/ui';
import { colors, font, radius, space } from '@/constants/theme';
import { endCook, getLatestVersion, getVersion, startCook, type VersionRow } from '@/lib/db';
import type { CoachEvent } from '@/lib/guards';
import { VisionLoop, type VisionStats } from '@/lib/visionLoop';
import { speaker } from '@/lib/voice';
import { SPOKEN } from '@/prompts';

export default function CookScreen() {
  const { recipeId, versionId } = useLocalSearchParams<{ recipeId: string; versionId?: string }>();
  useKeepAwake();
  const [perm, requestPerm] = useCameraPermissions();
  const camRef = useRef<CameraView>(null);
  const loopRef = useRef<VisionLoop | null>(null);

  const [version, setVersion] = useState<VersionRow | null>(null);
  const [cookId, setCookId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [camReady, setCamReady] = useState(false);
  const [stepN, setStepN] = useState(1);
  const [detected, setDetected] = useState<Map<string, string | null>>(new Map());
  const [lastEvent, setLastEvent] = useState<CoachEvent | null>(null);
  const [caption, setCaption] = useState<string | null>(null);
  const [stats, setStats] = useState<VisionStats | null>(null);
  const [muted, setMuted] = useState(speaker.isMuted);

  const steps = version?.recipe_json.steps ?? [];
  const step = steps.find(s => s.n === stepN) ?? steps[0];

  // 1. Load the recipe version and open a cook row.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const v = versionId ? await getVersion(versionId) : await getLatestVersion(recipeId);
        if (cancelled) return;
        setVersion(v);
        const id = await startCook(recipeId, v.id);
        if (!cancelled) setCookId(id);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => { cancelled = true; };
  }, [recipeId, versionId]);

  // 2. Prefetch every step's audio, read step 1 once.
  useEffect(() => {
    if (!version) return;
    speaker.onLine = setCaption;
    const intros = version.recipe_json.steps.map(s => SPOKEN.stepIntro(s.n, s.text));
    void speaker.prefetch(intros);
    const first = version.recipe_json.steps[0];
    if (first) void speaker.say(SPOKEN.stepIntro(first.n, first.text), 'step');
    return () => { speaker.onLine = undefined; void speaker.stopAll(); };
  }, [version]);

  // 3. Coach events → chips + voice. Confidence/safety filtering already happened in VisionLoop.
  const handleEvent = useCallback((ev: CoachEvent, n: number) => {
    setLastEvent(ev);
    if (ev.ingredient_added) {
      const name = ev.ingredient_added;
      setDetected(prev => { if (prev.has(name)) return prev; const m = new Map(prev); m.set(name, ev.qty_estimate); return m; });
      void speaker.say(SPOKEN.ingredientNoted(name, ev.qty_estimate), 'alert', `ing:${name}`);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    if (ev.severity === 'stop' && ev.action) {
      void speaker.say(SPOKEN.stop(ev.action), 'stop', `stop:${n}`);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return;
    }
    if (ev.action) {
      void speaker.say(ev.action, 'alert', `dev:${n}`);
    } else if (ev.step_state === 'matches_reference') {
      void speaker.say(SPOKEN.stepMatches(), 'alert', `match:${n}`);
    }
  }, []);

  // 4. Start the vision loop once camera + cook are ready.
  useEffect(() => {
    if (!version || !cookId || !camReady || !perm?.granted) return;
    const loop = new VisionLoop(camRef, version.recipe_json, recipeId, cookId, handleEvent, setStats);
    loopRef.current = loop;
    loop.start();
    return () => { loop.stop(); loopRef.current = null; };
  }, [version, cookId, camReady, perm?.granted, recipeId, handleEvent]);

  function goStep(n: number) {
    if (n < 1 || n > steps.length) return;
    const target = steps[n - 1];
    setStepN(n);
    setDetected(new Map());
    setLastEvent(null);
    loopRef.current?.setStep(n);
    speaker.gate.reset();
    void speaker.say(SPOKEN.stepIntro(target.n, target.text), 'step');
    void Haptics.selectionAsync();
  }

  function toggleMute() {
    const m = !muted;
    setMuted(m);
    speaker.setMuted(m);
  }

  function finish() {
    Alert.alert('Finish cooking?', 'ForkLog will compare your cook to the video.', [
      { text: 'Keep cooking', style: 'cancel' },
      {
        text: "I'm done",
        onPress: async () => {
          loopRef.current?.stop();
          await speaker.stopAll();
          if (!cookId) { router.back(); return; }
          try { await endCook(cookId); } catch { /* recap still works */ }
          router.replace(`/recap/${cookId}`);
        },
      },
    ]);
  }

  function askVoice() {
    Alert.alert('Voice Q&A', 'Hands-free questions arrive with the ElevenLabs agent in the dev build. For now, use Next / Back.');
  }

  if (!perm) return <View style={s.root} />;
  if (!perm.granted) {
    return (
      <View style={s.root}>
        <Centered>
          <Text style={s.permTitle}>ForkLog needs the camera</Text>
          <Muted>It watches your pan to notice ingredients and compare with the video. Nothing is recorded.</Muted>
          <Button title="Allow camera" size="lg" onPress={() => void requestPerm()} />
          <Button title="Back" variant="ghost" onPress={() => router.back()} />
        </Centered>
      </View>
    );
  }

  const expected = step?.ingredients ?? [];
  const extras = [...detected.keys()].filter(d => !expected.some(e => e.toLowerCase() === d.toLowerCase()));
  const isDetected = (name: string) => [...detected.keys()].some(d => d.toLowerCase() === name.toLowerCase());
  const banner = caption ?? lastEvent?.deviation ?? null;

  return (
    <View style={s.root}>
      <CameraView ref={camRef} style={StyleSheet.absoluteFill} facing="back" animateShutter={false} mute onCameraReady={() => setCamReady(true)} onMountError={e => setError(e.message)} />
      <SafeAreaView style={s.overlay} edges={['top', 'bottom']}>
        {/* top: step */}
        <View style={s.top}>
          <View style={s.topRow}>
            <Chip label={steps.length ? `Step ${stepN} of ${steps.length}` : 'Loading recipe…'} tone="active" />
            <Pressable onPress={toggleMute} style={s.iconBtn} accessibilityLabel={muted ? 'Unmute coach' : 'Mute coach'}>
              <Text style={s.iconText}>{muted ? '🔇' : '🔊'}</Text>
            </Pressable>
          </View>
          {step && (
            <View style={s.stepBox}>
              <Text style={s.stepText}>{step.text}</Text>
              <Text style={s.cue}>Done when: {step.visual_cue}</Text>
            </View>
          )}
          {error && <ErrorBox message={error} />}
        </View>

        {/* middle: what the coach is saying */}
        <View style={s.middle}>
          {banner && (
            <View style={[s.banner, lastEvent?.severity === 'stop' && s.bannerStop]}>
              <Text style={s.bannerText}>{banner}</Text>
            </View>
          )}
        </View>

        {/* bottom: chips, mic, controls */}
        <View style={s.bottom}>
          <View style={s.chipsRow}>
            <View style={s.chips}>
              {expected.map(name => <Chip key={name} label={isDetected(name) ? `✓ ${name}${detected.get(name) ? ` · ${detected.get(name)}` : ''}` : name} tone={isDetected(name) ? 'good' : 'neutral'} />)}
              {extras.map(name => <Chip key={name} label={`? ${name}`} tone="warn" />)}
            </View>
            <Pressable onPress={askVoice} style={s.mic} accessibilityLabel="Ask the coach">
              <Text style={s.micIcon}>🎤</Text>
              <Text style={s.micLabel}>Ask</Text>
            </Pressable>
          </View>
          <View style={s.controls}>
            <Button title="Back" variant="ghost" size="lg" disabled={stepN <= 1} onPress={() => goStep(stepN - 1)} />
            <Button title={stepN >= steps.length ? 'Last step' : 'Next step'} size="lg" style={{ flex: 1 }} disabled={!steps.length || stepN >= steps.length} onPress={() => goStep(stepN + 1)} />
            <Button title="I'm done" variant="danger" size="lg" onPress={finish} />
          </View>
          <Text style={s.stats}>
            {camReady ? '● ' : '○ '}
            {stats ? `${stats.sent} sent · ${stats.ok} ok · ${stats.skipped} still${stats.lastLatencyMs != null ? ` · ${stats.lastLatencyMs} ms` : ''}` : 'waiting for camera'}
            {stats?.lastError ? ` · ${stats.lastError.slice(0, 40)}` : ''}
          </Text>
        </View>
      </SafeAreaView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  overlay: { flex: 1, justifyContent: 'space-between', padding: space.md },
  top: { gap: space.sm },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  iconBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.overlay, alignItems: 'center', justifyContent: 'center' },
  iconText: { fontSize: 22 },
  stepBox: { backgroundColor: colors.overlay, borderRadius: radius.md, padding: space.md, gap: space.xs },
  stepText: { color: colors.text, fontSize: font.cook, fontWeight: '700', lineHeight: 30 },
  cue: { color: '#d8d8de', fontSize: 18, lineHeight: 24 },
  middle: { alignItems: 'center' },
  banner: { backgroundColor: 'rgba(255,122,26,0.92)', borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.sm, maxWidth: '92%' },
  bannerStop: { backgroundColor: 'rgba(255,92,92,0.95)' },
  bannerText: { color: '#1a0d00', fontSize: 20, fontWeight: '700', textAlign: 'center' },
  bottom: { gap: space.sm },
  chipsRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm },
  chips: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  mic: { width: 76, height: 76, borderRadius: 38, backgroundColor: colors.card2, borderWidth: 2, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  micIcon: { fontSize: 26 },
  micLabel: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  controls: { flexDirection: 'row', gap: space.sm },
  stats: { color: 'rgba(255,255,255,0.55)', fontSize: 12, textAlign: 'center' },
  permTitle: { color: colors.text, fontSize: font.title, fontWeight: '800', textAlign: 'center' },
});
