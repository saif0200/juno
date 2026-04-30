import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { Fonts } from '@/constants/theme';

const C = {
  surface: '#1d1d1d',
  surfaceActive: '#2a282a',
  border: '#383838',
  text: '#d6d6dd',
  muted: '#7a797a',
  accent: '#228df2',
};

export type AiCommandKey = 'claude' | 'codex' | 'opencode' | 'shell';

interface Option {
  key: AiCommandKey;
  label: string;
  hint: string;
}

const OPTIONS: Option[] = [
  { key: 'claude', label: 'Claude', hint: 'claude code (default)' },
  { key: 'codex', label: 'Codex', hint: 'openai codex cli' },
  { key: 'opencode', label: 'OpenCode', hint: 'opencode cli' },
  { key: 'shell', label: 'Shell', hint: 'plain login shell' },
];

type Props = {
  visible: boolean;
  projectName: string | null;
  onCancel: () => void;
  onSelect: (command: AiCommandKey) => void;
};

export function CommandPicker({ visible, projectName, onCancel, onSelect }: Props) {
  return (
    <Modal animationType="fade" transparent visible={visible} onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.title}>Open with</Text>
          {projectName ? (
            <Text style={styles.subtitle} numberOfLines={1}>
              {projectName}
            </Text>
          ) : null}
          <View style={styles.options}>
            {OPTIONS.map((option) => (
              <Pressable
                key={option.key}
                onPress={() => onSelect(option.key)}
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              >
                <View style={styles.rowText}>
                  <Text style={styles.rowLabel}>{option.label}</Text>
                  <Text style={styles.rowHint}>{option.hint}</Text>
                </View>
                <Text style={styles.chevron}>›</Text>
              </Pressable>
            ))}
          </View>
          <Pressable onPress={onCancel} style={styles.cancel}>
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    backgroundColor: 'rgba(0,0,0,0.55)',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  sheet: {
    backgroundColor: C.surface,
    borderColor: C.border,
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 18,
    paddingHorizontal: 18,
  },
  title: {
    color: C.muted,
    fontFamily: Fonts.sans,
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  subtitle: {
    color: C.text,
    fontFamily: Fonts.sans,
    fontSize: 14,
    fontWeight: '500',
    marginTop: 4,
    marginBottom: 14,
  },
  options: { gap: 1 },
  row: {
    alignItems: 'center',
    backgroundColor: C.surface,
    borderBottomColor: C.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    paddingHorizontal: 4,
    paddingVertical: 12,
  },
  rowPressed: { backgroundColor: C.surfaceActive },
  rowText: { flex: 1, gap: 2 },
  rowLabel: {
    color: C.text,
    fontFamily: Fonts.sans,
    fontSize: 14,
    fontWeight: '500',
  },
  rowHint: { color: C.muted, fontFamily: Fonts.mono, fontSize: 11 },
  chevron: { color: C.muted, fontFamily: Fonts.sans, fontSize: 16 },
  cancel: { alignItems: 'center', marginTop: 14, paddingVertical: 8 },
  cancelText: { color: C.accent, fontFamily: Fonts.sans, fontSize: 13, fontWeight: '500' },
});
