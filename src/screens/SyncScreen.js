import React, { useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, Modal, ScrollView, StyleSheet, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../utils/theme';
import { getPairing, setPairing, pairWith, planSync, runSync } from '../utils/sync';

// Parse "playfool://pair?a=IP:PORT&p=PIN" pasted from a QR scanner app.
function parsePairLink(text) {
  if (!text || !text.startsWith('playfool://')) return null;
  const q = text.indexOf('?');
  if (q < 0) return null;
  const out = { address: '', pin: '' };
  for (const part of text.slice(q + 1).split('&')) {
    const [k, v] = part.split('=');
    if (k === 'a') out.address = decodeURIComponent(v || '');
    if (k === 'p') out.pin = decodeURIComponent(v || '');
  }
  return out.address && out.pin ? out : null;
}

export default function SyncScreen({ visible, onClose }) {
  const [pair, setPair] = useState(null);
  const [address, setAddress] = useState('');
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [plan, setPlan] = useState(null);
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (!visible) return;
    setStatus('');
    setPlan(null);
    setProgress(null);
    setResult(null);
    getPairing().then(setPair);
  }, [visible]);

  const pairUsing = async (addr, code) => {
    setLoading(true); setStatus('');
    try {
      const p = await pairWith(addr, code);
      setPair(p);
      setStatus(`Paired with ${p.name}`);
      setAddress(''); setPin('');
    } catch (e) {
      setStatus(e.message);
    }
    setLoading(false);
  };

  const onPair = () => pairUsing(address, pin);

  // If the user pastes a full pair link into the address field, auto-fill
  // both fields and trigger the pair flow.
  const onAddressChange = (text) => {
    const parsed = parsePairLink(text.trim());
    if (parsed) {
      setAddress(parsed.address);
      setPin(parsed.pin);
      pairUsing(parsed.address, parsed.pin);
      return;
    }
    setAddress(text);
  };

  const onUnpair = async () => {
    await setPairing(null);
    setPair(null);
    setStatus('');
    setPlan(null);
  };

  const onPlan = async () => {
    if (!pair) return;
    setLoading(true); setStatus(''); setPlan(null); setResult(null);
    try {
      const p = await planSync(pair);
      setPlan(p);
      if (!p.toDownload.length && !p.toUpload.length) {
        setStatus('Already in sync — nothing to transfer.');
      }
    } catch (e) {
      setStatus(e.message);
    }
    setLoading(false);
  };

  const onSync = async () => {
    if (!pair || !plan) return;
    setLoading(true); setProgress({ done: 0, total: plan.toDownload.length + plan.toUpload.length });
    try {
      const r = await runSync(pair, plan, setProgress);
      setResult(r);
      setPlan(null);
    } catch (e) {
      setStatus(e.message);
    }
    setLoading(false);
    setProgress(null);
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} hitSlop={12}>
            <Ionicons name="chevron-down" size={28} color={theme.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.title}>Sync with PC</Text>
          <View style={{ width: 28 }} />
        </View>

        <ScrollView contentContainerStyle={{ padding: 16 }}>
          {!pair ? (
            <View>
              <Text style={styles.help}>
                On your PC, open PlayFool and click the Sync icon in the sidebar.
                Turn on "Allow sync on this network", then either type the
                address and PIN below — or scan the QR code with any QR app
                (Google Lens / camera) and paste the resulting link into
                the address field.
              </Text>

              <Text style={styles.label}>PC address (or paste pair link)</Text>
              <TextInput
                value={address}
                onChangeText={onAddressChange}
                placeholder="192.168.1.5:3000"
                placeholderTextColor={theme.textMuted}
                autoCapitalize="none"
                style={styles.input}
              />

              <Text style={styles.label}>PIN</Text>
              <TextInput
                value={pin}
                onChangeText={(v) => setPin(v.toUpperCase())}
                placeholder="ABC123"
                placeholderTextColor={theme.textMuted}
                autoCapitalize="characters"
                maxLength={6}
                style={[styles.input, { letterSpacing: 4, fontSize: 18, fontWeight: '700' }]}
              />

              <TouchableOpacity onPress={onPair} disabled={loading} style={styles.primary}>
                {loading ? <ActivityIndicator color="#000" /> : <Ionicons name="link" size={16} color="#000" />}
                <Text style={styles.primaryText}>Connect</Text>
              </TouchableOpacity>

              {!!status && <Text style={styles.statusErr}>{status}</Text>}
            </View>
          ) : (
            <View>
              <View style={styles.pairBox}>
                <Ionicons name="checkmark-circle" size={20} color={theme.green} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.pairTitle}>Paired with {pair.name}</Text>
                  <Text style={styles.pairSub}>{pair.base.replace(/^https?:\/\//, '')}</Text>
                </View>
                <TouchableOpacity onPress={onUnpair} hitSlop={8}>
                  <Text style={styles.unpair}>Unpair</Text>
                </TouchableOpacity>
              </View>

              {!plan && !result && (
                <TouchableOpacity onPress={onPlan} disabled={loading} style={styles.primary}>
                  {loading ? <ActivityIndicator color="#000" /> : <Ionicons name="sync" size={16} color="#000" />}
                  <Text style={styles.primaryText}>Check for changes</Text>
                </TouchableOpacity>
              )}

              {!!status && <Text style={styles.status}>{status}</Text>}

              {plan && (plan.toDownload.length > 0 || plan.toUpload.length > 0) && (
                <View>
                  {plan.toDownload.length > 0 && (
                    <View style={styles.section}>
                      <Text style={styles.sectionTitle}>
                        ⬇ Download from PC ({plan.toDownload.length})
                      </Text>
                      {plan.toDownload.map((f) => (
                        <Text key={f.name} style={styles.fileLine} numberOfLines={1}>
                          {f.name}  ({(f.size / 1024 / 1024).toFixed(1)} MB)
                        </Text>
                      ))}
                    </View>
                  )}
                  {plan.toUpload.length > 0 && (
                    <View style={styles.section}>
                      <Text style={styles.sectionTitle}>
                        ⬆ Upload to PC ({plan.toUpload.length})
                      </Text>
                      {plan.toUpload.map((f) => (
                        <Text key={f.name} style={styles.fileLine} numberOfLines={1}>
                          {f.name}  ({(f.size / 1024 / 1024).toFixed(1)} MB)
                        </Text>
                      ))}
                    </View>
                  )}
                  <TouchableOpacity onPress={onSync} disabled={loading} style={styles.primary}>
                    {loading ? <ActivityIndicator color="#000" /> : <Ionicons name="sync" size={16} color="#000" />}
                    <Text style={styles.primaryText}>
                      Sync {plan.toDownload.length + plan.toUpload.length} song{plan.toDownload.length + plan.toUpload.length === 1 ? '' : 's'}
                    </Text>
                  </TouchableOpacity>
                </View>
              )}

              {progress && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>
                    {progress.dir === 'down' ? 'Downloading' : 'Uploading'} {progress.done} of {progress.total}
                  </Text>
                  {!!progress.current && (
                    <Text style={styles.fileLine} numberOfLines={1}>{progress.current}</Text>
                  )}
                </View>
              )}

              {result && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>
                    ✓ Synced {result.done - result.errors.length} of {result.total} song{result.total === 1 ? '' : 's'}
                  </Text>
                  {result.errors.length > 0 && (
                    <Text style={styles.statusErr}>
                      {result.errors.length} failed — check your connection and try again
                    </Text>
                  )}
                </View>
              )}
            </View>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bgPrimary },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8,
    borderBottomWidth: 1, borderBottomColor: theme.border,
  },
  title: { color: theme.textPrimary, fontSize: 18, fontWeight: '700' },
  help: { color: theme.textSecondary, fontSize: 13, lineHeight: 19, marginBottom: 16 },
  label: { color: theme.textPrimary, fontSize: 13, fontWeight: '600', marginBottom: 4, marginTop: 8 },
  input: {
    backgroundColor: theme.bgSurface, borderColor: theme.border, borderWidth: 1,
    borderRadius: 8, padding: 12, color: theme.textPrimary, fontSize: 14,
  },
  primary: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, backgroundColor: theme.green, paddingVertical: 12,
    borderRadius: 24, marginTop: 16,
  },
  primaryText: { color: '#000', fontWeight: '700', fontSize: 14 },
  status: { color: theme.textSecondary, fontSize: 13, marginTop: 12, textAlign: 'center' },
  statusErr: { color: theme.red, fontSize: 13, marginTop: 12, textAlign: 'center' },
  pairBox: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: theme.bgCard, padding: 12, borderRadius: 8,
    borderWidth: 1, borderColor: theme.border,
  },
  pairTitle: { color: theme.textPrimary, fontSize: 14, fontWeight: '700' },
  pairSub: { color: theme.textMuted, fontSize: 11, marginTop: 2 },
  unpair: { color: theme.red, fontSize: 12, fontWeight: '600' },
  section: { marginTop: 16, padding: 12, backgroundColor: theme.bgCard, borderRadius: 8 },
  sectionTitle: { color: theme.textPrimary, fontSize: 13, fontWeight: '700', marginBottom: 8 },
  fileLine: { color: theme.textSecondary, fontSize: 12, paddingVertical: 2 },
});
