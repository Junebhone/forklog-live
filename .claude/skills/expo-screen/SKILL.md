---
name: expo-screen
description: Create or modify an Expo Router screen in this app (import, cook, recap, history). Use when asked to build, scaffold, or fix a screen or its navigation.
---

# Expo screen

1. File goes in `app/` following the routes in README.md. Dynamic params via `useLocalSearchParams()`.
2. Skeleton:
```tsx
import { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { supabase } from '@/lib/supabase';

export default function Screen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // load with useEffect + supabase; always render loading/error states
  return <View style={s.c}>...</View>;
}
const s = StyleSheet.create({ c: { flex: 1, padding: 16, backgroundColor: '#0b0b0f' } });
```
3. Dark theme, large touch targets (wet hands). Fonts ≥ 18 on the cook screen.
4. Cook screen: `useKeepAwake()`, full-bleed `CameraView`, overlay with current step (top), detection chips (bottom-left), mic button (bottom-right), "I'm done" button.
5. Never call Anthropic/ElevenLabs directly. Use `supabase.functions.invoke('<fn>', { body })`.
6. Validate every response with the schema from `lib/guards.ts`.
7. After writing, run `npx tsc --noEmit` and fix errors before finishing.
