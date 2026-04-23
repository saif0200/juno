import { CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Fonts } from '@/constants/theme';
import { setPendingDeviceId, upsertSavedDevice } from '@/lib/devices';
import { parsePairingScan } from '@/lib/pairing';

const C = {
  bg: '#181818',
  surface: '#1d1d1d',
  border: '#383838',
  text: '#d6d6dd',
  muted: '#7a797a',
  accent: '#228df2',
  danger: '#f14c4c',
};

export default function PairDeviceScreen() {
  const { width } = useWindowDimensions();
  const [permission, requestPermission] = useCameraPermissions();
  const [isHandlingScan, setIsHandlingScan] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleBarcodeScan(data: string): Promise<void> {
    if (isHandlingScan) return;
    setIsHandlingScan(true);
    setErrorMessage(null);
    try {
      const payload = await parsePairingScan(data);
      const device = await upsertSavedDevice({
        name: payload.name,
        wsUrl: payload.wsUrl,
        httpUrl: payload.httpUrl,
        token: payload.token,
        capabilities: payload.capabilities,
        source: 'qr',
      });
      await setPendingDeviceId(device.id);
      router.back();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not parse QR code.');
      setIsHandlingScan(false);
    }
  }

  const scannerEnabled = Boolean(permission?.granted) && !isHandlingScan;

  return (
    <SafeAreaView style={styles.root}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>← back</Text>
        </Pressable>
        <Text style={styles.headerTitle}>pair device</Text>
        <View style={{ width: 60 }} />
      </View>

      <View style={styles.body}>
        {/* Camera */}
        {!permission ? (
          <View style={styles.cameraShell}>
            <Text style={styles.mutedText}>Checking camera…</Text>
          </View>
        ) : !permission.granted ? (
          <View style={[styles.cameraShell, styles.permissionCard]}>
            <Text style={styles.permissionText}>Camera access required to scan QR codes.</Text>
            <Pressable onPress={() => void requestPermission()} style={styles.allowBtn}>
              <Text style={styles.allowBtnText}>Allow camera</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.cameraShell}>
            <CameraView
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              facing="back"
              onBarcodeScanned={scannerEnabled ? ({ data }) => void handleBarcodeScan(data) : undefined}
              style={styles.camera}
            />
            <View pointerEvents="none" style={styles.overlay}>
              <View style={[styles.scanFrame, { width: width * 0.6, height: width * 0.6 }]} />
            </View>
          </View>
        )}

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.footerHint}>
            Scan the QR code shown by <Text style={{ color: C.text }}>npm run dev</Text> in the relay server.
          </Text>

          {errorMessage ? (
            <View style={styles.errorRow}>
              <Text style={styles.errorText}>{errorMessage}</Text>
            </View>
          ) : null}

          {isHandlingScan ? (
            <Text style={[styles.footerHint, { color: C.accent }]}>Connecting…</Text>
          ) : null}

          {permission?.granted && !scannerEnabled ? (
            <Pressable onPress={() => { setErrorMessage(null); setIsHandlingScan(false); }} style={styles.retryBtn}>
              <Text style={styles.retryText}>Scan again</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: C.bg, flex: 1 },
  header: {
    alignItems: 'center',
    borderBottomColor: C.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 44,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  backBtn: { minHeight: 44, justifyContent: 'center', paddingVertical: 4, width: 60 },
  backText: { color: C.accent, fontFamily: Fonts.sans, fontSize: 12 },
  headerTitle: { color: C.muted, fontFamily: Fonts.sans, fontSize: 10, fontWeight: '500', letterSpacing: 0.8 },
  body: { flex: 1, gap: 16, padding: 16 },
  cameraShell: {
    backgroundColor: C.surface,
    borderColor: C.border,
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  permissionCard: { gap: 16, padding: 24 },
  permissionText: { color: C.muted, fontFamily: Fonts.sans, fontSize: 12, lineHeight: 18, textAlign: 'center' },
  allowBtn: {
    backgroundColor: C.accent,
    borderRadius: 6,
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  allowBtnText: { color: '#181818', fontFamily: Fonts.sans, fontSize: 12, fontWeight: '500' },
  camera: { ...StyleSheet.absoluteFillObject },
  overlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  scanFrame: {
    borderColor: '#d6d6dd',
    borderRadius: 12,
    borderWidth: 2,
  },
  mutedText: { color: C.muted, fontFamily: Fonts.sans, fontSize: 12 },
  footer: { gap: 10, paddingBottom: 8 },
  footerHint: { color: C.muted, fontFamily: Fonts.sans, fontSize: 12, lineHeight: 18 },
  errorRow: {
    backgroundColor: 'rgba(241,76,76,0.08)',
    borderColor: 'rgba(241,76,76,0.25)',
    borderRadius: 4,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  errorText: { color: C.danger, fontFamily: Fonts.sans, fontSize: 12 },
  retryBtn: {
    alignItems: 'center',
    backgroundColor: C.surface,
    borderColor: C.border,
    borderRadius: 6,
    borderWidth: 1,
    minHeight: 44,
    justifyContent: 'center',
    paddingVertical: 10,
  },
  retryText: { color: C.text, fontFamily: Fonts.sans, fontSize: 12, fontWeight: '500' },
});
