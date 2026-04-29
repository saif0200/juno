import { StyleSheet, View } from 'react-native';

export function StatusDot({ color }: { color: string }) {
  return <View style={[styles.dot, { backgroundColor: color }]} />;
}

const styles = StyleSheet.create({
  dot: { borderRadius: 99, height: 6, width: 6 },
});
