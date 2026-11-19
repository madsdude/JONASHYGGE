import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import {
  Check,
  RotateCcw,
  RotateCw,
  Save,
  Sparkles,
  UserCircle,
  X,
} from 'lucide-react';
import {
  ACCESSORIES,
  AVATAR_PRESETS,
  BODY_TYPES,
  CLOTHING_COLOR_PALETTE,
  DEFAULT_AVATAR_CONFIG,
  EMOTE_TYPES,
  EXPRESSIONS,
  HAIR_COLOR_PALETTE,
  HAIR_STYLES,
  MOBILITY_AIDS,
  MOBILITY_COLOR_PALETTE,
  SHIRT_STYLES,
  SKIN_TONE_PALETTE,
  type AvatarConfig,
  type EmoteType,
} from '@handihotel/shared';
import { audioManager } from '../audio/AudioManager';
import { AvatarAnimator } from '../engine/AvatarAnimator';
import { buildAvatarRig, type AvatarRig } from '../engine/AvatarBuilder';
import { api } from '../network/api';
import { gameSocket } from '../network/socket';
import { useGameStore } from '../state/useGameStore';

type EditorTab =
  | 'presets'
  | 'body'
  | 'hair'
  | 'outfit'
  | 'accessories'
  | 'expression'
  | 'mobility';

const TABS: Array<{ id: EditorTab; label: string }> = [
  { id: 'presets', label: 'Presets' },
  { id: 'body', label: 'Body & Skin' },
  { id: 'hair', label: 'Hair' },
  { id: 'outfit', label: 'Outfit' },
  { id: 'accessories', label: 'Accessories' },
  { id: 'expression', label: 'Expression' },
  { id: 'mobility', label: 'Mobility Aid' },
];

export const AvatarEditorModal: React.FC = () => {
  const activeModal = useGameStore((s) => s.activeModal);
  const setActiveModal = useGameStore((s) => s.setActiveModal);
  const user = useGameStore((s) => s.user);
  const updateUser = useGameStore((s) => s.updateUser);
  const addNotification = useGameStore((s) => s.addNotification);

  const [tab, setTab] = useState<EditorTab>('mobility');
  const [draft, setDraft] = useState<AvatarConfig>(user?.avatar ?? DEFAULT_AVATAR_CONFIG);
  const [motto, setMotto] = useState(user?.motto ?? '');
  const [previewEmote, setPreviewEmote] = useState<EmoteType | null>(null);
  const [autoRotate, setAutoRotate] = useState(true);
  const [saving, setSaving] = useState(false);
  const [webglFailed, setWebglFailed] = useState(false);

  const canvasWrapRef = useRef<HTMLDivElement | null>(null);
  const yawRef = useRef(0.35);
  const autoRotateRef = useRef(true);
  const emoteRef = useRef<EmoteType | null>(null);

  useEffect(() => {
    autoRotateRef.current = autoRotate;
  }, [autoRotate]);

  useEffect(() => {
    emoteRef.current = previewEmote;
  }, [previewEmote]);

  // Sync draft when modal opens
  useEffect(() => {
    if (activeModal === 'avatar' && user) {
      setDraft({ ...DEFAULT_AVATAR_CONFIG, ...user.avatar });
      setMotto(user.motto ?? '');
      setPreviewEmote(null);
    }
  }, [activeModal, user]);

  // Live 3D Three.js preview
  useEffect(() => {
    if (activeModal !== 'avatar') return;
    const container = canvasWrapRef.current;
    if (!container) return;

    let renderer: THREE.WebGLRenderer | null = null;
    let rig: AvatarRig | null = null;
    let rafId = 0;

    try {
      const width = container.clientWidth || 280;
      const height = container.clientHeight || 340;

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(36, width / height, 0.1, 50);
      camera.position.set(0, 1.22, 3.2);
      camera.lookAt(0, 0.78, 0);

      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setSize(width, height);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      container.innerHTML = '';
      container.appendChild(renderer.domElement);

      const hemi = new THREE.HemisphereLight(0xfffbeb, 0x1e293b, 1.35);
      scene.add(hemi);
      const key = new THREE.DirectionalLight(0xffffff, 1.45);
      key.position.set(2.5, 4.5, 3.2);
      scene.add(key);
      const rim = new THREE.DirectionalLight(0xa855f7, 0.9);
      rim.position.set(-2.5, 2.2, -2.5);
      scene.add(rim);

      const stage = new THREE.Mesh(
        new THREE.CylinderGeometry(0.82, 0.92, 0.12, 36),
        new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.4, metalness: 0.3 })
      );
      stage.position.y = -0.06;
      scene.add(stage);

      rig = buildAvatarRig(draft);
      scene.add(rig.root);

      const animator = new AvatarAnimator(rig);
      let lastTime = performance.now();

      const animate = (now: number) => {
        rafId = requestAnimationFrame(animate);
        const dt = Math.min((now - lastTime) / 1000, 0.05);
        lastTime = now;
        if (autoRotateRef.current) {
          yawRef.current += dt * 0.55;
        }
        if (rig) {
          rig.root.rotation.y = yawRef.current;
        }
        animator.update(dt, {
          isMoving: false,
          isSitting: emoteRef.current === 'sit',
          emote: emoteRef.current,
        });
        renderer?.render(scene, camera);
      };

      setWebglFailed(false);
      rafId = requestAnimationFrame(animate);
    } catch {
      setWebglFailed(true);
    }

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      try {
        rig?.dispose();
        renderer?.dispose();
        if (renderer?.domElement && renderer.domElement.parentNode === container) {
          container.removeChild(renderer.domElement);
        }
      } catch {
        // Ignore cleanup errors
      }
    };
  }, [activeModal, draft]);

  if (activeModal !== 'avatar') return null;

  const patchDraft = (patch: Partial<AvatarConfig>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
  };

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    audioManager.playUiClick();
    try {
      const res = await api.updateAvatar(draft, motto.trim());
      updateUser({ avatar: res.user.avatar, motto: res.user.motto });
      gameSocket.broadcastAvatarUpdate(res.user.avatar, res.user.motto);
      audioManager.playCoin();
      addNotification({
        type: 'success',
        title: 'Avatar Saved!',
        message: 'Your fresh look is now live in the hotel.',
      });
      setActiveModal(null);
    } catch (err) {
      addNotification({
        type: 'error',
        title: 'Could Not Save Avatar',
        message: err instanceof Error ? err.message : 'Failed to update avatar.',
      });
    } finally {
      setSaving(false);
    }
  };

  const renderSwatchRow = (
    label: string,
    colors: readonly string[],
    selected: string,
    onSelect: (hex: string) => void,
    allowCustom = false
  ) => (
    <div style={{ marginBottom: 14 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 7,
          fontSize: 12.5,
          fontWeight: 700,
          color: '#CBD5E1',
        }}
      >
        <span>{label}</span>
        {allowCustom && (
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <span style={{ fontSize: 11, color: '#94A3B8' }}>Custom:</span>
            <input
              type="color"
              value={selected}
              onChange={(e) => onSelect(e.target.value)}
              style={{
                width: 26,
                height: 22,
                padding: 0,
                border: '1px solid rgba(255,255,255,0.35)',
                borderRadius: 6,
                background: 'transparent',
                cursor: 'pointer',
              }}
            />
          </label>
        )}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
        {colors.map((hex) => {
          const active = selected.toLowerCase() === hex.toLowerCase();
          return (
            <button
              key={hex}
              type="button"
              onClick={() => onSelect(hex)}
              title={hex}
              style={{
                width: 28,
                height: 28,
                borderRadius: 8,
                background: hex,
                border: active ? '2.5px solid #FACC15' : '1.5px solid rgba(255,255,255,0.28)',
                boxShadow: active ? '0 0 10px rgba(250, 204, 21, 0.7)' : 'none',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {active && <Check size={14} color={hex === '#F8FAFC' || hex === '#FDE2CC' ? '#0F172A' : '#FFFFFF'} />}
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <div
      role="dialog"
      aria-label="Avatar Wardrobe"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(2, 6, 23, 0.65)',
        backdropFilter: 'blur(6px)',
        padding: 16,
        fontFamily: "'Fredoka', 'Nunito', 'Segoe UI', system-ui, sans-serif",
      }}
      onClick={() => setActiveModal(null)}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(940px, 96vw)',
          maxHeight: '88vh',
          display: 'flex',
          flexDirection: 'column',
          borderRadius: 20,
          background: 'linear-gradient(180deg, #0F172A 0%, #1E293B 100%)',
          border: '2px solid rgba(168, 85, 247, 0.55)',
          boxShadow: '0 24px 64px rgba(0, 0, 0, 0.65)',
          color: '#F8FAFC',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '13px 18px',
            background: 'linear-gradient(90deg, #7C3AED 0%, #A855F7 100%)',
            borderBottom: '2px solid rgba(255, 255, 255, 0.16)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <UserCircle size={22} color="#FDE047" />
            <div>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Avatar & Mobility Studio</h2>
              <div style={{ fontSize: 12, color: '#F3E8FF' }}>
                Customize your style, expression, and mobility aid in live 3D
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setActiveModal(null)}
            aria-label="Close Avatar Studio"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 34,
              height: 34,
              borderRadius: 10,
              border: '1px solid rgba(255,255,255,0.28)',
              background: 'rgba(15, 23, 42, 0.35)',
              color: '#FFFFFF',
              cursor: 'pointer',
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Main 2-Column Content */}
        <div
          style={{
            flex: 1,
            display: 'grid',
            gridTemplateColumns: 'minmax(260px, 310px) 1fr',
            overflow: 'hidden',
          }}
        >
          {/* Left: 3D Preview + Emotes + Motto */}
          <div
            style={{
              padding: 16,
              borderRight: '1px solid rgba(148, 163, 184, 0.2)',
              background: 'rgba(15, 23, 42, 0.65)',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              overflowY: 'auto',
            }}
          >
            <div
              style={{
                position: 'relative',
                height: 290,
                borderRadius: 16,
                background:
                  'radial-gradient(circle at 50% 35%, rgba(168, 85, 247, 0.28), rgba(15, 23, 42, 0.92))',
                border: '1px solid rgba(168, 85, 247, 0.35)',
                overflow: 'hidden',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {webglFailed ? (
                <div style={{ textAlign: 'center', padding: 18, color: '#CBD5E1' }}>
                  <div style={{ fontSize: 38, marginBottom: 6 }}>✨♿</div>
                  <div style={{ fontWeight: 700 }}>3D Preview Unavailable</div>
                </div>
              ) : (
                <div ref={canvasWrapRef} style={{ width: '100%', height: '100%' }} />
              )}

              {/* Rotation controls */}
              <div
                style={{
                  position: 'absolute',
                  bottom: 8,
                  left: 8,
                  right: 8,
                  display: 'flex',
                  justifyContent: 'center',
                  gap: 6,
                }}
              >
                <button
                  type="button"
                  onClick={() => {
                    setAutoRotate(false);
                    yawRef.current -= 0.55;
                  }}
                  title="Turn Left"
                  style={{
                    padding: '5px 8px',
                    borderRadius: 8,
                    border: '1px solid rgba(255,255,255,0.2)',
                    background: 'rgba(15,23,42,0.75)',
                    color: '#E2E8F0',
                    cursor: 'pointer',
                  }}
                >
                  <RotateCcw size={13} />
                </button>
                <button
                  type="button"
                  onClick={() => setAutoRotate((v) => !v)}
                  style={{
                    padding: '4px 10px',
                    borderRadius: 8,
                    border: autoRotate
                      ? '1px solid #C084FC'
                      : '1px solid rgba(255,255,255,0.2)',
                    background: autoRotate
                      ? 'rgba(168, 85, 247, 0.32)'
                      : 'rgba(15,23,42,0.75)',
                    color: '#F8FAFC',
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {autoRotate ? 'Spin: ON' : 'Spin: OFF'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAutoRotate(false);
                    yawRef.current += 0.55;
                  }}
                  title="Turn Right"
                  style={{
                    padding: '5px 8px',
                    borderRadius: 8,
                    border: '1px solid rgba(255,255,255,0.2)',
                    background: 'rgba(15,23,42,0.75)',
                    color: '#E2E8F0',
                    cursor: 'pointer',
                  }}
                >
                  <RotateCw size={13} />
                </button>
              </div>
            </div>

            {/* Emote Preview Strip */}
            <div>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: '#94A3B8', marginBottom: 5 }}>
                Test Emote Animation
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {EMOTE_TYPES.map((em) => {
                  const active = previewEmote === em.id;
                  return (
                    <button
                      key={em.id}
                      type="button"
                      onClick={() => {
                        audioManager.playEmote(em.id);
                        setPreviewEmote(active ? null : em.id);
                      }}
                      title={em.label}
                      style={{
                        padding: '4px 8px',
                        borderRadius: 8,
                        border: active
                          ? '1.5px solid #FACC15'
                          : '1px solid rgba(148, 163, 184, 0.25)',
                        background: active ? 'rgba(250, 204, 21, 0.2)' : 'rgba(30, 41, 59, 0.8)',
                        color: '#F8FAFC',
                        fontSize: 11.5,
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      {em.icon} {em.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Motto */}
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, fontWeight: 700 }}>
              Hotel Motto
              <input
                type="text"
                value={motto}
                onChange={(e) => setMotto(e.target.value)}
                maxLength={64}
                placeholder="Rolling through HandiHotel!"
                style={{
                  padding: '8px 10px',
                  borderRadius: 9,
                  border: '1px solid rgba(148, 163, 184, 0.35)',
                  background: '#0F172A',
                  color: '#F8FAFC',
                  fontSize: 12.5,
                }}
              />
            </label>

            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving}
              style={{
                marginTop: 'auto',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 7,
                padding: '11px 14px',
                borderRadius: 12,
                border: '2px solid #4ADE80',
                background: 'linear-gradient(135deg, #16A34A 0%, #059669 100%)',
                color: '#FFFFFF',
                fontWeight: 800,
                fontSize: 14,
                cursor: saving ? 'wait' : 'pointer',
              }}
            >
              <Save size={16} />
              <span>{saving ? 'Saving Look...' : 'Save Avatar'}</span>
            </button>
          </div>

          {/* Right: Customization Tabs & Controls */}
          <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 6,
                padding: '12px 16px',
                borderBottom: '1px solid rgba(148, 163, 184, 0.2)',
                background: 'rgba(15, 23, 42, 0.45)',
              }}
            >
              {TABS.map((t) => {
                const active = tab === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      audioManager.playUiClick();
                      setTab(t.id);
                    }}
                    style={{
                      padding: '6px 11px',
                      borderRadius: 9,
                      border: active
                        ? '1.5px solid #C084FC'
                        : '1px solid rgba(148, 163, 184, 0.25)',
                      background: active ? 'rgba(168, 85, 247, 0.28)' : 'rgba(30, 41, 59, 0.78)',
                      color: active ? '#FFFFFF' : '#CBD5E1',
                      fontWeight: 700,
                      fontSize: 12,
                      cursor: 'pointer',
                    }}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: 18 }}>
              {tab === 'presets' && (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                    gap: 10,
                  }}
                >
                  {AVATAR_PRESETS.map((preset) => (
                    <button
                      key={preset.name}
                      type="button"
                      onClick={() => {
                        audioManager.playUiClick();
                        setDraft({ ...preset.config });
                      }}
                      style={{
                        textAlign: 'left',
                        padding: 13,
                        borderRadius: 12,
                        border: '1.5px solid rgba(192, 132, 252, 0.35)',
                        background: 'rgba(15, 23, 42, 0.78)',
                        color: '#F8FAFC',
                        cursor: 'pointer',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 800, fontSize: 14 }}>
                        <Sparkles size={14} color="#FACC15" />
                        {preset.name}
                      </div>
                      <div style={{ fontSize: 11.5, color: '#94A3B8', marginTop: 4 }}>
                        Aid: {MOBILITY_AIDS.find((m) => m.id === preset.config.mobilityAid)?.label}
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {tab === 'body' && (
                <>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#CBD5E1', marginBottom: 8 }}>
                    Body Type
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 18 }}>
                    {BODY_TYPES.map((b) => (
                      <button
                        key={b.id}
                        type="button"
                        onClick={() => patchDraft({ bodyType: b.id })}
                        style={{
                          padding: '8px 14px',
                          borderRadius: 10,
                          border:
                            draft.bodyType === b.id
                              ? '2px solid #FACC15'
                              : '1px solid rgba(148, 163, 184, 0.25)',
                          background:
                            draft.bodyType === b.id ? 'rgba(250, 204, 21, 0.18)' : '#0F172A',
                          color: '#F8FAFC',
                          fontWeight: 700,
                          fontSize: 13,
                          cursor: 'pointer',
                        }}
                      >
                        {b.label}
                      </button>
                    ))}
                  </div>
                  {renderSwatchRow('Skin Tone', SKIN_TONE_PALETTE, draft.skinTone, (c) =>
                    patchDraft({ skinTone: c })
                  )}
                </>
              )}

              {tab === 'hair' && (
                <>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#CBD5E1', marginBottom: 8 }}>
                    Hair Style
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 18 }}>
                    {HAIR_STYLES.map((h) => (
                      <button
                        key={h.id}
                        type="button"
                        onClick={() => patchDraft({ hairStyle: h.id })}
                        style={{
                          padding: '8px 13px',
                          borderRadius: 10,
                          border:
                            draft.hairStyle === h.id
                              ? '2px solid #C084FC'
                              : '1px solid rgba(148, 163, 184, 0.25)',
                          background:
                            draft.hairStyle === h.id ? 'rgba(168, 85, 247, 0.22)' : '#0F172A',
                          color: '#F8FAFC',
                          fontWeight: 700,
                          fontSize: 12.5,
                          cursor: 'pointer',
                        }}
                      >
                        {h.label}
                      </button>
                    ))}
                  </div>
                  {renderSwatchRow(
                    'Hair Color',
                    HAIR_COLOR_PALETTE,
                    draft.hairColor,
                    (c) => patchDraft({ hairColor: c }),
                    true
                  )}
                </>
              )}

              {tab === 'outfit' && (
                <>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#CBD5E1', marginBottom: 8 }}>
                    Top Style
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
                    {SHIRT_STYLES.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => patchDraft({ shirtStyle: s.id })}
                        style={{
                          padding: '7px 12px',
                          borderRadius: 10,
                          border:
                            draft.shirtStyle === s.id
                              ? '2px solid #38BDF8'
                              : '1px solid rgba(148, 163, 184, 0.25)',
                          background:
                            draft.shirtStyle === s.id ? 'rgba(56, 189, 248, 0.2)' : '#0F172A',
                          color: '#F8FAFC',
                          fontWeight: 700,
                          fontSize: 12.5,
                          cursor: 'pointer',
                        }}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                  {renderSwatchRow(
                    'Top Color',
                    CLOTHING_COLOR_PALETTE,
                    draft.shirtColor,
                    (c) => patchDraft({ shirtColor: c }),
                    true
                  )}
                  {renderSwatchRow(
                    'Pants Color',
                    CLOTHING_COLOR_PALETTE,
                    draft.pantsColor,
                    (c) => patchDraft({ pantsColor: c }),
                    true
                  )}
                  {renderSwatchRow(
                    'Shoe Color',
                    CLOTHING_COLOR_PALETTE,
                    draft.shoeColor,
                    (c) => patchDraft({ shoeColor: c }),
                    true
                  )}
                </>
              )}

              {tab === 'accessories' && (
                <>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#CBD5E1', marginBottom: 8 }}>
                    Accessory
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 18 }}>
                    {ACCESSORIES.map((acc) => (
                      <button
                        key={acc.id}
                        type="button"
                        onClick={() => patchDraft({ accessory: acc.id })}
                        style={{
                          padding: '8px 13px',
                          borderRadius: 10,
                          border:
                            draft.accessory === acc.id
                              ? '2px solid #FACC15'
                              : '1px solid rgba(148, 163, 184, 0.25)',
                          background:
                            draft.accessory === acc.id ? 'rgba(250, 204, 21, 0.18)' : '#0F172A',
                          color: '#F8FAFC',
                          fontWeight: 700,
                          fontSize: 12.5,
                          cursor: 'pointer',
                        }}
                      >
                        {acc.label}
                      </button>
                    ))}
                  </div>
                  {renderSwatchRow(
                    'Accessory Color',
                    CLOTHING_COLOR_PALETTE,
                    draft.accessoryColor,
                    (c) => patchDraft({ accessoryColor: c }),
                    true
                  )}
                </>
              )}

              {tab === 'expression' && (
                <>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#CBD5E1', marginBottom: 8 }}>
                    Facial Expression
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {EXPRESSIONS.map((exp) => (
                      <button
                        key={exp.id}
                        type="button"
                        onClick={() => patchDraft({ expression: exp.id })}
                        style={{
                          padding: '9px 15px',
                          borderRadius: 10,
                          border:
                            draft.expression === exp.id
                              ? '2px solid #38BDF8'
                              : '1px solid rgba(148, 163, 184, 0.25)',
                          background:
                            draft.expression === exp.id ? 'rgba(56, 189, 248, 0.2)' : '#0F172A',
                          color: '#F8FAFC',
                          fontWeight: 700,
                          fontSize: 13,
                          cursor: 'pointer',
                        }}
                      >
                        {exp.label}
                      </button>
                    ))}
                  </div>
                </>
              )}

              {tab === 'mobility' && (
                <>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#CBD5E1', marginBottom: 8 }}>
                    Mobility Aid (All 10 Included!)
                  </div>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(175px, 1fr))',
                      gap: 8,
                      marginBottom: 18,
                    }}
                  >
                    {MOBILITY_AIDS.map((aid) => {
                      const active = draft.mobilityAid === aid.id;
                      return (
                        <button
                          key={aid.id}
                          type="button"
                          onClick={() => patchDraft({ mobilityAid: aid.id })}
                          style={{
                            textAlign: 'left',
                            padding: '9px 11px',
                            borderRadius: 10,
                            border: active
                              ? '2px solid #38BDF8'
                              : '1px solid rgba(148, 163, 184, 0.25)',
                            background: active ? 'rgba(14, 165, 233, 0.24)' : '#0F172A',
                            color: '#F8FAFC',
                            fontWeight: 700,
                            fontSize: 12.5,
                            cursor: 'pointer',
                          }}
                        >
                          <div>{aid.label}</div>
                          {aid.speedBonus && (
                            <div style={{ fontSize: 11, color: '#4ADE80', marginTop: 2 }}>
                              ⚡ +{Math.round((aid.speedBonus - 1) * 100)}% Speed
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  {renderSwatchRow(
                    'Mobility Gear Color',
                    MOBILITY_COLOR_PALETTE,
                    draft.mobilityAidColor,
                    (c) => patchDraft({ mobilityAidColor: c }),
                    true
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AvatarEditorModal;
