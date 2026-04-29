import { Pressable, Text, View } from 'react-native';

import { StatusDot } from '@/components/status-dot';
import type { SavedDevice } from '@/lib/devices';
import { timeAgo } from '@/lib/format-time';

import { workspaceStyles } from './styles';

type Props = {
  device: SavedDevice;
  isSelected: boolean;
  isActive: boolean;
  onSelect: () => void;
  onConnect: () => void;
  onForget: () => void;
};

export function DeviceRow({ device, isSelected, isActive, onSelect, onConnect, onForget }: Props) {
  const dotColor = isActive ? '#15ac91' : isSelected ? '#228df2' : '#7a797a';
  const stateLabel = isActive ? 'connected' : isSelected ? 'selected' : null;
  const stateLabelColor = isActive ? '#15ac91' : '#228df2';

  return (
    <View
      style={[workspaceStyles.deviceRow, isSelected && workspaceStyles.deviceRowActive]}
    >
      <Pressable onPress={onSelect} style={workspaceStyles.deviceMain}>
        <View style={workspaceStyles.deviceTopRow}>
          <StatusDot color={dotColor} />
          {stateLabel ? (
            <Text style={[workspaceStyles.deviceState, { color: stateLabelColor }]}>
              {stateLabel}
            </Text>
          ) : null}
          <Text style={workspaceStyles.deviceName}>{device.name}</Text>
          <Text style={workspaceStyles.deviceMeta}>
            {device.lastUsedAt ? timeAgo(device.lastUsedAt) : 'never used'}
          </Text>
        </View>
        <Text style={workspaceStyles.deviceUrl} numberOfLines={1}>
          {device.wsUrl}
        </Text>
      </Pressable>
      <View style={workspaceStyles.deviceActions}>
        <Pressable onPress={onConnect} style={workspaceStyles.actionChip}>
          <Text style={workspaceStyles.actionChipText}>{isActive ? 'Refresh' : 'Connect'}</Text>
        </Pressable>
        <Pressable onPress={onForget}>
          <Text style={workspaceStyles.forgetText}>Remove</Text>
        </Pressable>
      </View>
    </View>
  );
}
