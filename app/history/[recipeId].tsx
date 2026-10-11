import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Body, Button, Card, Centered, Chip, ErrorBox, Muted, Screen } from '@/components/ui';
import { colors, font, space } from '@/constants/theme';
import { getRecipeTitle, getVersions, setBestVersion, type DiffItem, type VersionRow } from '@/lib/db';

const DIFF_WORD: Record<DiffItem['type'], string> = {
  added: 'added', removed: 'removed', changed_qty: 'qty', changed_time: 'time', reordered: 'reordered', skipped: 'skipped',
};

function summarize(diff: DiffItem[] | null): string {
  if (!diff?.length) return 'Extracted from the video';
  const counts = new Map<string, number>();
  for (const d of diff) counts.set(DIFF_WORD[d.type], (counts.get(DIFF_WORD[d.type]) ?? 0) + 1);
  return [...counts.entries()].map(([k, n]) => `${n} ${k}`).join(' · ');
}

export default function HistoryScreen() {
  const { recipeId } = useLocalSearchParams<{ recipeId: string }>();
  const [title, setTitle] = useState('Versions');
  const [versions, setVersions] = useState<VersionRow[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [t, vs] = await Promise.all([getRecipeTitle(recipeId), getVersions(recipeId)]);
      setTitle(t);
      setVersions(vs);
    } catch (e) {
      setError((e as Error).message);
      setVersions([]);
    }
  }, [recipeId]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function markBest(v: VersionRow) {
    try { await setBestVersion(recipeId, v.id); await load(); } catch (e) { setError((e as Error).message); }
  }

  return (
    <Screen>
      <Stack.Screen options={{ title }} />
      {error && <ErrorBox message={error} />}
      <FlatList
        data={versions ?? []}
        keyExtractor={v => v.id}
        contentContainerStyle={s.list}
        ListHeaderComponent={versions?.length ? <Muted>Newest first. Tap a version to see what changed.</Muted> : null}
        ListEmptyComponent={versions === null ? null : <Centered><Muted>No versions yet.</Muted></Centered>}
        renderItem={({ item: v }) => {
          const expanded = open === v.id;
          return (
            <Pressable onPress={() => setOpen(expanded ? null : v.id)}>
              <Card>
                <View style={s.head}>
                  <Text style={s.vnum}>v{v.number}</Text>
                  <View style={s.badges}>
                    {v.is_best && <Chip label="Best" tone="active" />}
                    {v.rating != null && <Chip label={`★ ${v.rating}/10`} tone="good" />}
                  </View>
                </View>
                <Muted size={14}>{new Date(v.created_at).toLocaleString()} · {summarize(v.diff_json)}</Muted>
                {v.notes ? <Body>“{v.notes}”</Body> : null}
                {expanded && (
                  <View style={s.details}>
                    {v.diff_json?.map((d, i) => (
                      <View key={i} style={s.diffRow}>
                        <Chip label={DIFF_WORD[d.type]} tone={d.type === 'added' ? 'good' : d.type === 'removed' || d.type === 'skipped' ? 'bad' : 'warn'} />
                        <Body>{d.field}{d.from || d.to ? `: ${d.from ?? '—'} → ${d.to ?? '—'}` : ''}</Body>
                      </View>
                    ))}
                    <Muted size={14}>{v.recipe_json.ingredients.length} ingredients · {v.recipe_json.steps.length} steps</Muted>
                    {v.recipe_json.ingredients.map((ing, i) => (
                      <Muted key={i} size={15}>• {ing.qty}{ing.unit ? ` ${ing.unit}` : ''} {ing.name}</Muted>
                    ))}
                  </View>
                )}
                <View style={s.actions}>
                  <Button title={`Cook v${v.number}`} size="lg" style={{ flex: 1 }} onPress={() => router.push({ pathname: '/cook/[recipeId]', params: { recipeId, versionId: v.id } })} />
                  {!v.is_best && <Button title="Mark best" variant="ghost" size="lg" onPress={() => void markBest(v)} />}
                </View>
              </Card>
            </Pressable>
          );
        }}
      />
    </Screen>
  );
}

const s = StyleSheet.create({
  list: { gap: space.md, paddingVertical: space.md, paddingBottom: 48, flexGrow: 1 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  vnum: { color: colors.text, fontSize: font.title, fontWeight: '800' },
  badges: { flexDirection: 'row', gap: space.sm },
  details: { gap: space.sm, paddingTop: space.sm, borderTopWidth: 1, borderTopColor: colors.border },
  diffRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  actions: { flexDirection: 'row', gap: space.sm, marginTop: space.xs },
});
