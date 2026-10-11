import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Body, Button, Card, Centered, Chip, ErrorBox, Muted, Screen, Title } from '@/components/ui';
import { colors, font, radius, space } from '@/constants/theme';
import { countCookEvents, getCook, getVersion, saveVersion, type CookRow, type DiffItem, type VersionRow } from '@/lib/db';
import { CookDiffSchema, type CookDiff } from '@/lib/guards';
import { invokeFn } from '@/lib/supabase';
import { speaker } from '@/lib/voice';
import { useDemoMode } from '@/lib/demo';

type Phase = 'rate' | 'generating' | 'review' | 'saving';

const DIFF_TONE: Record<DiffItem['type'], 'good' | 'bad' | 'warn' | 'neutral'> = {
  added: 'good', removed: 'bad', changed_qty: 'warn', changed_time: 'warn', reordered: 'neutral', skipped: 'bad',
};
const DIFF_LABEL: Record<DiffItem['type'], string> = {
  added: 'Added', removed: 'Removed', changed_qty: 'Quantity', changed_time: 'Timing', reordered: 'Reordered', skipped: 'Skipped',
};

export default function RecapScreen() {
  const { cookId, autorun } = useLocalSearchParams<{ cookId: string; autorun?: string }>();
  const demo = useDemoMode();
  const autoran = useRef(false);
  const [cook, setCook] = useState<CookRow | null>(null);
  const [base, setBase] = useState<VersionRow | null>(null);
  const [events, setEvents] = useState<number | null>(null);
  const [rating, setRating] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [phase, setPhase] = useState<Phase>('rate');
  const [result, setResult] = useState<CookDiff | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const c = await getCook(cookId);
        const [v, n] = await Promise.all([getVersion(c.base_version_id), countCookEvents(cookId)]);
        if (cancelled) return;
        setCook(c); setBase(v); setEvents(n);
        void speaker.say(SPOKEN_ASK, 'step');
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => { cancelled = true; void speaker.stopAll(); };
  }, [cookId]);

  async function generate(ratingOverride: number | null = rating): Promise<CookDiff | null> {
    setError(null);
    setPhase('generating');
    try {
      const data = await invokeFn<{ ok: boolean } & Record<string, unknown>>('recap', { cook_id: cookId, rating: ratingOverride, notes: notes.trim() });
      const parsed = CookDiffSchema.safeParse(data);
      if (!parsed.success) throw new Error(`Recap failed validation: ${parsed.error.issues[0]?.message ?? 'unknown'}`);
      setResult(parsed.data);
      setPhase('review');
      void speaker.say(parsed.data.spoken_recap, 'step', undefined, { clamp: false });
      return parsed.data;
    } catch (e) {
      setError((e as Error).message);
      setPhase('rate');
      return null;
    }
  }

  async function save(r: CookDiff | null = result, ratingValue: number | null = rating) {
    if (!cook || !base || !r) return;
    const result = r;
    setPhase('saving');
    try {
      await speaker.stopAll();
      await saveVersion({ recipeId: cook.recipe_id, parentId: base.id, recipe: result.proposed_version, diff: result.diff, rating: ratingValue, notes: notes.trim(), cookId });
      router.replace(`/history/${cook.recipe_id}`);
    } catch (e) {
      setError((e as Error).message);
      setPhase('review');
    }
  }

  // Demo-only: /recap/<id>?autorun=1 rates 8 and generates; autorun=save also saves v2 and opens Versions.
  useEffect(() => {
    if (!demo || !cook || !base || autoran.current || (autorun !== '1' && autorun !== 'save')) return;
    autoran.current = true;
    setRating(8);
    void (async () => {
      const r = await generate(8);
      if (r && autorun === 'save') await save(r, 8);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo, cook, base, autorun]);

  function skip() {
    void speaker.stopAll();
    router.replace('/');
  }

  if (error && !cook) {
    return (
      <Screen>
        <Centered>
          <ErrorBox message={error} />
          <Button title="Back to library" variant="ghost" onPress={skip} />
        </Centered>
      </Screen>
    );
  }

  const nextVersion = (base?.number ?? 0) + 1;

  return (
    <Screen>
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Title>{base?.recipe_json.title ?? 'Your cook'}</Title>
        <Muted>{events == null ? 'Loading…' : `${events} moments noticed while you cooked · based on v${base?.number ?? '?'}`}</Muted>
        {error && <ErrorBox message={error} />}

        {phase !== 'review' && phase !== 'saving' ? (
          <>
            <Text style={s.section}>How did it turn out?</Text>
            <View style={s.grid}>
              {Array.from({ length: 10 }, (_, i) => i + 1).map(n => (
                <Pressable key={n} onPress={() => setRating(n)} style={[s.rate, rating === n && s.rateOn]} accessibilityLabel={`Rate ${n} out of 10`}>
                  <Text style={[s.rateText, rating === n && s.rateTextOn]}>{n}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={s.section}>Notes (optional)</Text>
            <TextInput
              style={s.input}
              placeholder="What would you change next time?"
              placeholderTextColor={colors.muted}
              multiline
              value={notes}
              onChangeText={setNotes}
              editable={phase === 'rate'}
            />
            <Button title={phase === 'generating' ? 'Comparing with the video…' : 'Show me what I changed'} size="lg" loading={phase === 'generating'} disabled={!cook || !base} onPress={() => void generate()} />
            <Button title="Skip" variant="ghost" disabled={phase === 'generating'} onPress={skip} />
          </>
        ) : result ? (
          <>
            <Card style={s.quote}>
              <Text style={s.quoteText}>“{result.spoken_recap}”</Text>
            </Card>
            {rating != null && <Chip label={`★ ${rating}/10`} tone="good" />}

            <Text style={s.section}>{result.diff.length ? `${result.diff.length} difference${result.diff.length === 1 ? '' : 's'}` : 'No differences detected'}</Text>
            {result.diff.map((d, i) => (
              <Card key={i}>
                <View style={s.diffHead}>
                  <Chip label={DIFF_LABEL[d.type]} tone={DIFF_TONE[d.type]} />
                  {d.step_n != null && <Muted size={14}>step {d.step_n}</Muted>}
                  <Muted size={13}>{Math.round(d.confidence * 100)}%</Muted>
                </View>
                <Body bold>{d.field}</Body>
                {(d.from || d.to) && (
                  <Body>
                    {d.from ?? '—'}
                    <Text style={{ color: colors.muted }}>  →  </Text>
                    {d.to ?? '—'}
                  </Body>
                )}
              </Card>
            ))}
            {result.suggestion && (
              <Card style={s.tip}>
                <Text style={s.tipLabel}>Next time</Text>
                <Body>{result.suggestion}</Body>
              </Card>
            )}

            <Button title={`Save as v${nextVersion}`} size="lg" loading={phase === 'saving'} onPress={() => void save()} />
            <Button title="Don't save" variant="ghost" disabled={phase === 'saving'} onPress={skip} />
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const SPOKEN_ASK = 'Nice work. How would you rate it out of ten?';

const s = StyleSheet.create({
  scroll: { gap: space.md, paddingVertical: space.md, paddingBottom: 48 },
  section: { color: colors.text, fontSize: font.big, fontWeight: '700', marginTop: space.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  rate: { width: '18%', aspectRatio: 1, borderRadius: radius.md, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  rateOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  rateText: { color: colors.text, fontSize: font.big, fontWeight: '700' },
  rateTextOn: { color: colors.accentText },
  input: { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, color: colors.text, fontSize: font.body, padding: space.md, minHeight: 96, textAlignVertical: 'top' },
  quote: { backgroundColor: colors.card2 },
  quoteText: { color: colors.text, fontSize: font.big, lineHeight: 28, fontStyle: 'italic' },
  diffHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  tip: { borderColor: colors.accent },
  tipLabel: { color: colors.accent, fontWeight: '800', fontSize: 14, textTransform: 'uppercase', letterSpacing: 1 },
});
