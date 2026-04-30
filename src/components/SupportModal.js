import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, Modal, StyleSheet, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../utils/theme';

const KOFI_URL = 'https://ko-fi.com/PullFool';

export default function SupportModal({ open, alreadyHearted = false, onClose, onLike, onDonate, onDontAskAgain }) {
  const [stage, setStage] = useState(alreadyHearted ? 'donate' : 'ask');

  useEffect(() => {
    if (open) setStage(alreadyHearted ? 'donate' : 'ask');
  }, [open, alreadyHearted]);

  const openKofi = () => {
    Linking.openURL(KOFI_URL);
    if (onDonate) onDonate();
    onClose();
  };

  const handleLike = () => {
    if (onLike) onLike();
    setStage('donate');
  };

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={styles.modal} onPress={() => {}}>
          <TouchableOpacity onPress={onClose} style={styles.close}>
            <Ionicons name="close" size={20} color={theme.textSecondary} />
          </TouchableOpacity>

          <Ionicons name="heart" size={56} color={theme.red} style={{ marginBottom: 8 }} />

          {stage === 'ask' ? (
            <>
              <Text style={styles.title}>Do you like PlayFool?</Text>
              <Text style={styles.body}>
                Your answer helps me understand if I'm building something people actually enjoy. No data, no tracking — just a count. 🙏
              </Text>
              <View style={styles.actions}>
                <TouchableOpacity style={styles.primary} onPress={handleLike}>
                  <Ionicons name="heart" size={16} color="#fff" />
                  <Text style={styles.primaryText}>Yes, I love it!</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.secondary} onPress={onClose}>
                  <Text style={styles.secondaryText}>Not yet</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <>
              <Text style={styles.title}>Thanks for the love! 💚</Text>
              <Text style={styles.body}>
                PlayFool is free and ad-free.{'\n'}
                Would you like to support development with a small donation? ☕
              </Text>
              <View style={styles.actions}>
                <TouchableOpacity style={[styles.primary, { backgroundColor: '#13c3ff' }]} onPress={openKofi}>
                  <Text style={[styles.primaryText, { color: '#fff' }]}>☕ Yes, support on Ko-fi</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.secondary} onPress={onClose}>
                  <Text style={styles.secondaryText}>Maybe later</Text>
                </TouchableOpacity>
                {onDontAskAgain ? (
                  <TouchableOpacity style={styles.tertiary} onPress={onDontAskAgain}>
                    <Text style={styles.tertiaryText}>Don't ask again</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </>
          )}
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center', alignItems: 'center', padding: 24,
  },
  modal: {
    backgroundColor: theme.bgSecondary, borderRadius: 12, padding: 24,
    width: '100%', maxWidth: 420, alignItems: 'center',
    borderWidth: 1, borderColor: theme.border,
  },
  close: { position: 'absolute', top: 12, right: 12, padding: 4, zIndex: 1 },
  title: { color: theme.textPrimary, fontSize: 20, fontWeight: '700', marginBottom: 12, textAlign: 'center' },
  body: { color: theme.textSecondary, fontSize: 13, lineHeight: 20, textAlign: 'center', marginBottom: 20 },
  actions: { gap: 8, width: '100%' },
  primary: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, backgroundColor: theme.red, paddingVertical: 12, borderRadius: 24,
  },
  primaryText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  secondary: {
    paddingVertical: 12, borderRadius: 24, alignItems: 'center',
    borderWidth: 1, borderColor: theme.border, backgroundColor: 'transparent',
  },
  secondaryText: { color: theme.textSecondary, fontWeight: '600', fontSize: 14 },
  tertiary: { paddingVertical: 8, alignItems: 'center' },
  tertiaryText: { color: theme.textSecondary, fontSize: 12, opacity: 0.7 },
});
