import type { PropsWithChildren, ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, font, radius, space } from '@/constants/theme';

type ButtonProps = {
  title: string;
  onPress?: () => void;
  variant?: 'primary' | 'ghost' | 'danger';
  size?: 'md' | 'lg';
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function Button({ title, onPress, variant = 'primary', size = 'md', disabled, loading, style }: ButtonProps) {
  const off = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={off}
      style={({ pressed }) => [
        s.btn,
        size === 'lg' && s.btnLg,
        variant === 'primary' && s.btnPrimary,
        variant === 'ghost' && s.btnGhost,
        variant === 'danger' && s.btnDanger,
        off && s.btnOff,
        pressed && !off && s.pressed,
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? colors.accentText : colors.text} />
      ) : (
        <Text style={[s.btnText, size === 'lg' && s.btnTextLg, variant === 'primary' ? s.btnTextPrimary : s.btnTextOther]}>{title}</Text>
      )}
    </Pressable>
  );
}

export function Chip({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'active' | 'good' | 'warn' | 'bad' }) {
  return (
    <View style={[s.chip, tone === 'active' && s.chipActive, tone === 'good' && s.chipGood, tone === 'warn' && s.chipWarn, tone === 'bad' && s.chipBad]}>
      <Text style={[s.chipText, tone === 'neutral' && { color: colors.muted }]}>{label}</Text>
    </View>
  );
}

export function Card({ children, style }: PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) {
  return <View style={[s.card, style]}>{children}</View>;
}

export function Title({ children }: { children: ReactNode }) {
  return <Text style={s.title}>{children}</Text>;
}

export function Muted({ children, size = font.body }: { children: ReactNode; size?: number }) {
  return <Text style={[s.muted, { fontSize: size }]}>{children}</Text>;
}

export function Body({ children, bold }: { children: ReactNode; bold?: boolean }) {
  return <Text style={[s.body, bold && { fontWeight: '700' }]}>{children}</Text>;
}

export function Screen({ children, padded = true, edges }: PropsWithChildren<{ padded?: boolean; edges?: ('top' | 'bottom' | 'left' | 'right')[] }>) {
  return (
    <SafeAreaView style={[s.screen, padded && { paddingHorizontal: space.md }]} edges={edges ?? ['top', 'left', 'right']}>
      {children}
    </SafeAreaView>
  );
}

export function Centered({ children }: PropsWithChildren) {
  return <View style={s.centered}>{children}</View>;
}

export function ErrorBox({ message }: { message: string }) {
  return (
    <View style={s.errorBox}>
      <Text style={s.errorText}>{message}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md, padding: space.lg },
  btn: { minHeight: 52, paddingHorizontal: space.lg, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', flexDirection: 'row' },
  btnLg: { minHeight: 64, borderRadius: radius.lg },
  btnPrimary: { backgroundColor: colors.accent },
  btnGhost: { backgroundColor: colors.card2, borderWidth: 1, borderColor: colors.border },
  btnDanger: { backgroundColor: '#3a1414', borderWidth: 1, borderColor: colors.red },
  btnOff: { opacity: 0.45 },
  pressed: { opacity: 0.8, transform: [{ scale: 0.98 }] },
  btnText: { fontSize: font.body, fontWeight: '700' },
  btnTextLg: { fontSize: font.big },
  btnTextPrimary: { color: colors.accentText },
  btnTextOther: { color: colors.text },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: colors.card2, borderWidth: 1, borderColor: colors.border },
  chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipGood: { backgroundColor: '#123a24', borderColor: colors.green },
  chipWarn: { backgroundColor: '#3a2d0f', borderColor: colors.amber },
  chipBad: { backgroundColor: '#3a1414', borderColor: colors.red },
  chipText: { color: colors.text, fontSize: 15, fontWeight: '600' },
  card: { backgroundColor: colors.card, borderRadius: radius.md, padding: space.md, gap: space.sm, borderWidth: 1, borderColor: colors.border },
  title: { color: colors.text, fontSize: font.title, fontWeight: '800', letterSpacing: -0.5 },
  muted: { color: colors.muted },
  body: { color: colors.text, fontSize: font.body, lineHeight: 24 },
  errorBox: { backgroundColor: '#3a1414', borderColor: colors.red, borderWidth: 1, borderRadius: radius.sm, padding: space.md },
  errorText: { color: '#ffb3b3', fontSize: 15 },
});
