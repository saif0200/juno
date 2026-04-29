import { Pressable, Text, View } from 'react-native';

import type { ProjectDefinition } from '@/lib/terminal';

import { workspaceStyles } from './styles';

type Props = {
  project: ProjectDefinition;
  disabled: boolean;
  onPress: () => void;
};

export function ProjectRow({ project, disabled, onPress }: Props) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[workspaceStyles.fileRow, disabled && workspaceStyles.rowDisabled]}
    >
      <Text style={workspaceStyles.fileIcon}>⬡</Text>
      <View style={workspaceStyles.fileInfo}>
        <Text style={workspaceStyles.fileName}>{project.name}</Text>
        <Text style={workspaceStyles.filePath} numberOfLines={1}>
          {project.path}
        </Text>
      </View>
      <Text style={workspaceStyles.chevron}>›</Text>
    </Pressable>
  );
}
