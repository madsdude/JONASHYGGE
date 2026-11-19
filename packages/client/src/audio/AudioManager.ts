/**
 * HandiHotel Procedural Web Audio Engine
 * Zero external audio assets — all SFX and ambient hotel music are synthesized
 * dynamically via the Web Audio API with full SSR / headless / autoplay safety.
 */

export interface AudioSettings {
  masterVolume: number;
  sfxVolume: number;
  musicVolume: number;
  muted: boolean;
  sfxMuted: boolean;
  musicMuted: boolean;
}

export type AudioSettingsListener = (settings: AudioSettings) => void;

type AmbienceProfileKey = 'lobby' | 'lounge' | 'pool' | 'nightclub' | 'race_arena';

interface AmbienceProfile {
  bpm: number;
  stepsPerBeat: number;
  chords: readonly (readonly number[])[];
  bassNotes: readonly number[];
  waveform: OscillatorType;
  filterCutoff: number;
  style: AmbienceProfileKey;
}

const STORAGE_KEY = 'handihotel_audio_settings_v1';

const DEFAULT_SETTINGS: AudioSettings = {
  masterVolume: 0.7,
  sfxVolume: 0.8,
  musicVolume: 0.35,
  muted: false,
  sfxMuted: false,
  musicMuted: false,
};

/**
 * Musical profiles for room themes.
 * Frequencies are in Hz (warm hotel-friendly registers).
 */
const AMBIENCE_PROFILES: Record<AmbienceProfileKey, AmbienceProfile> = {
  // Warm Rhodes-like electric piano chords (Fmaj7 -> Em7 -> Dm7 -> Cmaj7)
  lobby: {
    bpm: 78,
    stepsPerBeat: 2,
    chords: [
      [174.61, 220.0, 261.63, 329.63], // Fmaj7
      [164.81, 196.0, 246.94, 293.66], // Em7
      [146.83, 174.61, 220.0, 261.63], // Dm7
      [130.81, 164.81, 196.0, 246.94], // Cmaj7
    ],
    bassNotes: [87.31, 82.41, 73.42, 65.41],
    waveform: 'triangle',
    filterCutoff: 1150,
    style: 'lobby',
  },
  // Bossa-nova velvet lounge (Cmaj9 -> A7b9-ish Am9 -> Dm9 -> G13)
  lounge: {
    bpm: 92,
    stepsPerBeat: 2,
    chords: [
      [130.81, 164.81, 246.94, 293.66], // Cmaj9
      [110.0, 164.81, 196.0, 246.94], // Am9
      [146.83, 174.61, 261.63, 329.63], // Dm9
      [196.0, 246.94, 293.66, 329.63], // G6/9
    ],
    bassNotes: [65.41, 110.0, 73.42, 98.0],
    waveform: 'sine',
    filterCutoff: 1350,
    style: 'lounge',
  },
  // Mellow poolside marimba (Gmaj7 -> Em9 -> Cmaj7 -> D6)
  pool: {
    bpm: 86,
    stepsPerBeat: 2,
    chords: [
      [196.0, 246.94, 293.66, 369.99], // Gmaj7
      [164.81, 196.0, 246.94, 369.99], // Em9
      [130.81, 196.0, 246.94, 329.63], // Cmaj7
      [146.83, 220.0, 246.94, 293.66], // D6
    ],
    bassNotes: [98.0, 82.41, 65.41, 73.42],
    waveform: 'sine',
    filterCutoff: 1650,
    style: 'pool',
  },
  // Upbeat smooth nightclub bass pulse (Am7 -> Fmaj7 -> Dm7 -> Em7)
  nightclub: {
    bpm: 116,
    stepsPerBeat: 2,
    chords: [
      [220.0, 261.63, 329.63, 392.0], // Am7
      [174.61, 220.0, 261.63, 329.63], // Fmaj7
      [146.83, 174.61, 220.0, 261.63], // Dm7
      [164.81, 196.0, 246.94, 293.66], // Em7
    ],
    bassNotes: [55.0, 87.31, 73.42, 82.41],
    waveform: 'sawtooth',
    filterCutoff: 950,
    style: 'nightclub',
  },
  // Energetic synth pulse for race arena & arcade (Cm -> Ab -> Bb -> Gm)
  race_arena: {
    bpm: 128,
    stepsPerBeat: 2,
    chords: [
      [261.63, 311.13, 392.0, 466.16], // Cm7
      [207.65, 261.63, 311.13, 392.0], // Abmaj7
      [233.08, 293.66, 349.23, 466.16], // Bb
      [196.0, 233.08, 293.66, 349.23], // Gm7
    ],
    bassNotes: [65.41, 103.83, 116.54, 98.0],
    waveform: 'sawtooth',
    filterCutoff: 1500,
    style: 'race_arena',
  },
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function getAudioContextConstructor(): (new () => AudioContext) | null {
  if (typeof window === 'undefined') return null;
  const win = window as unknown as {
    AudioContext?: new () => AudioContext;
    webkitAudioContext?: new () => AudioContext;
  };
  return win.AudioContext ?? win.webkitAudioContext ?? null;
}

export class AudioManager {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private ambienceGain: GainNode | null = null;
  private ambienceFilter: BiquadFilterNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  private settings: AudioSettings;
  private listeners = new Set<AudioSettingsListener>();

  private currentTheme: string | null = null;
  private activeProfile: AmbienceProfile | null = null;
  private ambienceTimer: ReturnType<typeof setInterval> | null = null;
  private ambienceStep = 0;
  private stepParity = false;
  private gestureListenersBound = false;
  private readonly boundUnlockHandler: () => void;

  constructor() {
    this.settings = this.loadSettings();
    this.boundUnlockHandler = () => {
      this.unlock();
    };
    this.bindGestureUnlock();
  }

  // ---------------------------------------------------------------------------
  // Initialization & Lifecycle
  // ---------------------------------------------------------------------------

  private bindGestureUnlock(): void {
    if (this.gestureListenersBound || typeof window === 'undefined') return;
    this.gestureListenersBound = true;
    const events: (keyof WindowEventMap)[] = ['pointerdown', 'keydown', 'touchstart', 'click'];
    for (const evt of events) {
      try {
        window.addEventListener(evt, this.boundUnlockHandler, { passive: true, capture: true });
      } catch {
        // Ignore in restricted environments
      }
    }
  }

  private unbindGestureUnlock(): void {
    if (!this.gestureListenersBound || typeof window === 'undefined') return;
    this.gestureListenersBound = false;
    const events: (keyof WindowEventMap)[] = ['pointerdown', 'keydown', 'touchstart', 'click'];
    for (const evt of events) {
      try {
        window.removeEventListener(evt, this.boundUnlockHandler, { capture: true });
      } catch {
        // Ignore
      }
    }
  }

  /**
   * Safely initialize or resume AudioContext on first user gesture.
   * Never throws in headless, SSR, or autoplay-blocked environments.
   */
  public unlock(): boolean {
    const ctx = this.ensureContext();
    if (!ctx) return false;

    if (ctx.state === 'suspended') {
      try {
        const result = ctx.resume();
        if (result && typeof result.then === 'function') {
          result
            .then(() => {
              if (this.ctx && this.ctx.state === 'running') {
                this.unbindGestureUnlock();
                if (this.currentTheme && !this.ambienceTimer) {
                  this.beginAmbienceLoop(this.currentTheme);
                }
              }
            })
            .catch(() => {
              // Autoplay blocked — stay silent until a genuine user gesture occurs
            });
        }
      } catch {
        return false;
      }
    } else if (ctx.state === 'running') {
      this.unbindGestureUnlock();
      if (this.currentTheme && !this.ambienceTimer) {
        this.beginAmbienceLoop(this.currentTheme);
      }
    }

    return ctx.state === 'running';
  }

  private ensureContext(): AudioContext | null {
    if (this.ctx) return this.ctx;

    const Ctor = getAudioContextConstructor();
    if (!Ctor) return null;

    try {
      const ctx = new Ctor();
      const masterGain = ctx.createGain();
      const sfxGain = ctx.createGain();
      const musicGain = ctx.createGain();

      sfxGain.connect(masterGain);
      musicGain.connect(masterGain);
      masterGain.connect(ctx.destination);

      this.ctx = ctx;
      this.masterGain = masterGain;
      this.sfxGain = sfxGain;
      this.musicGain = musicGain;

      this.applyGains(true);
      this.noiseBuffer = this.createNoiseBuffer(ctx, 1.5);
      return ctx;
    } catch {
      return null;
    }
  }

  /**
   * Returns a running AudioContext ready for immediate SFX synthesis, or null
   * if unavailable, muted, or still blocked by autoplay policy.
   */
  private getReadySfxContext(): { ctx: AudioContext; out: GainNode } | null {
    if (this.settings.muted || this.settings.sfxMuted) return null;
    if (this.settings.masterVolume <= 0 || this.settings.sfxVolume <= 0) return null;

    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return null;

    if (ctx.state === 'suspended') {
      try {
        const res = ctx.resume();
        if (res && typeof res.catch === 'function') {
          res.catch(() => undefined);
        }
      } catch {
        // Autoplay blocked
      }
      // Resume is async; skip scheduling this sound to avoid queued bursts later
      return null;
    }

    if (ctx.state !== 'running') return null;
    return { ctx, out: this.sfxGain };
  }

  private createNoiseBuffer(ctx: AudioContext, durationSec: number): AudioBuffer | null {
    try {
      const length = Math.max(1, Math.floor(ctx.sampleRate * durationSec));
      const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      return buffer;
    } catch {
      return null;
    }
  }

  public dispose(): void {
    this.stopAmbience();
    this.unbindGestureUnlock();
    this.listeners.clear();
    if (this.ctx) {
      try {
        const res = this.ctx.close();
        if (res && typeof res.catch === 'function') {
          res.catch(() => undefined);
        }
      } catch {
        // Ignore
      }
      this.ctx = null;
      this.masterGain = null;
      this.sfxGain = null;
      this.musicGain = null;
      this.ambienceGain = null;
      this.ambienceFilter = null;
      this.noiseBuffer = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Volume, Mute & Persistence
  // ---------------------------------------------------------------------------

  private loadSettings(): AudioSettings {
    if (typeof window === 'undefined') return { ...DEFAULT_SETTINGS };
    try {
      const raw = window.localStorage?.getItem(STORAGE_KEY);
      if (!raw) return { ...DEFAULT_SETTINGS };
      const parsed = JSON.parse(raw) as Partial<AudioSettings>;
      return {
        masterVolume:
          typeof parsed.masterVolume === 'number'
            ? clamp01(parsed.masterVolume)
            : DEFAULT_SETTINGS.masterVolume,
        sfxVolume:
          typeof parsed.sfxVolume === 'number'
            ? clamp01(parsed.sfxVolume)
            : DEFAULT_SETTINGS.sfxVolume,
        musicVolume:
          typeof parsed.musicVolume === 'number'
            ? clamp01(parsed.musicVolume)
            : DEFAULT_SETTINGS.musicVolume,
        muted: typeof parsed.muted === 'boolean' ? parsed.muted : DEFAULT_SETTINGS.muted,
        sfxMuted:
          typeof parsed.sfxMuted === 'boolean' ? parsed.sfxMuted : DEFAULT_SETTINGS.sfxMuted,
        musicMuted:
          typeof parsed.musicMuted === 'boolean' ? parsed.musicMuted : DEFAULT_SETTINGS.musicMuted,
      };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  private saveSettings(): void {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage?.setItem(STORAGE_KEY, JSON.stringify(this.settings));
    } catch {
      // Ignore storage quota / privacy mode errors
    }
  }

  private applyGains(immediate = false): void {
    if (!this.ctx || !this.masterGain || !this.sfxGain || !this.musicGain) return;
    const now = this.ctx.currentTime;
    const targetMaster = this.settings.muted ? 0 : this.settings.masterVolume;
    const targetSfx = this.settings.sfxMuted ? 0 : this.settings.sfxVolume;
    const targetMusic = this.settings.musicMuted ? 0 : this.settings.musicVolume;

    try {
      if (immediate) {
        this.masterGain.gain.setValueAtTime(targetMaster, now);
        this.sfxGain.gain.setValueAtTime(targetSfx, now);
        this.musicGain.gain.setValueAtTime(targetMusic, now);
      } else {
        this.masterGain.gain.setTargetAtTime(targetMaster, now, 0.025);
        this.sfxGain.gain.setTargetAtTime(targetSfx, now, 0.025);
        this.musicGain.gain.setTargetAtTime(targetMusic, now, 0.04);
      }
    } catch {
      // Ignore AudioParam edge cases in mocked/headless contexts
    }
  }

  private notifyListeners(): void {
    const snapshot = this.getSettings();
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch {
        // Isolate listener failures
      }
    }
  }

  private updateSettings(patch: Partial<AudioSettings>): void {
    this.settings = { ...this.settings, ...patch };
    this.applyGains();
    this.saveSettings();
    this.notifyListeners();
  }

  public getSettings(): AudioSettings {
    return { ...this.settings };
  }

  public subscribe(listener: AudioSettingsListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public getMasterVolume(): number {
    return this.settings.masterVolume;
  }

  public setMasterVolume(volume: number): void {
    this.updateSettings({ masterVolume: clamp01(volume) });
  }

  public getSfxVolume(): number {
    return this.settings.sfxVolume;
  }

  public setSfxVolume(volume: number): void {
    this.updateSettings({ sfxVolume: clamp01(volume) });
  }

  public getMusicVolume(): number {
    return this.settings.musicVolume;
  }

  public setMusicVolume(volume: number): void {
    this.updateSettings({ musicVolume: clamp01(volume) });
  }

  public isMuted(): boolean {
    return this.settings.muted;
  }

  public setMuted(muted: boolean): void {
    this.updateSettings({ muted: Boolean(muted) });
  }

  public toggleMute(): boolean {
    const next = !this.settings.muted;
    this.setMuted(next);
    return next;
  }

  public isSfxMuted(): boolean {
    return this.settings.sfxMuted;
  }

  public setSfxMuted(muted: boolean): void {
    this.updateSettings({ sfxMuted: Boolean(muted) });
  }

  public toggleSfxMute(): boolean {
    const next = !this.settings.sfxMuted;
    this.setSfxMuted(next);
    return next;
  }

  public isMusicMuted(): boolean {
    return this.settings.musicMuted;
  }

  public setMusicMuted(muted: boolean): void {
    this.updateSettings({ musicMuted: Boolean(muted) });
  }

  public toggleMusicMute(): boolean {
    const next = !this.settings.musicMuted;
    this.setMusicMuted(next);
    return next;
  }

  // ---------------------------------------------------------------------------
  // Low-Level Procedural Synthesis Helpers
  // ---------------------------------------------------------------------------

  private playTone(
    ctx: AudioContext,
    dest: AudioNode,
    opts: {
      type?: OscillatorType;
      freq: number;
      endFreq?: number;
      startTime?: number;
      attack?: number;
      decay: number;
      gain: number;
      filterFreq?: number;
      filterType?: BiquadFilterType;
      filterQ?: number;
    }
  ): void {
    const now = opts.startTime ?? ctx.currentTime;
    const attack = opts.attack ?? 0.008;
    const stopTime = now + attack + opts.decay + 0.02;

    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = opts.type ?? 'sine';
    osc.frequency.setValueAtTime(Math.max(20, opts.freq), now);
    if (opts.endFreq !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.endFreq), now + attack + opts.decay);
    }

    env.gain.setValueAtTime(0.0001, now);
    env.gain.linearRampToValueAtTime(opts.gain, now + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, now + attack + opts.decay);

    if (opts.filterFreq !== undefined) {
      const filter = ctx.createBiquadFilter();
      filter.type = opts.filterType ?? 'lowpass';
      filter.frequency.setValueAtTime(opts.filterFreq, now);
      if (opts.filterQ !== undefined) {
        filter.Q.setValueAtTime(opts.filterQ, now);
      }
      osc.connect(filter);
      filter.connect(env);
    } else {
      osc.connect(env);
    }

    env.connect(dest);
    osc.start(now);
    osc.stop(stopTime);
  }

  private playNoise(
    ctx: AudioContext,
    dest: AudioNode,
    opts: {
      startTime?: number;
      attack?: number;
      decay: number;
      gain: number;
      filterType?: BiquadFilterType;
      filterFreq: number;
      endFilterFreq?: number;
      filterQ?: number;
    }
  ): void {
    if (!this.noiseBuffer) {
      this.noiseBuffer = this.createNoiseBuffer(ctx, 1.5);
    }
    if (!this.noiseBuffer) return;

    const now = opts.startTime ?? ctx.currentTime;
    const attack = opts.attack ?? 0.004;
    const duration = attack + opts.decay + 0.02;

    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;

    const filter = ctx.createBiquadFilter();
    filter.type = opts.filterType ?? 'bandpass';
    filter.frequency.setValueAtTime(Math.max(40, opts.filterFreq), now);
    if (opts.endFilterFreq !== undefined) {
      filter.frequency.exponentialRampToValueAtTime(
        Math.max(40, opts.endFilterFreq),
        now + attack + opts.decay
      );
    }
    if (opts.filterQ !== undefined) {
      filter.Q.setValueAtTime(opts.filterQ, now);
    }

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, now);
    env.gain.linearRampToValueAtTime(opts.gain, now + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, now + attack + opts.decay);

    src.connect(filter);
    filter.connect(env);
    env.connect(dest);

    const maxOffset = Math.max(0, this.noiseBuffer.duration - duration - 0.01);
    const offset = maxOffset > 0 ? Math.random() * maxOffset : 0;
    src.start(now, offset, duration);
  }

  // ---------------------------------------------------------------------------
  // Procedural Sound Effects
  // ---------------------------------------------------------------------------

  /**
   * Soft rhythmic tile tap (walking) or subtle rubber wheel roll & bearing click (wheelchair).
   */
  public playStep(isWheelchair: boolean): void {
    const ready = this.getReadySfxContext();
    if (!ready) return;
    const { ctx, out } = ready;
    const now = ctx.currentTime;

    this.stepParity = !this.stepParity;
    const jitter = 0.94 + Math.random() * 0.12;
    const parityBias = this.stepParity ? 1.05 : 0.95;

    if (isWheelchair) {
      // Subtle rubber tire roll on hotel tile
      this.playNoise(ctx, out, {
        startTime: now,
        attack: 0.012,
        decay: 0.095,
        gain: 0.09,
        filterType: 'bandpass',
        filterFreq: 320 * jitter,
        endFilterFreq: 210 * jitter,
        filterQ: 1.8,
      });
      // Soft mechanical hub/spoke click
      this.playTone(ctx, out, {
        type: 'triangle',
        freq: 620 * jitter * parityBias,
        endFreq: 280 * jitter,
        startTime: now + 0.005,
        attack: 0.002,
        decay: 0.025,
        gain: 0.045,
      });
    } else {
      // Crisp, gentle tile footstep tap
      this.playTone(ctx, out, {
        type: 'triangle',
        freq: 250 * jitter * parityBias,
        endFreq: 95 * jitter,
        startTime: now,
        attack: 0.002,
        decay: 0.042,
        gain: 0.11,
      });
      this.playNoise(ctx, out, {
        startTime: now,
        attack: 0.001,
        decay: 0.022,
        gain: 0.06,
        filterType: 'highpass',
        filterFreq: 1800 * jitter,
      });
    }
  }

  /**
   * Short, crisp UI button click feedback.
   */
  public playUiClick(): void {
    const ready = this.getReadySfxContext();
    if (!ready) return;
    const { ctx, out } = ready;
    const now = ctx.currentTime;

    this.playTone(ctx, out, {
      type: 'triangle',
      freq: 920,
      endFreq: 540,
      startTime: now,
      attack: 0.002,
      decay: 0.028,
      gain: 0.14,
    });
    this.playNoise(ctx, out, {
      startTime: now,
      attack: 0.001,
      decay: 0.014,
      gain: 0.06,
      filterType: 'highpass',
      filterFreq: 2600,
    });
  }

  /**
   * Classic Habbo-esque bubbly chat pop.
   */
  public playChatPop(): void {
    const ready = this.getReadySfxContext();
    if (!ready) return;
    const { ctx, out } = ready;
    const now = ctx.currentTime;
    const pitch = 0.96 + Math.random() * 0.08;

    this.playTone(ctx, out, {
      type: 'sine',
      freq: 340 * pitch,
      endFreq: 860 * pitch,
      startTime: now,
      attack: 0.004,
      decay: 0.058,
      gain: 0.2,
    });
    this.playTone(ctx, out, {
      type: 'triangle',
      freq: 680 * pitch,
      endFreq: 1240 * pitch,
      startTime: now + 0.012,
      attack: 0.003,
      decay: 0.036,
      gain: 0.07,
    });
  }

  /**
   * Warm hotel brass bell / two-tone chime on entering a room.
   */
  public playDoorChime(): void {
    const ready = this.getReadySfxContext();
    if (!ready) return;
    const { ctx, out } = ready;
    const now = ctx.currentTime;

    const strikeBell = (fundamental: number, offset: number, gain: number): void => {
      // Fundamental + warm brass bell overtones
      this.playTone(ctx, out, {
        type: 'sine',
        freq: fundamental,
        startTime: now + offset,
        attack: 0.005,
        decay: 0.72,
        gain,
      });
      this.playTone(ctx, out, {
        type: 'triangle',
        freq: fundamental * 2.0,
        startTime: now + offset,
        attack: 0.004,
        decay: 0.42,
        gain: gain * 0.32,
      });
      this.playTone(ctx, out, {
        type: 'sine',
        freq: fundamental * 2.756,
        startTime: now + offset,
        attack: 0.003,
        decay: 0.24,
        gain: gain * 0.14,
      });
    };

    // Classic welcoming hotel two-tone chime: E5 -> C5
    strikeBell(659.25, 0, 0.22);
    strikeBell(523.25, 0.19, 0.24);
  }

  /**
   * Crisp hotel elevator bell ding.
   */
  public playElevatorDing(): void {
    const ready = this.getReadySfxContext();
    if (!ready) return;
    const { ctx, out } = ready;
    const now = ctx.currentTime;

    const base = 1174.66; // D6 — classic bright elevator bell
    this.playTone(ctx, out, {
      type: 'sine',
      freq: base,
      startTime: now,
      attack: 0.002,
      decay: 1.05,
      gain: 0.24,
    });
    this.playTone(ctx, out, {
      type: 'sine',
      freq: base * 2.0,
      startTime: now,
      attack: 0.002,
      decay: 0.55,
      gain: 0.09,
    });
    this.playTone(ctx, out, {
      type: 'sine',
      freq: base * 2.76,
      startTime: now,
      attack: 0.001,
      decay: 0.28,
      gain: 0.055,
    });
    // Subtle metallic hammer strike
    this.playNoise(ctx, out, {
      startTime: now,
      attack: 0.001,
      decay: 0.015,
      gain: 0.06,
      filterType: 'highpass',
      filterFreq: 3800,
    });
  }

  /**
   * Bright metallic credit clink.
   */
  public playCoin(): void {
    const ready = this.getReadySfxContext();
    if (!ready) return;
    const { ctx, out } = ready;
    const now = ctx.currentTime;

    // Classic B5 -> E6 double coin shimmer
    this.playTone(ctx, out, {
      type: 'triangle',
      freq: 987.77,
      startTime: now,
      attack: 0.003,
      decay: 0.11,
      gain: 0.2,
    });
    this.playTone(ctx, out, {
      type: 'sine',
      freq: 1975.53,
      startTime: now,
      attack: 0.002,
      decay: 0.09,
      gain: 0.09,
    });
    this.playTone(ctx, out, {
      type: 'triangle',
      freq: 1318.51,
      startTime: now + 0.075,
      attack: 0.003,
      decay: 0.34,
      gain: 0.22,
    });
    this.playTone(ctx, out, {
      type: 'sine',
      freq: 2637.02,
      startTime: now + 0.075,
      attack: 0.002,
      decay: 0.24,
      gain: 0.1,
    });
  }

  /**
   * Crisp wooden thud when placing furniture.
   */
  public playFurniturePlace(): void {
    const ready = this.getReadySfxContext();
    if (!ready) return;
    const { ctx, out } = ready;
    const now = ctx.currentTime;

    // Resonant low wood body
    this.playTone(ctx, out, {
      type: 'triangle',
      freq: 175,
      endFreq: 68,
      startTime: now,
      attack: 0.003,
      decay: 0.11,
      gain: 0.3,
    });
    // Crisp wood contact snap
    this.playNoise(ctx, out, {
      startTime: now,
      attack: 0.002,
      decay: 0.045,
      gain: 0.18,
      filterType: 'bandpass',
      filterFreq: 850,
      filterQ: 1.5,
    });
  }

  /**
   * Light airy swoosh when picking up furniture into inventory.
   */
  public playFurniturePickup(): void {
    const ready = this.getReadySfxContext();
    if (!ready) return;
    const { ctx, out } = ready;
    const now = ctx.currentTime;

    this.playNoise(ctx, out, {
      startTime: now,
      attack: 0.015,
      decay: 0.14,
      gain: 0.14,
      filterType: 'bandpass',
      filterFreq: 420,
      endFilterFreq: 2100,
      filterQ: 2.2,
    });
    this.playTone(ctx, out, {
      type: 'sine',
      freq: 310,
      endFreq: 620,
      startTime: now + 0.02,
      attack: 0.006,
      decay: 0.09,
      gain: 0.13,
    });
  }

  /**
   * Crisp mechanical/wooden click when rotating furniture.
   */
  public playFurnitureRotate(): void {
    const ready = this.getReadySfxContext();
    if (!ready) return;
    const { ctx, out } = ready;
    const now = ctx.currentTime;

    this.playTone(ctx, out, {
      type: 'triangle',
      freq: 760,
      endFreq: 420,
      startTime: now,
      attack: 0.002,
      decay: 0.032,
      gain: 0.16,
    });
    this.playNoise(ctx, out, {
      startTime: now,
      attack: 0.001,
      decay: 0.018,
      gain: 0.1,
      filterType: 'bandpass',
      filterFreq: 2200,
      filterQ: 2.5,
    });
  }

  /**
   * Playful chime / boing / cheer tones tailored per emote.
   */
  public playEmote(emote: string): void {
    const ready = this.getReadySfxContext();
    if (!ready) return;
    const { ctx, out } = ready;
    const now = ctx.currentTime;
    const key = emote.trim().toLowerCase();

    switch (key) {
      case 'wave': {
        this.playTone(ctx, out, {
          type: 'sine',
          freq: 523.25,
          startTime: now,
          attack: 0.006,
          decay: 0.14,
          gain: 0.18,
        });
        this.playTone(ctx, out, {
          type: 'sine',
          freq: 783.99,
          startTime: now + 0.09,
          attack: 0.006,
          decay: 0.22,
          gain: 0.2,
        });
        break;
      }

      case 'dance': {
        const notes = [440, 554.37, 659.25, 880];
        notes.forEach((freq, i) => {
          this.playTone(ctx, out, {
            type: 'triangle',
            freq,
            startTime: now + i * 0.065,
            attack: 0.004,
            decay: 0.11,
            gain: 0.15,
            filterFreq: 2200,
          });
        });
        break;
      }

      case 'laugh': {
        // Playful staccato bouncy "ha-ha-ha" pips
        const pitches = [620, 560, 500];
        pitches.forEach((freq, i) => {
          this.playTone(ctx, out, {
            type: 'sine',
            freq: freq * 0.85,
            endFreq: freq * 1.15,
            startTime: now + i * 0.085,
            attack: 0.004,
            decay: 0.065,
            gain: 0.17,
          });
        });
        break;
      }

      case 'cheer': {
        const notes = [523.25, 659.25, 783.99, 1046.5];
        notes.forEach((freq, i) => {
          this.playTone(ctx, out, {
            type: 'triangle',
            freq,
            startTime: now + i * 0.055,
            attack: 0.005,
            decay: i === notes.length - 1 ? 0.32 : 0.13,
            gain: 0.17,
          });
        });
        break;
      }

      case 'clap': {
        for (let i = 0; i < 3; i++) {
          this.playNoise(ctx, out, {
            startTime: now + i * 0.11,
            attack: 0.002,
            decay: 0.055,
            gain: 0.2,
            filterType: 'bandpass',
            filterFreq: 1450 + i * 120,
            filterQ: 1.6,
          });
        }
        break;
      }

      case 'facepalm': {
        // Comical soft muted "wah-wah" downward bend
        this.playTone(ctx, out, {
          type: 'sawtooth',
          freq: 330,
          endFreq: 293.66,
          startTime: now,
          attack: 0.015,
          decay: 0.15,
          gain: 0.11,
          filterFreq: 720,
        });
        this.playTone(ctx, out, {
          type: 'sawtooth',
          freq: 277.18,
          endFreq: 220,
          startTime: now + 0.17,
          attack: 0.015,
          decay: 0.26,
          gain: 0.11,
          filterFreq: 620,
        });
        break;
      }

      case 'wheelie': {
        // Springy upward boing + subtle tire chirp
        this.playTone(ctx, out, {
          type: 'sine',
          freq: 220,
          endFreq: 680,
          startTime: now,
          attack: 0.006,
          decay: 0.18,
          gain: 0.22,
        });
        this.playNoise(ctx, out, {
          startTime: now + 0.02,
          attack: 0.005,
          decay: 0.08,
          gain: 0.09,
          filterType: 'bandpass',
          filterFreq: 1600,
          endFilterFreq: 2600,
          filterQ: 3.5,
        });
        break;
      }

      case 'sit': {
        this.playTone(ctx, out, {
          type: 'sine',
          freq: 340,
          endFreq: 210,
          startTime: now,
          attack: 0.005,
          decay: 0.095,
          gain: 0.15,
        });
        break;
      }

      default: {
        this.playTone(ctx, out, {
          type: 'sine',
          freq: 587.33,
          startTime: now,
          attack: 0.005,
          decay: 0.12,
          gain: 0.16,
        });
        this.playTone(ctx, out, {
          type: 'sine',
          freq: 880,
          startTime: now + 0.075,
          attack: 0.005,
          decay: 0.18,
          gain: 0.16,
        });
        break;
      }
    }
  }

  /**
   * Pleasant friend / DM / invite notification ding.
   */
  public playNotification(): void {
    const ready = this.getReadySfxContext();
    if (!ready) return;
    const { ctx, out } = ready;
    const now = ctx.currentTime;

    // Gentle glassy F5 -> A5 -> C6 sparkle
    const notes = [698.46, 880.0, 1046.5];
    notes.forEach((freq, i) => {
      this.playTone(ctx, out, {
        type: 'sine',
        freq,
        startTime: now + i * 0.065,
        attack: 0.004,
        decay: i === notes.length - 1 ? 0.38 : 0.16,
        gain: 0.17,
      });
    });
  }

  /**
   * Minigame 3-2-1-GO countdown beeps.
   */
  public playCountdownTick(final = false): void {
    const ready = this.getReadySfxContext();
    if (!ready) return;
    const { ctx, out } = ready;
    const now = ctx.currentTime;

    if (final) {
      // Energetic "GO!" chord burst
      this.playTone(ctx, out, {
        type: 'triangle',
        freq: 880,
        startTime: now,
        attack: 0.004,
        decay: 0.34,
        gain: 0.25,
      });
      this.playTone(ctx, out, {
        type: 'sine',
        freq: 1318.51,
        startTime: now,
        attack: 0.004,
        decay: 0.36,
        gain: 0.18,
      });
    } else {
      // Crisp 3-2-1 tick
      this.playTone(ctx, out, {
        type: 'triangle',
        freq: 440,
        startTime: now,
        attack: 0.003,
        decay: 0.11,
        gain: 0.22,
      });
    }
  }

  /**
   * Celebratory arpeggio fanfare for minigame victories and achievements.
   */
  public playVictory(): void {
    const ready = this.getReadySfxContext();
    if (!ready) return;
    const { ctx, out } = ready;
    const now = ctx.currentTime;

    // C5 -> E5 -> G5 -> B5 -> C6 bright fanfare + warm chord hold
    const melody: { freq: number; offset: number; decay: number }[] = [
      { freq: 523.25, offset: 0.0, decay: 0.16 },
      { freq: 659.25, offset: 0.09, decay: 0.16 },
      { freq: 783.99, offset: 0.18, decay: 0.18 },
      { freq: 987.77, offset: 0.27, decay: 0.18 },
      { freq: 1046.5, offset: 0.36, decay: 0.65 },
    ];

    for (const note of melody) {
      this.playTone(ctx, out, {
        type: 'triangle',
        freq: note.freq,
        startTime: now + note.offset,
        attack: 0.006,
        decay: note.decay,
        gain: 0.2,
      });
      this.playTone(ctx, out, {
        type: 'sine',
        freq: note.freq * 2,
        startTime: now + note.offset,
        attack: 0.006,
        decay: note.decay * 0.7,
        gain: 0.06,
      });
    }

    // Supporting warm major chord on the final hit
    const chord = [523.25, 659.25, 783.99];
    for (const freq of chord) {
      this.playTone(ctx, out, {
        type: 'sine',
        freq,
        startTime: now + 0.36,
        attack: 0.02,
        decay: 0.7,
        gain: 0.09,
      });
    }
  }

  /**
   * Turbo wheelchair boost whoosh.
   */
  public playBoost(): void {
    const ready = this.getReadySfxContext();
    if (!ready) return;
    const { ctx, out } = ready;
    const now = ctx.currentTime;

    // Jet-like filtered noise whoosh
    this.playNoise(ctx, out, {
      startTime: now,
      attack: 0.03,
      decay: 0.42,
      gain: 0.24,
      filterType: 'bandpass',
      filterFreq: 350,
      endFilterFreq: 3200,
      filterQ: 2.0,
    });

    // Energetic turbine pitch sweep
    this.playTone(ctx, out, {
      type: 'sawtooth',
      freq: 190,
      endFreq: 760,
      startTime: now,
      attack: 0.02,
      decay: 0.34,
      gain: 0.12,
      filterFreq: 1800,
    });
    this.playTone(ctx, out, {
      type: 'sine',
      freq: 380,
      endFreq: 1140,
      startTime: now + 0.03,
      attack: 0.015,
      decay: 0.28,
      gain: 0.1,
    });
  }

  // ---------------------------------------------------------------------------
  // Ambient Hotel Lounge Background Synthesizer
  // ---------------------------------------------------------------------------

  private resolveProfile(theme: string): AmbienceProfile {
    const t = theme.trim().toLowerCase();
    if (t === 'nightclub' || t === 'club' || t === 'event_hall') {
      return AMBIENCE_PROFILES.nightclub;
    }
    if (t === 'pool') {
      return AMBIENCE_PROFILES.pool;
    }
    if (t === 'race_arena' || t === 'arena' || t === 'arcade') {
      return AMBIENCE_PROFILES.race_arena;
    }
    if (t === 'lounge' || t === 'restaurant' || t === 'rooftop') {
      return AMBIENCE_PROFILES.lounge;
    }
    return AMBIENCE_PROFILES.lobby;
  }

  /**
   * Start gentle procedural hotel background music tailored to the room theme.
   * If audio is not yet unlocked by a user gesture, remembers the theme and
   * begins automatically on first interaction.
   */
  public startAmbience(theme: string): void {
    const normalized = (theme || 'lobby').trim().toLowerCase();
    if (this.currentTheme === normalized && this.ambienceTimer !== null) {
      return;
    }

    this.currentTheme = normalized;
    this.clearAmbienceLoop();

    const ctx = this.ensureContext();
    if (!ctx) return;

    if (ctx.state === 'running') {
      this.beginAmbienceLoop(normalized);
    } else if (ctx.state === 'suspended') {
      try {
        const res = ctx.resume();
        if (res && typeof res.then === 'function') {
          res
            .then(() => {
              if (this.currentTheme === normalized && this.ctx?.state === 'running') {
                this.beginAmbienceLoop(normalized);
              }
            })
            .catch(() => {
              // Will auto-start when unlock() fires on user gesture
            });
        }
      } catch {
        // Will auto-start on gesture
      }
    }
  }

  /**
   * Stop the procedural ambient music loop cleanly.
   */
  public stopAmbience(): void {
    this.currentTheme = null;
    this.activeProfile = null;
    this.clearAmbienceLoop();
  }

  public getCurrentTheme(): string | null {
    return this.currentTheme;
  }

  private clearAmbienceLoop(): void {
    if (this.ambienceTimer !== null) {
      clearInterval(this.ambienceTimer);
      this.ambienceTimer = null;
    }
    if (this.ambienceGain && this.ctx) {
      try {
        const now = this.ctx.currentTime;
        this.ambienceGain.gain.setTargetAtTime(0.0001, now, 0.08);
      } catch {
        // Ignore
      }
    }
  }

  private beginAmbienceLoop(theme: string): void {
    if (!this.ctx || !this.musicGain) return;
    this.clearAmbienceLoop();

    const profile = this.resolveProfile(theme);
    this.activeProfile = profile;
    this.ambienceStep = 0;

    // Create / reconnect dedicated ambience lowpass + gain bus
    const ctx = this.ctx;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(profile.filterCutoff, ctx.currentTime);
    filter.Q.setValueAtTime(0.7, ctx.currentTime);

    const busGain = ctx.createGain();
    busGain.gain.setValueAtTime(0.0001, ctx.currentTime);
    busGain.gain.setTargetAtTime(1.0, ctx.currentTime, 0.25);

    filter.connect(busGain);
    busGain.connect(this.musicGain);

    this.ambienceFilter = filter;
    this.ambienceGain = busGain;

    const stepMs = Math.round((60 / profile.bpm / profile.stepsPerBeat) * 1000);

    // Play step 0 immediately for responsive room transitions
    this.tickAmbienceStep();
    this.ambienceTimer = setInterval(() => {
      this.tickAmbienceStep();
    }, stepMs);
  }

  private tickAmbienceStep(): void {
    if (!this.ctx || !this.ambienceFilter || !this.activeProfile) return;
    if (this.ctx.state !== 'running') return;
    if (this.settings.muted || this.settings.musicMuted) return;
    if (this.settings.masterVolume <= 0 || this.settings.musicVolume <= 0) return;

    const ctx = this.ctx;
    const dest = this.ambienceFilter;
    const profile = this.activeProfile;
    const now = ctx.currentTime;
    const step = this.ambienceStep;
    this.ambienceStep = (this.ambienceStep + 1) % 32;

    const barIndex = Math.floor(step / 8) % profile.chords.length;
    const stepInBar = step % 8; // 8 eighth-notes per bar
    const chord = profile.chords[barIndex];
    const bass = profile.bassNotes[barIndex];

    switch (profile.style) {
      case 'lobby': {
        // Warm electric piano chord on beat 1, gentle answer on beat 3.5
        if (stepInBar === 0) {
          for (const freq of chord) {
            this.playTone(ctx, dest, {
              type: 'triangle',
              freq,
              startTime: now,
              attack: 0.04,
              decay: 2.1,
              gain: 0.065,
            });
          }
          this.playTone(ctx, dest, {
            type: 'sine',
            freq: bass,
            startTime: now,
            attack: 0.03,
            decay: 1.8,
            gain: 0.14,
          });
        } else if (stepInBar === 5) {
          // Soft Rhodes upper-voicing shimmer
          this.playTone(ctx, dest, {
            type: 'sine',
            freq: chord[2] * 2,
            startTime: now,
            attack: 0.025,
            decay: 0.85,
            gain: 0.035,
          });
        }
        break;
      }

      case 'lounge': {
        // Bossa-nova syncopated chord comping (steps 0, 3, 6)
        if (stepInBar === 0 || stepInBar === 3 || stepInBar === 6) {
          const decay = stepInBar === 0 ? 1.1 : 0.65;
          for (const freq of chord) {
            this.playTone(ctx, dest, {
              type: 'sine',
              freq,
              startTime: now,
              attack: 0.02,
              decay,
              gain: 0.06,
            });
          }
        }
        // Bossa bass pulse (root on 0, fifth on 4)
        if (stepInBar === 0 || stepInBar === 4) {
          this.playTone(ctx, dest, {
            type: 'sine',
            freq: stepInBar === 0 ? bass : bass * 1.5,
            startTime: now,
            attack: 0.015,
            decay: 0.75,
            gain: 0.13,
          });
        }
        // Soft brushed shaker on even eighth-notes
        if (stepInBar % 2 === 1) {
          this.playNoise(ctx, dest, {
            startTime: now,
            attack: 0.005,
            decay: 0.045,
            gain: 0.025,
            filterType: 'highpass',
            filterFreq: 3400,
          });
        }
        break;
      }

      case 'pool': {
        // Mellow tropical marimba arpeggio
        const noteIdx = [0, 2, 1, 3, 2, 1, 3, 0][stepInBar] % chord.length;
        const freq = chord[noteIdx] * (stepInBar === 3 || stepInBar === 6 ? 2 : 1);
        if (stepInBar !== 5) {
          // Warm wooden marimba = sine fundamental + short 4x overtone
          this.playTone(ctx, dest, {
            type: 'sine',
            freq,
            startTime: now,
            attack: 0.006,
            decay: 0.45,
            gain: 0.085,
          });
          this.playTone(ctx, dest, {
            type: 'sine',
            freq: freq * 4,
            startTime: now,
            attack: 0.002,
            decay: 0.055,
            gain: 0.018,
          });
        }
        if (stepInBar === 0) {
          this.playTone(ctx, dest, {
            type: 'sine',
            freq: bass,
            startTime: now,
            attack: 0.03,
            decay: 1.5,
            gain: 0.11,
          });
        }
        break;
      }

      case 'nightclub': {
        // Deep smooth house bass pulse on every beat (0, 2, 4, 6) + offbeat push
        if (stepInBar % 2 === 0) {
          // Soft sub-kick thump
          this.playTone(ctx, dest, {
            type: 'sine',
            freq: 108,
            endFreq: 44,
            startTime: now,
            attack: 0.004,
            decay: 0.16,
            gain: 0.18,
          });
        } else {
          // Warm offbeat bass pulse
          this.playTone(ctx, dest, {
            type: 'sawtooth',
            freq: bass * 2,
            startTime: now,
            attack: 0.01,
            decay: 0.22,
            gain: 0.095,
            filterFreq: 420,
          });
          // Soft crisp hi-hat tick
          this.playNoise(ctx, dest, {
            startTime: now,
            attack: 0.002,
            decay: 0.04,
            gain: 0.03,
            filterType: 'highpass',
            filterFreq: 5200,
          });
        }
        // Smooth filtered synth-lounge chord stab on steps 0 & 6
        if (stepInBar === 0 || stepInBar === 6) {
          for (const freq of chord) {
            this.playTone(ctx, dest, {
              type: 'sawtooth',
              freq,
              startTime: now,
              attack: 0.015,
              decay: 0.48,
              gain: 0.032,
              filterFreq: 850,
            });
          }
        }
        break;
      }

      case 'race_arena': {
        // Energetic driving eighth-note synth bass
        const octave = stepInBar % 2 === 1 ? 2 : 1;
        this.playTone(ctx, dest, {
          type: 'sawtooth',
          freq: bass * octave,
          startTime: now,
          attack: 0.006,
          decay: 0.17,
          gain: 0.09,
          filterFreq: 680,
        });
        // Bright retro-synth arpeggio accents
        if (stepInBar === 0 || stepInBar === 3 || stepInBar === 6) {
          const arpNote = chord[stepInBar % chord.length];
          this.playTone(ctx, dest, {
            type: 'triangle',
            freq: arpNote * 2,
            startTime: now,
            attack: 0.005,
            decay: 0.2,
            gain: 0.055,
          });
        }
        if (stepInBar % 2 === 0) {
          this.playTone(ctx, dest, {
            type: 'sine',
            freq: 120,
            endFreq: 48,
            startTime: now,
            attack: 0.003,
            decay: 0.11,
            gain: 0.14,
          });
        }
        break;
      }
    }
  }
}

export const audioManager = new AudioManager();
export default audioManager;
