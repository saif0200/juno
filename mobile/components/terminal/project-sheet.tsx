import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Fonts } from '@/constants/theme';
import type { ProjectDefinition } from '@/lib/terminal';

const C = {
  surface: '#1d1d1d',
  border: '#383838',
  text: '#d6d6dd',
  muted: '#7a797a',
};

type Props = {
  visible: boolean;
  loading: boolean;
  projects: ProjectDefinition[];
  onClose: () => void;
  onSelect: (project: ProjectDefinition) => void;
};

export function ProjectSheet({ visible, loading, projects, onClose, onSelect }: Props) {
  return (
    <Modal animationType="slide" transparent visible={visible} onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.title}>Open project</Text>
          {loading ? <ActivityIndicator color={C.muted} style={{ marginBottom: 12 }} /> : null}
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
            {projects.map((project) => (
              <Pressable
                key={project.id}
                onPress={() => onSelect(project)}
                style={styles.row}
              >
                <Text style={styles.rowName}>{project.name}</Text>
                <Text style={styles.rowMeta} numberOfLines={1}>
                  {project.path}
                </Text>
              </Pressable>
            ))}
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
  row: {
    backgroundColor: C.surface,
    borderBottomColor: C.border,
    borderBottomWidth: 1,
    gap: 4,
    marginBottom: -1,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  rowName: { color: '#d1d1d1', fontFamily: Fonts.sans, fontSize: 13, fontWeight: '400' },
  rowMeta: { color: C.muted, fontFamily: Fonts.sans, fontSize: 11 },
});
