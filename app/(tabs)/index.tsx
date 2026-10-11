import { useCallback, useState } from 'react';
import { Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Body, Button, Card, Centered, Chip, ErrorBox, Muted, Screen, Title } from '@/components/ui';
import { colors, font, space } from '@/constants/theme';
import { deleteRecipe, listLibrary, type LibraryItem } from '@/lib/db';
import { setDemoMode, useDemoMode } from '@/lib/demo';
import { resetDemo } from '@/lib/demoDb';
import { DEMO_IDS } from '@/lib/demoData';
import { supabaseConfigured } from '@/lib/supabase';

export default function LibraryScreen() {
  const demo = useDemoMode();
  const [items, setItems] = useState<LibraryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!supabaseConfigured && !demo) { setItems([]); setError(null); return; }
    try {
      setError(null);
      setItems(await listLibrary());
    } catch (e) {
      setError((e as Error).message);
      setItems([]);
    }
  }, [demo]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const startDemo = () => { resetDemo(); setDemoMode(true); setItems(null); };
  const exitDemo = () => { setDemoMode(false); resetDemo(); setItems(null); };

  const confirmDelete = (item: LibraryItem) =>
    Alert.alert('Delete recipe?', `"${item.title}" and all its versions will be removed.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { try { await deleteRecipe(item.id); await load(); } catch (e) { setError((e as Error).message); } } },
    ]);

  const noBackend = !supabaseConfigured && !demo;

  return (
    <Screen>
      <View style={s.header}>
        <View style={s.headerRow}>
          <Title>ForkLog</Title>
          {demo ? (
            <Button title="Exit demo" variant="ghost" onPress={exitDemo} style={s.headerBtn} />
          ) : (
            <Button title="Demo" variant="ghost" onPress={startDemo} style={s.headerBtn} />
          )}
        </View>
        <Muted>Cook it like the video. Keep what you changed.</Muted>
      </View>

      {demo && (
        <Card style={s.demoCard}>
          <View style={s.demoRow}>
            <Chip label="DEMO" tone="active" />
            <View style={{ flex: 1 }}><Body bold>Sample data, scripted coach, device voice.</Body></View>
          </View>
          <Muted size={14}>Import → pick “Use the demo clip”. Cook → watch the chips and corrections appear on each step. Finish → recap diff → save v2 → Versions.</Muted>
          <Button title="Skip to the recap of a finished cook" variant="ghost" onPress={() => router.push(`/recap/${DEMO_IDS.cook}`)} />
        </Card>
      )}

      {noBackend && (
        <Card style={s.demoCard}>
          <Body bold>No backend connected yet</Body>
          <Muted size={14}>Add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY to .env and restart Expo. Until then the app runs in demo mode.</Muted>
          <Button title="Start the demo" size="lg" onPress={startDemo} />
        </Card>
      )}

      {error && <ErrorBox message={error} />}

      <FlatList
        data={items ?? []}
        keyExtractor={i => i.id}
        contentContainerStyle={s.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
        ListEmptyComponent={
          items === null || noBackend ? null : (
            <Centered>
              <Text style={s.emptyEmoji}>🍳</Text>
              <Text style={s.emptyTitle}>No recipes yet</Text>
              <Muted>Import a cooking video and ForkLog will turn it into steps you can cook along to.</Muted>
              <Button title="Import a video" size="lg" onPress={() => router.navigate('/import')} />
            </Centered>
          )
        }
        renderItem={({ item }) => (
          <Pressable onLongPress={() => confirmDelete(item)} onPress={() => router.push(`/history/${item.id}`)}>
            <Card>
              <View style={s.row}>
                <Text style={s.cardTitle} numberOfLines={2}>{item.title}</Text>
                <Chip label={`v${item.latest || 1}`} tone="active" />
              </View>
              {item.source_summary ? <Muted size={15}>{item.source_summary}</Muted> : null}
              <View style={s.meta}>
                {item.best_rating != null && <Chip label={`★ ${item.best_rating}/10`} tone="good" />}
                {item.version_count > 1 && <Chip label={`${item.version_count} versions`} />}
              </View>
              <View style={s.actions}>
                <Button title="Cook" size="lg" style={{ flex: 1 }} onPress={() => router.push(`/cook/${item.id}`)} />
                <Button title="Versions" variant="ghost" size="lg" onPress={() => router.push(`/history/${item.id}`)} />
              </View>
            </Card>
          </Pressable>
        )}
      />
    </Screen>
  );
}

const s = StyleSheet.create({
  header: { paddingVertical: space.md, gap: space.xs },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headerBtn: { minHeight: 40, paddingHorizontal: space.md },
  demoCard: { marginBottom: space.md, borderColor: colors.accent },
  demoRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  list: { gap: space.md, paddingBottom: 120, flexGrow: 1 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: space.sm },
  cardTitle: { color: colors.text, fontSize: font.big, fontWeight: '700', flex: 1 },
  meta: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' },
  actions: { flexDirection: 'row', gap: space.sm, marginTop: space.xs },
  emptyEmoji: { fontSize: 56 },
  emptyTitle: { color: colors.text, fontSize: font.big, fontWeight: '700' },
});
