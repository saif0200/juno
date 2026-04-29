import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { Fonts } from '@/constants/theme';
import { getFileIcon } from '@/lib/file-icon';
import type { ExplorerNode } from '@/hooks/use-file-tree';

const C = {
  text: '#d1d1d1',
  muted: '#7a797a',
  selectionBg: '#163761',
};

type Props = {
  node: ExplorerNode;
  isActive: boolean;
  onPress: () => void;
};

export function FileTreeRow({ node, isActive, onPress }: Props) {
  const icon = getFileIcon(node.entry.kind, node.entry.name);
  const indent = 12 + node.depth * 14;

  return (
    <Pressable onPress={onPress} style={[styles.row, isActive && styles.rowActive]}>
      <View style={[styles.inner, { paddingLeft: indent }]}>
        {node.entry.kind === 'directory' ? (
          <MaterialIcons
            color={C.muted}
            name={node.expanded ? 'expand-more' : 'chevron-right'}
            size={14}
            style={{ width: 14 }}
          />
        ) : (
          <View style={{ width: 14 }} />
        )}
        <MaterialIcons color={icon.color} name={icon.name} size={14} />
        <Text style={styles.name} numberOfLines={1}>
          {node.entry.name}
        </Text>
        {node.loading ? <ActivityIndicator size="small" color={C.muted} /> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { marginHorizontal: 0, marginVertical: 0 },
  rowActive: { backgroundColor: C.selectionBg },
  inner: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
    minHeight: 36,
    paddingRight: 12,
  },
  name: { color: C.text, flex: 1, fontFamily: Fonts.sans, fontSize: 13 },
});
