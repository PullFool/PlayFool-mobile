import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Modal, StyleSheet, Switch,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../utils/theme';
import BandSlider from '../components/BandSlider';
import {
  EQ_AVAILABLE, describeEq, setEqEnabled, setEqLevels, resetEq, formatFreq,
} from '../utils/eq';

// Preset gains in dB, applied to the first 5 or 10 bands as available.
// Keys map to the Android system bands by index, so they're approximate
// across devices that report different center frequencies.
const PRESETS_DB = {
  Flat:       [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  Bass:       [6, 5, 3, 1, 0, -1, -1, 0, 1, 1],
  Treble:     [-2, -1, 0, 0, 1, 2, 3, 4, 5, 6],
  Vocal:      [-2, -1, 1, 3, 4, 4, 3, 2, 0, -1],
  Rock:       [4, 3, 1, -1, -2, -1, 1, 2, 3, 4],
  Pop:        [-1, 1, 2, 3, 3, 2, 0, -1, -1, -2],
  Jazz:       [3, 2, 1, 1, -1, -1, 0, 1, 2, 3],
  Electronic: [4, 3, 0, -1, -2, 0, 1, 2, 3, 4],
};

export default function EqScreen({ visible, onClose }) {
  const [info, setInfo] = useState(null);
  const [levels, setLevels] = useState([]);
  const [enabled, setEnabled] = useState(true);
  const [activePreset, setActivePreset] = useState('Flat');

  useEffect(() => {
    if (!visible) return;
    if (!EQ_AVAILABLE) return;
    (async () => {
      const d = await describeEq();
      if (!d) return;
      setInfo(d);
      setLevels(d.currentLevels || new Array(d.numBands).fill(0));
    })();
  }, [visible]);

  const updateBand = (idx, mb) => {
    // Functional setState so we always merge against the latest levels —
    // the BandSlider's PanResponder is captured on first render and would
    // otherwise call us with a stale closure where the other bands all
    // appear to be 0, snapping them flat.
    setLevels((prev) => {
      const next = prev.slice();
      next[idx] = mb;
      setEqLevels(next);
      return next;
    });
    setActivePreset('');
  };

  const applyPreset = (name) => {
    if (!info) return;
    const dbs = PRESETS_DB[name] || PRESETS_DB.Flat;
    const next = new Array(info.numBands).fill(0).map((_, i) => {
      const db = dbs[Math.min(i, dbs.length - 1)] || 0;
      const mb = db * 100;
      const min = info.minLevel, max = info.maxLevel;
      return Math.max(min, Math.min(max, mb));
    });
    setLevels(next);
    setEqLevels(next);
    setActivePreset(name);
  };

  const onReset = async () => {
    if (!info) return;
    await resetEq();
    setLevels(new Array(info.numBands).fill(0));
    setActivePreset('Flat');
  };

  const onToggle = async (v) => {
    setEnabled(v);
    await setEqEnabled(v);
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} hitSlop={12}>
            <Ionicons name="chevron-down" size={28} color={theme.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.title}>Equalizer</Text>
          <TouchableOpacity onPress={onReset} hitSlop={12}>
            <Text style={styles.reset}>Reset</Text>
          </TouchableOpacity>
        </View>

        {!EQ_AVAILABLE ? (
          <View style={styles.unavailable}>
            <Ionicons name="warning" size={32} color={theme.textMuted} />
            <Text style={styles.unavailText}>EQ module not available in this build.</Text>
          </View>
        ) : !info ? (
          <View style={styles.unavailable}>
            <Text style={styles.unavailText}>Loading…</Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={{ padding: 16 }}>
            <View style={styles.toggleRow}>
              <Text style={styles.toggleLabel}>EQ {enabled ? 'On' : 'Off'}</Text>
              <Switch
                value={enabled}
                onValueChange={onToggle}
                trackColor={{ false: theme.border, true: theme.green }}
              />
            </View>

            <Text style={styles.sectionTitle}>Presets</Text>
            <View style={styles.presets}>
              {Object.keys(PRESETS_DB).map((name) => (
                <TouchableOpacity
                  key={name}
                  onPress={() => applyPreset(name)}
                  style={[styles.preset, activePreset === name && styles.presetActive]}
                >
                  <Text style={[styles.presetText, activePreset === name && styles.presetTextActive]}>
                    {name}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.sectionTitle}>
              Bands ({info.numBands}-band system EQ)
            </Text>
            {info.centerFreqs.map((freq, i) => (
              <BandSlider
                key={i}
                label={`${formatFreq(freq)}Hz`}
                value={levels[i] ?? 0}
                min={info.minLevel}
                max={info.maxLevel}
                onChange={(v) => updateBand(i, v)}
              />
            ))}

            <Text style={styles.note}>
              Range: {(info.minLevel / 100).toFixed(0)}dB to +{(info.maxLevel / 100).toFixed(0)}dB.
              {'\n'}Bands and frequencies are provided by your device.
            </Text>
          </ScrollView>
        )}
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
  reset: { color: theme.green, fontSize: 14, fontWeight: '600' },
  unavailable: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  unavailText: { color: theme.textSecondary, fontSize: 14, textAlign: 'center' },
  toggleRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 8, marginBottom: 12,
  },
  toggleLabel: { color: theme.textPrimary, fontSize: 16, fontWeight: '600' },
  sectionTitle: { color: theme.textPrimary, fontSize: 14, fontWeight: '700', marginTop: 12, marginBottom: 8 },
  presets: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  preset: {
    paddingVertical: 6, paddingHorizontal: 12, borderRadius: 16,
    backgroundColor: theme.bgCard, borderWidth: 1, borderColor: theme.border,
  },
  presetActive: { backgroundColor: theme.green, borderColor: theme.green },
  presetText: { color: theme.textSecondary, fontSize: 12, fontWeight: '600' },
  presetTextActive: { color: '#000' },
  note: { color: theme.textMuted, fontSize: 11, lineHeight: 16, marginTop: 16 },
});
