import { Pressable, Text, View } from 'react-native';

import { StatusDot } from '@/components/status-dot';
import { timeAgo } from '@/lib/format-time';
import type { SessionSummary } from '@/lib/terminal';

import { workspaceStyles } from './styles';

type Props = {
  session: SessionSummary;
  disabled: boolean;
  onPress: () => void;
};

export function SessionRow({ session, disabled, onPress }: Props) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[workspaceStyles.fileRow, disabled && workspaceStyles.rowDisabled]}
    >
      <StatusDot color={session.hasActiveProcess ? '#15ac91' : '#7a797a'} />
      <View style={workspaceStyles.fileInfo}>
        <Text style={workspaceStyles.fileName}>{session.projectName}</Text>
        <Text style={workspaceStyles.filePath} numberOfLines={1}>
          {session.hasActiveProcess ? 'running' : 'exited'} · {timeAgo(session.updatedAt)}
          {session.sharedSessionName ? ` · ${session.sharedSessionName}` : ''}
        </Text>
      </View>
      <Text style={workspaceStyles.chevron}>›</Text>
    </Pressable>
  );
}
