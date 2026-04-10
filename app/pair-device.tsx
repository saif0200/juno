import { CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Colors, Fonts } from '@/constants/theme';
import { setPendingDeviceId, upsertSavedDevice } from '@/lib/devices';
import { parsePairingScan } from '@/lib/pairing';
import { useColorScheme } from '@/hooks/use-color-scheme';

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
          <ThemedText style={styles.eyebrow}>Pair Device</ThemedText>
          <ThemedText type="title" style={styles.title}>
            Scan your local relay QR
          </ThemedText>
          <ThemedText style={styles.description}>
            Juno accepts a direct pairing payload or a local pairing endpoint URL. The scanned device
            is saved locally and returned to the Terminal launcher.
          </ThemedText>
        </View>

        {!permission ? (
          <View style={styles.stateCard}>
            <ThemedText style={styles.stateTitle}>Checking camera permission…</ThemedText>
          </View>
        ) : null}

        {permission && !permission.granted ? (
          <View style={styles.stateCard}>
            <ThemedText style={styles.stateTitle}>Camera access is required to scan pairing QR codes.</ThemedText>
            <Pressable onPress={() => void requestPermission()} style={styles.primaryButton}>
              <ThemedText style={styles.primaryButtonText}>Allow camera</ThemedText>
            </Pressable>
            <Pressable onPress={() => router.back()} style={styles.secondaryButton}>
              <ThemedText style={styles.secondaryButtonText}>Use manual entry instead</ThemedText>
            </Pressable>
          </View>
        ) : null}

        {permission?.granted ? (
          <View style={styles.scannerShell}>
            <CameraView
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              facing="back"
              onBarcodeScanned={scannerEnabled ? ({ data }) => void handleBarcodeScan(data) : undefined}
              style={styles.camera}
            />
            <View pointerEvents="none" style={styles.overlay}>
              <View style={styles.scanFrame} />
            </View>
          </View>
        ) : null}

        <View style={styles.footer}>
          <ThemedText style={styles.footerText}>
            Expected fields: `name`, `wsUrl`, optional `httpUrl`, optional `token`, optional
            `capabilities`.
          </ThemedText>
          {errorMessage ? <ThemedText style={styles.errorText}>{errorMessage}</ThemedText> : null}
          {permission?.granted && !scannerEnabled ? (
            <Pressable
              onPress={() => {
                setErrorMessage(null);
                setIsHandlingScan(false);
              }}
              style={styles.secondaryButton}>
              <ThemedText style={styles.secondaryButtonText}>Scan another code</ThemedText>
            </Pressable>
          ) : null}
          <Pressable onPress={() => router.back()} style={styles.secondaryButton}>
            <ThemedText style={styles.secondaryButtonText}>Back to Terminal</ThemedText>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  container: {
    flex: 1,
    gap: 20,
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  copyBlock: {
    gap: 8,
  },
  eyebrow: {
    color: '#0f766e',
    fontFamily: Fonts.mono,
    fontSize: 12,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  title: {
    fontFamily: Fonts.rounded,
    lineHeight: 38,
  },
  description: {
    color: '#64748b',
  },
  stateCard: {
    alignItems: 'center',
    backgroundColor: '#ecfeff',
    borderColor: '#99f6e4',
    borderRadius: 24,
    borderWidth: 1,
    gap: 14,
    padding: 20,
  },
  stateTitle: {
    fontFamily: Fonts.rounded,
    fontSize: 18,
    textAlign: 'center',
  },
  scannerShell: {
    flex: 1,
    minHeight: 320,
    overflow: 'hidden',
    borderRadius: 28,
  },
  camera: {
    flex: 1,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanFrame: {
    borderColor: 'rgba(255,255,255,0.92)',
    borderRadius: 28,
    borderWidth: 3,
    height: 240,
    width: 240,
  },
  footer: {
    gap: 12,
  },
  footerText: {
    color: '#64748b',
    fontFamily: Fonts.mono,
    fontSize: 12,
    lineHeight: 18,
  },
  errorText: {
    color: '#dc2626',
    fontFamily: Fonts.mono,
    fontSize: 12,
  },
  primaryButton: {
    backgroundColor: '#0f766e',
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  primaryButtonText: {
    color: '#f8fafc',
    fontFamily: Fonts.mono,
    fontSize: 13,
    fontWeight: '700',
  },
  secondaryButton: {
    alignItems: 'center',
    borderColor: '#cbd5e1',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  secondaryButtonText: {
    color: '#334155',
    fontFamily: Fonts.mono,
    fontSize: 13,
    fontWeight: '600',
  },
});
