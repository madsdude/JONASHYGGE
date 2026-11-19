import React, { useEffect, useState } from 'react';
import {
  Camera,
  Keyboard,
  Monitor,
  Music,
  RotateCcw,
  Settings,
  Volume2,
  VolumeX,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { audioManager, type AudioSettings } from '../audio/AudioManager';
import { useGameStore, type GraphicsQuality } from '../state/useGameStore';

const CONTROLS_GUIDE: { keys: string; action: string }[] = [
  { keys: 'Left Click Tile', action: 'Walk / Roll to tile or sit on chair' },
  { keys: 'Left Click Furni', action: 'Interact (arcade, jukebox, lights, elevator)' },
  { keys: 'Right / Middle Drag', action: 'Orbit or pan isometric camera' },
  { keys: 'Mouse Wheel', action: 'Zoom camera in and out' },
  { keys: 'R (in Room Builder)', action: 'Rotate placing or selected furniture 90°' },
  { keys: 'Spacebar', action: 'Turbo Boost / Rapid Minigame Action' },
  { keys: 'WASD / Arrow Keys', action: 'Dance Battle prompts & Race steering' },
  { keys: 'Enter', action: 'Focus chat bar / Send message' },
];

export function SettingsModal() {
  const activeModal = useGameStore((s) => s.activeModal);
  const setActiveModal = useGameStore((s) => s.setActiveModal);
  const graphicsQuality = useGameStore((s) => s.graphicsQuality);
  const setGraphicsQuality = useGameStore((s) => s.setGraphicsQuality);
  const addNotification = useGameStore((s) => s.addNotification);

  const [audio, setAudio] = useState<AudioSettings>(() => audioManager.getSettings());

  useEffect(() => {
    const unsubscribe = audioManager.subscribe((next) => setAudio(next));
    return unsubscribe;
  }, []);

  if (activeModal !== 'settings') return null;

  const dispatchCameraAction = (action: 'zoomIn' | 'zoomOut' | 'reset') => {
    window.dispatchEvent(new CustomEvent('handihotel:camera', { detail: { action } }));
    if (action === 'reset') {
      addNotification({
        type: 'info',
        title: 'Camera Reset',
        message: 'Isometric camera view restored to default.',
      });
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        background: 'rgba(2, 6, 23, 0.72)',
        backdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) setActiveModal(null);
      }}
    >
      <div
        style={{
          width: 'min(640px, 95vw)',
          maxHeight: '88vh',
          background: 'linear-gradient(160deg, rgba(15, 23, 42, 0.98), rgba(30, 41, 59, 0.97))',
          border: '1px solid rgba(148, 163, 184, 0.35)',
          borderRadius: 18,
          boxShadow: '0 24px 64px rgba(0, 0, 0, 0.65)',
          color: '#f8fafc',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '14px 20px',
            borderBottom: '1px solid rgba(148, 163, 184, 0.16)',
            background: 'rgba(15, 23, 42, 0.78)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: 'linear-gradient(135deg, #64748b, #475569)',
                color: '#f8fafc',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Settings size={19} />
            </div>
            <div>
              <div style={{ fontSize: 18, fontWeight: 800 }}>Hotel Settings</div>
              <div style={{ fontSize: 12, color: '#94a3b8' }}>
                Audio mix, 3D graphics quality, camera controls &amp; shortcuts
              </div>
            </div>
          </div>

          <button
            onClick={() => setActiveModal(null)}
            aria-label="Close Settings"
            style={{
              background: 'rgba(148, 163, 184, 0.12)',
              border: '1px solid rgba(148, 163, 184, 0.25)',
              color: '#e2e8f0',
              width: 34,
              height: 34,
              borderRadius: 10,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* AUDIO SECTION */}
          <section
            style={{
              padding: 14,
              borderRadius: 14,
              background: 'rgba(15, 23, 42, 0.65)',
              border: '1px solid rgba(148, 163, 184, 0.16)',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontWeight: 800, fontSize: 14 }}>
                <Volume2 size={16} color="#38bdf8" /> Audio &amp; Music
              </span>
              <button
                onClick={() => audioManager.playCoin()}
                style={{
                  padding: '5px 10px',
                  borderRadius: 8,
                  border: '1px solid rgba(251, 191, 36, 0.45)',
                  background: 'rgba(251, 191, 36, 0.14)',
                  color: '#fde68a',
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Test SFX
              </button>
            </div>

            {/* Master */}
            <div style={{ display: 'grid', gridTemplateColumns: '115px 1fr 44px 36px', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#cbd5e1' }}>Master</span>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(audio.masterVolume * 100)}
                onChange={(e) => audioManager.setMasterVolume(Number(e.target.value) / 100)}
                style={{ accentColor: '#38bdf8', cursor: 'pointer' }}
              />
              <span style={{ fontSize: 12, fontWeight: 700, textAlign: 'right', color: '#94a3b8' }}>
                {Math.round(audio.masterVolume * 100)}%
              </span>
              <button
                onClick={() => audioManager.toggleMute()}
                title={audio.muted ? 'Unmute Master' : 'Mute Master'}
                style={{
                  width: 32,
                  height: 30,
                  borderRadius: 8,
                  border: '1px solid rgba(148, 163, 184, 0.25)',
                  background: audio.muted ? 'rgba(239, 68, 68, 0.22)' : 'rgba(30, 41, 59, 0.85)',
                  color: audio.muted ? '#fca5a5' : '#e2e8f0',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {audio.muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
              </button>
            </div>

            {/* SFX */}
            <div style={{ display: 'grid', gridTemplateColumns: '115px 1fr 44px 36px', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#cbd5e1' }}>Sound Effects</span>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(audio.sfxVolume * 100)}
                onChange={(e) => audioManager.setSfxVolume(Number(e.target.value) / 100)}
                style={{ accentColor: '#fbbf24', cursor: 'pointer' }}
              />
              <span style={{ fontSize: 12, fontWeight: 700, textAlign: 'right', color: '#94a3b8' }}>
                {Math.round(audio.sfxVolume * 100)}%
              </span>
              <button
                onClick={() => audioManager.toggleSfxMute()}
                title={audio.sfxMuted ? 'Unmute SFX' : 'Mute SFX'}
                style={{
                  width: 32,
                  height: 30,
                  borderRadius: 8,
                  border: '1px solid rgba(148, 163, 184, 0.25)',
                  background: audio.sfxMuted ? 'rgba(239, 68, 68, 0.22)' : 'rgba(30, 41, 59, 0.85)',
                  color: audio.sfxMuted ? '#fca5a5' : '#e2e8f0',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {audio.sfxMuted ? <VolumeX size={15} /> : <Volume2 size={15} />}
              </button>
            </div>

            {/* Music */}
            <div style={{ display: 'grid', gridTemplateColumns: '115px 1fr 44px 36px', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#cbd5e1' }}>Hotel Ambience</span>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(audio.musicVolume * 100)}
                onChange={(e) => audioManager.setMusicVolume(Number(e.target.value) / 100)}
                style={{ accentColor: '#a855f7', cursor: 'pointer' }}
              />
              <span style={{ fontSize: 12, fontWeight: 700, textAlign: 'right', color: '#94a3b8' }}>
                {Math.round(audio.musicVolume * 100)}%
              </span>
              <button
                onClick={() => audioManager.toggleMusicMute()}
                title={audio.musicMuted ? 'Unmute Music' : 'Mute Music'}
                style={{
                  width: 32,
                  height: 30,
                  borderRadius: 8,
                  border: '1px solid rgba(148, 163, 184, 0.25)',
                  background: audio.musicMuted ? 'rgba(239, 68, 68, 0.22)' : 'rgba(30, 41, 59, 0.85)',
                  color: audio.musicMuted ? '#fca5a5' : '#e2e8f0',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {audio.musicMuted ? <VolumeX size={15} /> : <Music size={15} />}
              </button>
            </div>
          </section>

          {/* GRAPHICS QUALITY */}
          <section
            style={{
              padding: 14,
              borderRadius: 14,
              background: 'rgba(15, 23, 42, 0.65)',
              border: '1px solid rgba(148, 163, 184, 0.16)',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontWeight: 800, fontSize: 14 }}>
              <Monitor size={16} color="#fbbf24" /> Graphics Quality
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              {(
                [
                  { id: 'high', label: 'High', desc: 'Full shadows & crisp DPR' },
                  { id: 'medium', label: 'Medium', desc: 'Balanced performance' },
                  { id: 'low', label: 'Low', desc: 'Max FPS / battery saver' },
                ] as { id: GraphicsQuality; label: string; desc: string }[]
              ).map((q) => {
                const active = graphicsQuality === q.id;
                return (
                  <button
                    key={q.id}
                    onClick={() => setGraphicsQuality(q.id)}
                    style={{
                      padding: '10px 12px',
                      borderRadius: 10,
                      textAlign: 'left',
                      cursor: 'pointer',
                      border: active
                        ? '1px solid rgba(251, 191, 36, 0.75)'
                        : '1px solid rgba(148, 163, 184, 0.2)',
                      background: active ? 'rgba(251, 191, 36, 0.16)' : 'rgba(30, 41, 59, 0.55)',
                      color: '#f8fafc',
                    }}
                  >
                    <div style={{ fontWeight: 800, fontSize: 13, color: active ? '#fde68a' : '#f8fafc' }}>
                      {q.label}
                    </div>
                    <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{q.desc}</div>
                  </button>
                );
              })}
            </div>
          </section>

          {/* CAMERA CONTROLS */}
          <section
            style={{
              padding: 14,
              borderRadius: 14,
              background: 'rgba(15, 23, 42, 0.65)',
              border: '1px solid rgba(148, 163, 184, 0.16)',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontWeight: 800, fontSize: 14 }}>
              <Camera size={16} color="#4ade80" /> Camera Controls
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <button
                onClick={() => dispatchCameraAction('zoomIn')}
                style={{
                  flex: 1,
                  padding: '9px 12px',
                  borderRadius: 10,
                  border: '1px solid rgba(148, 163, 184, 0.28)',
                  background: 'rgba(30, 41, 59, 0.8)',
                  color: '#e2e8f0',
                  fontWeight: 700,
                  fontSize: 12,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                }}
              >
                <ZoomIn size={15} /> Zoom In
              </button>
              <button
                onClick={() => dispatchCameraAction('zoomOut')}
                style={{
                  flex: 1,
                  padding: '9px 12px',
                  borderRadius: 10,
                  border: '1px solid rgba(148, 163, 184, 0.28)',
                  background: 'rgba(30, 41, 59, 0.8)',
                  color: '#e2e8f0',
                  fontWeight: 700,
                  fontSize: 12,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                }}
              >
                <ZoomOut size={15} /> Zoom Out
              </button>
              <button
                onClick={() => dispatchCameraAction('reset')}
                style={{
                  flex: 1,
                  padding: '9px 12px',
                  borderRadius: 10,
                  border: '1px solid rgba(56, 189, 248, 0.45)',
                  background: 'rgba(56, 189, 248, 0.16)',
                  color: '#7dd3fc',
                  fontWeight: 700,
                  fontSize: 12,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                }}
              >
                <RotateCcw size={15} /> Reset View
              </button>
            </div>
          </section>

          {/* KEYBOARD & MOUSE GUIDE */}
          <section
            style={{
              padding: 14,
              borderRadius: 14,
              background: 'rgba(15, 23, 42, 0.65)',
              border: '1px solid rgba(148, 163, 184, 0.16)',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontWeight: 800, fontSize: 14 }}>
              <Keyboard size={16} color="#c084fc" /> Keyboard &amp; Mouse Controls
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {CONTROLS_GUIDE.map((row) => (
                <div
                  key={row.keys}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                    padding: '6px 9px',
                    borderRadius: 8,
                    background: 'rgba(30, 41, 59, 0.5)',
                    fontSize: 12,
                  }}
                >
                  <kbd
                    style={{
                      padding: '2px 8px',
                      borderRadius: 6,
                      background: 'rgba(15, 23, 42, 0.9)',
                      border: '1px solid rgba(148, 163, 184, 0.3)',
                      color: '#fde68a',
                      fontWeight: 700,
                      fontSize: 11,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {row.keys}
                  </kbd>
                  <span style={{ color: '#cbd5e1', textAlign: 'right' }}>{row.action}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

export default SettingsModal;
