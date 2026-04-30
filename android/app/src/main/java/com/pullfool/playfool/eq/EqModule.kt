package com.pullfool.playfool.eq

import android.media.audiofx.Equalizer
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap

class EqModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "PlayFoolEq"

  // Attach to session 0 = global output mix; affects all music output on the device.
  // Held as long as the app process lives so the EQ stays applied across track changes.
  private var equalizer: Equalizer? = null

  private fun ensure(): Equalizer {
    val existing = equalizer
    if (existing != null) return existing
    val eq = Equalizer(0, 0)
    eq.enabled = true
    equalizer = eq
    return eq
  }

  @ReactMethod
  fun describe(promise: Promise) {
    try {
      val eq = ensure()
      val numBands = eq.numberOfBands.toInt()
      val gainRange = eq.bandLevelRange
      val freqs: WritableArray = Arguments.createArray()
      val levels: WritableArray = Arguments.createArray()
      for (i in 0 until numBands) {
        freqs.pushInt(eq.getCenterFreq(i.toShort()))
        levels.pushInt(eq.getBandLevel(i.toShort()).toInt())
      }
      val presets: WritableArray = Arguments.createArray()
      val presetCount = eq.numberOfPresets.toInt()
      for (i in 0 until presetCount) {
        presets.pushString(eq.getPresetName(i.toShort()))
      }
      val out: WritableMap = Arguments.createMap()
      out.putInt("numBands", numBands)
      out.putInt("minLevel", gainRange[0].toInt())
      out.putInt("maxLevel", gainRange[1].toInt())
      out.putArray("centerFreqs", freqs)
      out.putArray("currentLevels", levels)
      out.putArray("presets", presets)
      out.putBoolean("enabled", eq.enabled)
      promise.resolve(out)
    } catch (e: Exception) {
      promise.reject("EQ_DESCRIBE_ERR", e.message, e)
    }
  }

  @ReactMethod
  fun setEnabled(enabled: Boolean, promise: Promise) {
    try {
      ensure().enabled = enabled
      promise.resolve(enabled)
    } catch (e: Exception) {
      promise.reject("EQ_ENABLE_ERR", e.message, e)
    }
  }

  @ReactMethod
  fun setBandLevel(band: Int, millibels: Int, promise: Promise) {
    try {
      ensure().setBandLevel(band.toShort(), millibels.toShort())
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("EQ_SET_BAND_ERR", e.message, e)
    }
  }

  @ReactMethod
  fun setBandLevels(levels: ReadableArray, promise: Promise) {
    try {
      val eq = ensure()
      val n = minOf(levels.size(), eq.numberOfBands.toInt())
      for (i in 0 until n) {
        eq.setBandLevel(i.toShort(), levels.getInt(i).toShort())
      }
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("EQ_SET_LEVELS_ERR", e.message, e)
    }
  }

  @ReactMethod
  fun usePreset(preset: Int, promise: Promise) {
    try {
      ensure().usePreset(preset.toShort())
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("EQ_PRESET_ERR", e.message, e)
    }
  }

  @ReactMethod
  fun reset(promise: Promise) {
    try {
      val eq = ensure()
      for (i in 0 until eq.numberOfBands.toInt()) {
        eq.setBandLevel(i.toShort(), 0)
      }
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("EQ_RESET_ERR", e.message, e)
    }
  }
}
