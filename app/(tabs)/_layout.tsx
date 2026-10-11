import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { colors } from '@/constants/theme';

export default function TabsLayout() {
  return (
    <NativeTabs backgroundColor={colors.bg} indicatorColor={colors.card2} labelStyle={{ selected: { color: colors.accent } }}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Library</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="book.fill" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="import">
        <NativeTabs.Trigger.Label>Import</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="plus.circle.fill" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
