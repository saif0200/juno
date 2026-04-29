import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Fonts } from '@/constants/theme';
import type { TabsSnapshot } from '@/lib/terminal-tabs';

const C = {
  bg: '#181818',
  surface: '#1d1d1d',
  surfaceActive: '#2a282a',
  border: '#383838',
  text: '#d6d6dd',
  muted: '#7a797a',
  success: '#15ac91',
};

type Props = {
  visible: boolean;
  snapshot: TabsSnapshot;
  onClose: () => void;
  onActivate: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
};

export function TabSheet({ visible, snapshot, onClose, onActivate, onCloseTab }: Props) {
  return (
    <Modal animationType="slide" transparent visible={visible} onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.title}>Terminals</Text>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
            {snapshot.tabs.length === 0 ? (
              <Text style={styles.empty}>No open terminals.</Text>
            ) : (
              snapshot.tabs.map((tab) => {
                const isActive = tab.id === snapshot.activeTabId;
                return (
                  <View key={tab.id} style={[styles.row, isActive && styles.rowActive]}>
                    <Pressable
                      onPress={() => {
                        onActivate(tab.id);
                        onClose();
                      }}
                      style={styles.rowMain}
                    >
                      <View style={styles.rowTop}>
                        <View
                          style={[
                            styles.dot,
                            { backgroundColor: tab.status === 'live' ? C.success : C.muted },
                          ]}
                        />
                        <Text style={styles.rowName} numberOfLines={1}>
                          {tab.projectName}
                        </Text>
                      </View>
                      <Text style={styles.rowMeta}>{tab.status}</Text>
                    </Pressable>
                    <Pressable onPress={() => onCloseTab(tab.id)} style={styles.closeBtn}>
                      <MaterialIcons color={C.muted} name="close" size={14} />
                    </Pressable>
                  </View>
                );
              })
            )}
          </ScrollView>
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: 'rgba(0,0,0,0.6)', flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: C.surface,
    borderTopColor: C.border,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    borderTopWidth: 1,
    maxHeight: '80%',
    paddingBottom: 8,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  handle: {
    alignSelf: 'center',
    backgroundColor: C.border,
    borderRadius: 99,
    height: 4,
    marginBottom: 14,
    width: 36,
  },
  title: {
    color: C.text,
    fontFamily: Fonts.sans,
    fontSize: 10,
    fontWeight: '500',
    letterSpacing: 0.8,
    marginBottom: 12,
    textTransform: 'uppercase',
  },
  content: { gap: 1, paddingBottom: 40 },
  empty: { color: C.muted, fontFamily: Fonts.sans, fontSize: 12, paddingVertical: 8 },
  row: {
    backgroundColor: C.surface,
    borderBottomColor: C.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 4,
    marginBottom: -1,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  rowActive: { backgroundColor: C.surfaceActive },
  rowMain: { flex: 1, gap: 3 },
  rowTop: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  dot: { borderRadius: 99, flexShrink: 0, height: 6, width: 6 },
  rowName: { color: '#d1d1d1', flex: 1, fontFamily: Fonts.sans, fontSize: 13, fontWeight: '400' },
  rowMeta: { color: C.muted, fontFamily: Fonts.sans, fontSize: 11 },
  closeBtn: { alignItems: 'center', height: 36, justifyContent: 'center', width: 36 },
});
