import React from 'react';
import { ActivityIndicator, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { Colors } from '../../theme/colors';

export const settingsStyles = StyleSheet.create({
  group: { backgroundColor: Colors.dark.card, borderRadius: 18, borderWidth: 1, borderColor: Colors.dark.cardBorder, overflow: 'hidden' },
  section: { gap: 10, marginBottom: 24 },
  caption: { color: Colors.dark.textSecondary, fontSize: 10, letterSpacing: 1.8, fontWeight: '700', marginLeft: 4 },
  hint: { color: Colors.dark.textSecondary, fontSize: 12, lineHeight: 19, marginHorizontal: 4 },
  form: { padding: 18, gap: 14 },
  label: { fontSize: 12, color: '#C0C3D0', fontWeight: '600', marginBottom: 7 },
  input: { minHeight: 48, backgroundColor: '#10121B', borderWidth: 1, borderColor: '#2A2E40', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, color: '#FFF', fontSize: 15 },
  actions: { flexDirection: 'row', gap: 10, alignItems: 'center', flexWrap: 'wrap' },
  status: { color: '#82CDB1', fontSize: 12, lineHeight: 18 },
  note: { backgroundColor: '#818CF80C', borderColor: '#818CF825', borderWidth: 1, borderRadius: 14, padding: 15 },
});

export function SettingsSection({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return <View style={settingsStyles.section}><Text style={settingsStyles.caption}>{title.toUpperCase()}</Text>
    <View style={settingsStyles.group}>{children}</View>{hint && <Text style={settingsStyles.hint}>{hint}</Text>}
  </View>;
}

interface RowProps {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  value?: string;
  onPress?: () => void;
  toggle?: boolean;
  onToggle?: (value: boolean) => void;
  danger?: boolean;
  last?: boolean;
  busy?: boolean;
}
export function SettingsRow({ title, subtitle, icon, value, onPress, toggle, onToggle, danger, last, busy }: RowProps) {
  const content = <>
    {icon && <View style={[styles.icon, danger && styles.dangerIcon]}>{icon}</View>}
    <View style={styles.copy}><Text style={[styles.title, danger && styles.danger]}>{title}</Text>
      {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
    </View>
    {busy ? <ActivityIndicator size="small" color={Colors.dark.primaryLight} /> : onToggle ? <Switch accessibilityLabel={title} value={toggle} onValueChange={onToggle}
      trackColor={{ false: '#343848', true: Colors.dark.primary }} thumbColor="#FFF" /> : <>
      {value && <Text style={styles.value} numberOfLines={1}>{value}</Text>}
      {onPress && <ChevronRight size={16} color={Colors.dark.textMuted} />}
    </>}
  </>;
  const rowStyle = [styles.row, !last && styles.divider];
  return onPress ? <TouchableOpacity accessibilityRole="button" accessibilityLabel={title} onPress={onPress} disabled={busy} activeOpacity={0.65} style={rowStyle}>{content}</TouchableOpacity>
    : <View style={rowStyle}>{content}</View>;
}

export function SettingsButton({ title, onPress, secondary, danger, busy, disabled }: {
  title: string; onPress: () => void; secondary?: boolean; danger?: boolean; busy?: boolean; disabled?: boolean;
}) {
  return <TouchableOpacity accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ disabled: disabled || busy }}
    disabled={disabled || busy} onPress={onPress} activeOpacity={0.7}
    style={[styles.button, secondary && styles.secondary, danger && styles.dangerButton, (disabled || busy) && styles.disabled]}>
    {busy ? <ActivityIndicator size="small" color="#FFF" /> : <Text style={[styles.buttonText, danger && styles.danger]}>{title}</Text>}
  </TouchableOpacity>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 16, minHeight: 68 },
  divider: { borderBottomWidth: 1, borderBottomColor: Colors.dark.divider },
  icon: { width: 34, height: 34, borderRadius: 11, backgroundColor: '#818CF811', justifyContent: 'center', alignItems: 'center' },
  dangerIcon: { backgroundColor: '#EF44440D' },
  copy: { flex: 1, gap: 4 },
  title: { color: '#ECEEF5', fontSize: 14, fontWeight: '500' },
  subtitle: { fontSize: 11, color: Colors.dark.textSecondary, lineHeight: 17 },
  value: { color: Colors.dark.textSecondary, fontSize: 12, maxWidth: '38%' },
  danger: { color: '#F28B94' },
  button: { minHeight: 46, paddingHorizontal: 18, paddingVertical: 12, borderRadius: 12, backgroundColor: Colors.dark.primary, alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: '#FFF', fontWeight: '600', fontSize: 13 },
  secondary: { backgroundColor: '#282D40' },
  dangerButton: { backgroundColor: '#EF44440E' },
  disabled: { opacity: 0.5 },
});
