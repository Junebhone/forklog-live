import { useEffect } from 'react';
import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { colors } from '@/constants/theme';
import { initAudio } from '@/lib/voice';

const theme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: colors.bg, card: colors.bg, text: colors.text, primary: colors.accent, border: colors.border },
};

export default function RootLayout() {
  useEffect(() => {
    initAudio().catch(e => console.warn('audio mode', e));
  }, []);

  return (
    <ThemeProvider value={theme}>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.bg },
          headerTintColor: colors.text,
          headerTitleStyle: { fontWeight: '700' },
          contentStyle: { backgroundColor: colors.bg },
          headerBackButtonDisplayMode: 'minimal',
        }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="cook/[recipeId]" options={{ headerShown: false, gestureEnabled: false }} />
        <Stack.Screen name="recap/[cookId]" options={{ title: 'Recap', headerBackVisible: false, gestureEnabled: false }} />
        <Stack.Screen name="history/[recipeId]" options={{ title: 'Versions' }} />
      </Stack>
    </ThemeProvider>
  );
}
