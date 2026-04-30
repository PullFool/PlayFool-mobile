import React, { useRef, useState } from 'react';
import { View, Text, StyleSheet, PanResponder } from 'react-native';
import { theme } from '../utils/theme';

// Horizontal slider for one EQ band. Drag to change gain.
// value/min/max are in millibels (1 dB = 100 mb).
export default function BandSlider({ label, value, min, max, onChange }) {
  const [width, setWidth] = useState(0);
  const widthRef = useRef(0);
  const valueRef = useRef(value);
  valueRef.current = value;

  const range = max - min;
  const pct = range > 0 ? (value - min) / range : 0.5;

  const setFromX = (x) => {
    const w = widthRef.current || 1;
    const clamped = Math.max(0, Math.min(w, x));
    const next = Math.round(min + (clamped / w) * range);
    if (next !== valueRef.current) onChange(next);
  };

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => setFromX(e.nativeEvent.locationX),
      onPanResponderMove: (e, g) => setFromX(g.x0 - g.moveX > 0 ? e.nativeEvent.locationX : e.nativeEvent.locationX),
    })
  ).current;

  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <View
        style={styles.track}
        onLayout={(e) => { widthRef.current = e.nativeEvent.layout.width; setWidth(e.nativeEvent.layout.width); }}
        {...responder.panHandlers}
      >
        <View style={[styles.center]} pointerEvents="none" />
        <View
          pointerEvents="none"
          style={[
            styles.fill,
            value >= 0
              ? { left: '50%', width: `${(pct - 0.5) * 100}%` }
              : { right: '50%', width: `${(0.5 - pct) * 100}%` },
          ]}
        />
        <View
          pointerEvents="none"
          style={[styles.knob, { left: width * pct - 8 }]}
        />
      </View>
      <Text style={styles.value}>{value > 0 ? '+' : ''}{(value / 100).toFixed(1)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  label: { width: 48, color: theme.textSecondary, fontSize: 12, fontWeight: '600' },
  track: {
    flex: 1, height: 32, justifyContent: 'center',
    marginHorizontal: 8,
  },
  center: {
    position: 'absolute', left: 0, right: 0, height: 4,
    backgroundColor: theme.border, borderRadius: 2,
  },
  fill: {
    position: 'absolute', height: 4, backgroundColor: theme.green, borderRadius: 2,
  },
  knob: {
    position: 'absolute', width: 16, height: 16, borderRadius: 8,
    backgroundColor: theme.green, top: 8,
    borderWidth: 2, borderColor: '#000',
  },
  value: { width: 50, color: theme.textPrimary, fontSize: 12, textAlign: 'right' },
});
