import React, { useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, Modal, ScrollView, StyleSheet, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../utils/theme';
import { getPairing, setPairing, pairWith, planSync, runSync } from '../utils/sync';

export default function SyncScreen({ visible, onClose }) {
  const [pair, setPair] = useState(null);
  const [code, setCode] = useState('');
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
    setCode('');
    getPairing().then(setPair);
  }, [visible]);

  const onPair = async () => {
    setLoading(true); setStatus('');
    try {
      const p = await pairWith(code);
      setPair(p);
      setStatus('Connected');
      setCode('');
    } catch (e) { setStatus(e.message); }
    setLoading(false);
  };

  const onUnpair = async () => {
    await setPairing(null);
    setPair(null); setStatus(''); setPlan(null);
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
    } catch (e) { setStatus(e.message); }
    setLoading(false);
  };

  const onSync = async () => {
    if (!pair || !plan) return;
    setLoading(true);
    setProgress({ done: 0, total: plan.toDownload.length + plan.toUpload.length });
    try {
      const r = await runSync(pair, plan, setProgress);
      setResult(r);
      setPlan(null);
    } catch (e) { setStatus(e.message); }
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
                On your PC, open PlayFool → Sync. It shows a code. Type the same code
                here to connect. Both devices just need internet — they don't have to
                be on the same Wi-Fi.
              </Text>

              <Text style={styles.label}>Sync code</Text>
              <TextInput
                value={code}
                onChangeText={(v) => setCode(v.toUpperCase())}
                placeholder="ABC123"
                placeholderTextColor={theme.textMuted}
                autoCapitalize="characters"
                maxLength={16}
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
                <Ionicons name="cloud" size={20} color={theme.green} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.pairTitle}>Connected</Text>
                  <Text style={styles.pairSub}>Code: {pair.code}</Text>
                </View>
                <TouchableOpacity onPress={onUnpair} hitSlop={8}>
                  <Text style={styles.unpair}>Disconnect</Text>
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
                        ⬇ Download ({plan.toDownload.length})
                      </Text>
                      {plan.toDownload.map((f) => (
                        <Text key={f.id} style={styles.fileLine} numberOfLines={1}>
                          {f.name}  ({(f.size / 1024 / 1024).toFixed(1)} MB)
                        </Text>
                      ))}
                    </View>
                  )}
                  {plan.toUpload.length > 0 && (
                    <View style={styles.section}>
                      <Text style={styles.sectionTitle}>
                        ⬆ Upload ({plan.toUpload.length})
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
                    {progress.dir === 'down' ? '⬇ Downloading' : '⬆ Uploading'} {progress.done + (progress.bytes < (progress.totalBytes || 0) ? 1 : 0)} of {progress.total}
                  </Text>
                  {!!progress.current && (
                    <Text style={styles.fileLine} numberOfLines={1}>{progress.current}</Text>
                  )}
                  {progress.totalBytes > 0 && (
                    <>
                      <View style={styles.progressTrack}>
                        <View style={[styles.progressFill, { width: `${Math.min(100, Math.round((progress.bytes / progress.totalBytes) * 100))}%` }]} />
                      </View>
                      <Text style={styles.progressMeta}>
                        {Math.min(100, Math.round((progress.bytes / progress.totalBytes) * 100))}%
                        {' · '}
                        {(progress.bytes / 1024 / 1024).toFixed(1)} / {(progress.totalBytes / 1024 / 1024).toFixed(1)} MB
                      </Text>
                    </>
                  )}
                </View>
              )}

              {result && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>
                    ✓ Synced {result.done - result.errors.length} of {result.total} song{result.total === 1 ? '' : 's'}
                  </Text>
                  {result.errors.length > 0 && (
                    <>
                      <Text style={styles.statusErr}>
                        {result.errors.length} failed — first error:
                      </Text>
                      <Text style={[styles.fileLine, { color: theme.red }]} numberOfLines={6}>
                        [{result.errors[0].direction}] {result.errors[0].file}:{'\n'}{result.errors[0].error}
                      </Text>
                    </>
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
  progressTrack: {
    height: 4, borderRadius: 2, backgroundColor: theme.border,
    overflow: 'hidden', marginTop: 8,
  },
  progressFill: { height: '100%', backgroundColor: theme.green },
  progressMeta: { color: theme.textMuted, fontSize: 10, marginTop: 4, textAlign: 'right' },
});
