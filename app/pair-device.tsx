import { CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { setPendingDeviceId, upsertSavedDevice } from '@/lib/devices';
import { parsePairingScan } from '@/lib/pairing';

export default function PairDeviceScreen() {
  const colorScheme = useColorScheme() ?? 'dark';
  const palette = Colors[colorScheme];
  const [permission, requestPermission] = useCameraPermissions();
  const [isHandlingScan, setIsHandlingScan] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleBarcodeScan(data: string): Promise<void> {
    if (isHandlingScan) {
      return;
    }

    setIsHandlingScan(true);
    setErrorMessage(null);

    try {
      const pairingPayload = await parsePairingScan(data);
      const savedDevice = await upsertSavedDevice({
        name: pairingPayload.name,
        wsUrl: pairingPayload.wsUrl,
        httpUrl: pairingPayload.httpUrl,
        token: pairingPayload.token,
        capabilities: pairingPayload.capabilities,
        source: 'qr',
      });

      await setPendingDeviceId(savedDevice.id);
      router.back();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not parse the scanned QR code.');
      setIsHandlingScan(false);
    }
  }

  const scannerEnabled = Boolean(permission?.granted) && !isHandlingScan;

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}>
      <View style={styles.container}>
        <View style={styles.copyBlock}>
          <ThemedText style={[styles.eyebrow, { color: palette.muted }]}>Pair Device</ThemedText>
          <ThemedText type="title" style={styles.title}>
            Scan a relay QR and return to work.
          </ThemedText>
          <ThemedText style={[styles.description, { color: palette.muted }]}>
            Pairing stores the relay on this phone and brings you back with that device selected.
          </ThemedText>
        </View>

        {!permission ? (
          <StateCard palette={palette} title="Checking camera permission…" />
        ) : null}

        {permission && !permission.granted ? (
          <View style={[styles.stateCard, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            <ThemedText style={styles.stateTitle}>Camera access is required to scan pairing QR codes.</ThemedText>
            <Pressable onPress={() => void requestPermission()} style={[styles.primaryButton, { backgroundColor: palette.text }]}>
              <ThemedText style={[styles.primaryButtonText, { color: palette.background }]}>Allow camera</ThemedText>
            </Pressable>
          </View>
        ) : null}

        {permission?.granted ? (
          <View style={[styles.scannerShell, { borderColor: palette.border }]}>
            <CameraView
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              facing="back"
              onBarcodeScanned={scannerEnabled ? ({ data }) => void handleBarcodeScan(data) : undefined}
              style={styles.camera}
            />
            <View pointerEvents="none" style={styles.overlay}>
              <View style={styles.scanMask}>
                <View style={styles.scanFrame} />
              </View>
            </View>
          </View>
        ) : null}

        <View style={styles.footer}>
          <ThemedText style={[styles.footerText, { color: palette.muted }]}>Expected payload includes a relay `wsUrl` and optional metadata.</ThemedText>
          {errorMessage ? (
            <ThemedText style={[styles.errorText, { color: palette.danger }]}>{errorMessage}</ThemedText>
          ) : null}
          {permission?.granted && !scannerEnabled ? (
            <Pressable
              onPress={() => {
                setErrorMessage(null);
                setIsHandlingScan(false);
              }}
              style={[styles.secondaryButton, { backgroundColor: palette.surfaceMuted, borderColor: palette.border }]}>
              <ThemedText style={[styles.secondaryButtonText, { color: palette.text }]}>Scan another code</ThemedText>
            </Pressable>
          ) : null}
          <Pressable
            onPress={() => router.back()}
            style={[styles.secondaryButton, { backgroundColor: palette.surfaceMuted, borderColor: palette.border }]}>
            <ThemedText style={[styles.secondaryButtonText, { color: palette.text }]}>Back to workspace</ThemedText>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

function StateCard({
  palette,
  title,
}: {
  palette: (typeof Colors)['light'];
  title: string;
}) {
  return (
    <View style={[styles.stateCard, { backgroundColor: palette.surface, borderColor: palette.border }]}>
      <ThemedText style={styles.stateTitle}>{title}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  container: {
    flex: 1,
    gap: 22,
    paddingHorizontal: 20,
    paddingVertical: 18,
  },
  copyBlock: {
    gap: 10,
  },
  eyebrow: {
    fontFamily: Fonts.mono,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  title: {
    fontFamily: Fonts.rounded,
    fontSize: 32,
    lineHeight: 36,
    maxWidth: 320,
  },
  description: {
    fontSize: 15,
    lineHeight: 24,
    maxWidth: 340,
  },
  stateCard: {
    alignItems: 'center',
    borderRadius: 28,
    borderWidth: 1,
    gap: 14,
    padding: 22,
  },
  stateTitle: {
    fontFamily: Fonts.rounded,
    fontSize: 20,
    lineHeight: 26,
    textAlign: 'center',
  },
  scannerShell: {
    borderRadius: 32,
    borderWidth: 1,
    flex: 1,
    minHeight: 340,
    overflow: 'hidden',
  },
  camera: {
    flex: 1,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
  },
  scanMask: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    backgroundColor: 'rgba(9, 9, 11, 0.18)',
    justifyContent: 'center',
  },
  scanFrame: {
    borderColor: 'rgba(255,255,255,0.92)',
    borderRadius: 30,
    borderWidth: 3,
    height: 230,
    width: 230,
  },
  footer: {
    gap: 12,
  },
  footerText: {
    fontFamily: Fonts.mono,
    fontSize: 12,
    lineHeight: 18,
  },
  errorText: {
    fontFamily: Fonts.mono,
    fontSize: 12,
    lineHeight: 18,
  },
  primaryButton: {
    alignItems: 'center',
    borderRadius: 18,
    paddingHorizontal: 18,
    paddingVertical: 16,
    width: '100%',
  },
  primaryButtonText: {
    fontFamily: Fonts.rounded,
    fontSize: 16,
    fontWeight: '700',
  },
  secondaryButton: {
    alignItems: 'center',
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 18,
    paddingVertical: 15,
  },
  secondaryButtonText: {
    fontFamily: Fonts.mono,
    fontSize: 13,
    fontWeight: '700',
  },
});
