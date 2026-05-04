import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, Modal, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { theme } from '../utils/theme';

// QR scanner modal. Reads a `playfool://pair?a=IP:PORT&p=PIN` QR code
// shown by the desktop SyncDialog and hands the parsed values back.
export default function QrScanner({ visible, onClose, onScan }) {
  const [permission, requestPermission] = useCameraPermissions();
  const handledRef = useRef(false);

  useEffect(() => {
    if (visible) handledRef.current = false;
  }, [visible]);

  useEffect(() => {
    if (visible && permission && !permission.granted && permission.canAskAgain) {
      requestPermission();
    }
  }, [visible, permission, requestPermission]);

  const onResult = (event) => {
    if (handledRef.current) return;
    const data = event?.data || '';
    // Accept both playfool://pair?... and a bare "ip:port|pin" or JSON
    let address = '';
    let pin = '';
    try {
      if (data.startsWith('playfool://')) {
        // Parse "playfool://pair?a=IP:PORT&p=PIN" without relying on URL polyfill.
        const qIndex = data.indexOf('?');
        if (qIndex < 0) return;
        const qs = data.slice(qIndex + 1);
        for (const part of qs.split('&')) {
          const [k, v] = part.split('=');
          if (k === 'a') address = decodeURIComponent(v || '');
          if (k === 'p') pin = decodeURIComponent(v || '');
        }
      } else if (data.startsWith('{')) {
        const j = JSON.parse(data);
        address = j.a || j.address || '';
        pin = j.p || j.pin || '';
      } else {
        return;
      }
    } catch (e) { return; }
    if (!address || !pin) return;
    handledRef.current = true;
    onScan({ address, pin });
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} hitSlop={12}>
            <Ionicons name="close" size={28} color={theme.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.title}>Scan PC's QR code</Text>
          <View style={{ width: 28 }} />
        </View>

        {!permission ? (
          <View style={styles.center}>
            <ActivityIndicator color={theme.green} />
          </View>
        ) : !permission.granted ? (
          <View style={styles.center}>
            <Ionicons name="camera-outline" size={48} color={theme.textMuted} />
            <Text style={styles.helpTitle}>Camera permission needed</Text>
            <Text style={styles.helpText}>
              We use the camera only to scan the sync QR code shown on your PC.
            </Text>
            <TouchableOpacity onPress={requestPermission} style={styles.primary}>
              <Text style={styles.primaryText}>Grant access</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={{ flex: 1 }}>
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={onResult}
            />
            <View style={styles.overlay} pointerEvents="none">
              <View style={styles.frame} />
              <Text style={styles.hint}>Point at the QR code on your PC</Text>
            </View>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8,
    backgroundColor: theme.bgPrimary,
  },
  title: { color: theme.textPrimary, fontSize: 16, fontWeight: '700' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  helpTitle: { color: theme.textPrimary, fontSize: 16, fontWeight: '700', marginTop: 12 },
  helpText: { color: theme.textSecondary, fontSize: 13, textAlign: 'center', paddingHorizontal: 16 },
  primary: {
    marginTop: 16, backgroundColor: theme.green, paddingHorizontal: 18, paddingVertical: 10,
    borderRadius: 24,
  },
  primaryText: { color: '#000', fontWeight: '700' },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center', justifyContent: 'center',
  },
  frame: {
    width: 240, height: 240, borderRadius: 16,
    borderWidth: 3, borderColor: theme.green,
    backgroundColor: 'transparent',
  },
  hint: {
    color: '#fff', fontSize: 13, fontWeight: '600',
    marginTop: 16, textShadowColor: '#000', textShadowRadius: 4,
  },
});
