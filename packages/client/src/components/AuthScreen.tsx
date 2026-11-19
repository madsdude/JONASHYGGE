import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { LogIn, Sparkles, UserPlus, Zap } from 'lucide-react';
import {
  AVATAR_PRESETS,
  DEFAULT_AVATAR_CONFIG,
  type AvatarConfig,
} from '@handihotel/shared';
import { audioManager } from '../audio/AudioManager';
import { AvatarAnimator } from '../engine/AvatarAnimator';
import { buildAvatarRig, type AvatarRig } from '../engine/AvatarBuilder';
import { api } from '../network/api';
import { useGameStore } from '../state/useGameStore';

type AuthMode = 'login' | 'register';

export const AuthScreen: React.FC = () => {
  const setAuth = useGameStore((s) => s.setAuth);
  const addNotification = useGameStore((s) => s.addNotification);

  const [mode, setMode] = useState<AuthMode>('login');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);

  const [presetIndex, setPresetIndex] = useState(0);
  const [webglFailed, setWebglFailed] = useState(false);
  const previewContainerRef = useRef<HTMLDivElement | null>(null);

  const previewConfig: AvatarConfig =
    AVATAR_PRESETS[presetIndex]?.config ?? DEFAULT_AVATAR_CONFIG;

  // Live 3D rotating avatar preview (WebGL-safe)
  useEffect(() => {
    const container = previewContainerRef.current;
    if (!container) return;

    let renderer: THREE.WebGLRenderer | null = null;
    let rig: AvatarRig | null = null;
    let rafId = 0;

    try {
      const width = container.clientWidth || 280;
      const height = container.clientHeight || 320;

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(36, width / height, 0.1, 50);
      camera.position.set(0, 1.18, 3.15);
      camera.lookAt(0, 0.78, 0);

      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setSize(width, height);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      container.innerHTML = '';
      container.appendChild(renderer.domElement);

      const hemi = new THREE.HemisphereLight(0xfffbeb, 0x1e293b, 1.35);
      scene.add(hemi);

      const keyLight = new THREE.DirectionalLight(0xffffff, 1.4);
      keyLight.position.set(2.5, 4.5, 3.2);
      scene.add(keyLight);

      const rimLight = new THREE.DirectionalLight(0x38bdf8, 0.9);
      rimLight.position.set(-2.5, 2.2, -2.5);
      scene.add(rimLight);

      // Pedestal disc
      const pedestalGeo = new THREE.CylinderGeometry(0.75, 0.85, 0.12, 32);
      const pedestalMat = new THREE.MeshStandardMaterial({
        color: 0x0ea5e9,
        roughness: 0.35,
        metalness: 0.25,
      });
      const pedestal = new THREE.Mesh(pedestalGeo, pedestalMat);
      pedestal.position.y = -0.06;
      scene.add(pedestal);

      rig = buildAvatarRig(previewConfig);
      scene.add(rig.root);

      const animator = new AvatarAnimator(rig);
      let lastTime = performance.now();

      const animate = (now: number) => {
        rafId = requestAnimationFrame(animate);
        const dt = Math.min((now - lastTime) / 1000, 0.05);
        lastTime = now;
        if (rig) {
          rig.root.rotation.y += dt * 0.65;
        }
        animator.update(dt, { isMoving: false, emote: 'wave' });
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
  }, [previewConfig]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedUser = username.trim();
    const trimmedEmail = email.trim();

    if (!trimmedUser) {
      setError('Please enter your username.');
      return;
    }
    if (mode === 'register') {
      if (trimmedUser.length < 3) {
        setError('Username must be at least 3 characters.');
        return;
      }
      if (!trimmedEmail || !trimmedEmail.includes('@')) {
        setError('Please enter a valid email address.');
        return;
      }
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    setSubmitting(true);
    audioManager.unlock();
    try {
      const res =
        mode === 'login'
          ? await api.login({ usernameOrEmail: trimmedUser, password })
          : await api.register({
              username: trimmedUser,
              email: trimmedEmail,
              password,
              avatar: previewConfig,
            });
      audioManager.playDoorChime();
      setAuth(res.token, res.user);
      addNotification({
        type: 'success',
        title: 'Welcome to HandiHotel!',
        message: `Checked in as ${res.user.username}.`,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleQuickDemo = async () => {
    if (demoLoading || submitting) return;
    setError(null);
    setDemoLoading(true);
    audioManager.unlock();

    // Try seeded demo accounts first, then fall back to creating a fresh guest account
    const demoAttempts = [
      { usernameOrEmail: 'hotelhost', password: 'demo1234' },
      { usernameOrEmail: 'turbo_wheelie', password: 'demo1234' },
    ];

    for (const creds of demoAttempts) {
      try {
        const res = await api.login(creds);
        audioManager.playDoorChime();
        setAuth(res.token, res.user);
        addNotification({
          type: 'success',
          title: 'Demo Check-In Complete!',
          message: `Playing as ${res.user.username}. Welcome to the Lobby!`,
        });
        setDemoLoading(false);
        return;
      } catch {
        // Try next fallback
      }
    }

    // Fallback: register a quick guest account
    const suffix = Math.floor(1000 + Math.random() * 9000);
    const guestName = `Guest${suffix}`;
    try {
      const res = await api.register({
        username: guestName,
        email: `${guestName.toLowerCase()}@handihotel.demo`,
        password: 'password123',
        avatar: previewConfig,
      });
      audioManager.playDoorChime();
      setAuth(res.token, res.user);
      addNotification({
        type: 'success',
        title: 'Quick Guest Check-In!',
        message: `Created guest pass for ${res.user.username}. Have fun!`,
      });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Could not reach HandiHotel server. Make sure the backend is running.'
      );
    } finally {
      setDemoLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        width: '100vw',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
        boxSizing: 'border-box',
        background:
          'radial-gradient(circle at 20% 20%, #0EA5E9 0%, #1E3A8A 42%, #0F172A 100%)',
        fontFamily: "'Fredoka', 'Nunito', 'Segoe UI', system-ui, sans-serif",
        color: '#F8FAFC',
        overflowY: 'auto',
      }}
    >
      <div
        style={{
          width: 'min(920px, 100%)',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(310px, 1fr))',
          borderRadius: 24,
          overflow: 'hidden',
          background: 'rgba(15, 23, 42, 0.92)',
          border: '2px solid rgba(56, 189, 248, 0.45)',
          boxShadow: '0 28px 80px rgba(0, 0, 0, 0.6)',
        }}
      >
        {/* Left: Hotel Branding & 3D Character Preview */}
        <div
          style={{
            padding: 28,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'space-between',
            background:
              'linear-gradient(160deg, rgba(14, 165, 233, 0.25) 0%, rgba(168, 85, 247, 0.22) 55%, rgba(15, 23, 42, 0.85) 100%)',
            borderRight: '1px solid rgba(148, 163, 184, 0.18)',
          }}
        >
          <div style={{ textAlign: 'center' }}>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 14px',
                borderRadius: 999,
                background: 'linear-gradient(135deg, #F59E0B, #EA580C)',
                border: '2px solid #FDE047',
                fontWeight: 800,
                fontSize: 13,
                letterSpacing: 0.6,
                marginBottom: 10,
                boxShadow: '0 4px 16px rgba(245, 158, 11, 0.4)',
              }}
            >
              <Sparkles size={15} />
              <span>THE 3D SOCIAL HOTEL</span>
            </div>
            <h1
              style={{
                margin: '0 0 6px',
                fontSize: 34,
                fontWeight: 900,
                letterSpacing: 0.5,
                color: '#FFFFFF',
                textShadow: '0 3px 0 rgba(15, 23, 42, 0.65)',
              }}
            >
              HANDIHOTEL
            </h1>
            <p style={{ margin: 0, fontSize: 13.5, color: '#BAE6FD', lineHeight: 1.45 }}>
              Hang out in 11 lively 3D rooms, customize your avatar & mobility gear, build suites,
              trade rares, and race in Wheelchair Grand Prix!
            </p>
          </div>

          {/* 3D Preview Box */}
          <div
            style={{
              width: '100%',
              height: 270,
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '14px 0',
            }}
          >
            {webglFailed ? (
              <div
                style={{
                  padding: '22px 18px',
                  borderRadius: 16,
                  background: 'rgba(15, 23, 42, 0.72)',
                  border: '1px solid rgba(56, 189, 248, 0.35)',
                  textAlign: 'center',
                  color: '#BAE6FD',
                }}
              >
                <div style={{ fontSize: 42, marginBottom: 6 }}>🏨♿✨</div>
                <div style={{ fontWeight: 800, fontSize: 15 }}>
                  {AVATAR_PRESETS[presetIndex]?.name ?? 'Hotel Guest'}
                </div>
                <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 4 }}>
                  3D preview ready when WebGL is enabled
                </div>
              </div>
            ) : (
              <div
                ref={previewContainerRef}
                style={{ width: '100%', height: '100%', borderRadius: 16, overflow: 'hidden' }}
              />
            )}
          </div>

          {/* Preset Switcher */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center' }}>
            {AVATAR_PRESETS.map((preset, idx) => (
              <button
                key={preset.name}
                type="button"
                onClick={() => {
                  audioManager.playUiClick();
                  setPresetIndex(idx);
                }}
                style={{
                  padding: '5px 10px',
                  borderRadius: 999,
                  border:
                    presetIndex === idx
                      ? '1.5px solid #FACC15'
                      : '1px solid rgba(148, 163, 184, 0.3)',
                  background:
                    presetIndex === idx ? 'rgba(250, 204, 21, 0.22)' : 'rgba(15, 23, 42, 0.65)',
                  color: presetIndex === idx ? '#FEF08A' : '#CBD5E1',
                  fontSize: 11.5,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {preset.name}
              </button>
            ))}
          </div>
        </div>

        {/* Right: Login / Register Form */}
        <div style={{ padding: 28, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          {/* Tabs */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 8,
              padding: 5,
              borderRadius: 12,
              background: 'rgba(30, 41, 59, 0.85)',
              marginBottom: 18,
            }}
          >
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setError(null);
              }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                padding: '9px 12px',
                borderRadius: 9,
                border: 'none',
                background: mode === 'login' ? '#0EA5E9' : 'transparent',
                color: mode === 'login' ? '#FFFFFF' : '#94A3B8',
                fontWeight: 800,
                fontSize: 13.5,
                cursor: 'pointer',
              }}
            >
              <LogIn size={16} /> Check In
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('register');
                setError(null);
              }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                padding: '9px 12px',
                borderRadius: 9,
                border: 'none',
                background: mode === 'register' ? '#A855F7' : 'transparent',
                color: mode === 'register' ? '#FFFFFF' : '#94A3B8',
                fontWeight: 800,
                fontSize: 13.5,
                cursor: 'pointer',
              }}
            >
              <UserPlus size={16} /> New Guest
            </button>
          </div>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 13, fontWeight: 700 }}>
              {mode === 'login' ? 'Username or Email' : 'Username'}
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder={mode === 'login' ? 'hotelhost' : 'Choose a cool name'}
                autoComplete="username"
                required
                style={{
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: '1.5px solid rgba(148, 163, 184, 0.32)',
                  background: '#0F172A',
                  color: '#F8FAFC',
                  fontSize: 14,
                  outline: 'none',
                }}
              />
            </label>

            {mode === 'register' && (
              <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 13, fontWeight: 700 }}>
                Email
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@handihotel.com"
                  autoComplete="email"
                  required
                  style={{
                    padding: '10px 12px',
                    borderRadius: 10,
                    border: '1.5px solid rgba(148, 163, 184, 0.32)',
                    background: '#0F172A',
                    color: '#F8FAFC',
                    fontSize: 14,
                    outline: 'none',
                  }}
                />
              </label>
            )}

            <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 13, fontWeight: 700 }}>
              Password
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                required
                style={{
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: '1.5px solid rgba(148, 163, 184, 0.32)',
                  background: '#0F172A',
                  color: '#F8FAFC',
                  fontSize: 14,
                  outline: 'none',
                }}
              />
            </label>

            {error && (
              <div
                role="alert"
                style={{
                  padding: '9px 12px',
                  borderRadius: 10,
                  background: 'rgba(239, 68, 68, 0.18)',
                  border: '1px solid rgba(248, 113, 113, 0.5)',
                  color: '#FCA5A5',
                  fontSize: 12.5,
                  fontWeight: 600,
                }}
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || demoLoading}
              style={{
                marginTop: 4,
                padding: '12px 16px',
                borderRadius: 12,
                border: 'none',
                background:
                  mode === 'login'
                    ? 'linear-gradient(135deg, #0EA5E9 0%, #2563EB 100%)'
                    : 'linear-gradient(135deg, #A855F7 0%, #7C3AED 100%)',
                color: '#FFFFFF',
                fontWeight: 800,
                fontSize: 15,
                cursor: submitting ? 'wait' : 'pointer',
                boxShadow: '0 4px 16px rgba(14, 165, 233, 0.35)',
              }}
            >
              {submitting
                ? 'Checking In...'
                : mode === 'login'
                  ? 'Enter HandiHotel'
                  : 'Create Guest Account'}
            </button>
          </form>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              margin: '18px 0 14px',
              color: '#64748B',
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            <div style={{ flex: 1, height: 1, background: 'rgba(148, 163, 184, 0.2)' }} />
            <span>OR JUMP RIGHT IN</span>
            <div style={{ flex: 1, height: 1, background: 'rgba(148, 163, 184, 0.2)' }} />
          </div>

          <button
            type="button"
            onClick={() => void handleQuickDemo()}
            disabled={demoLoading || submitting}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              padding: '12px 16px',
              borderRadius: 12,
              border: '2px solid #FACC15',
              background: 'linear-gradient(135deg, #F59E0B 0%, #EA580C 100%)',
              color: '#FFFBEB',
              fontWeight: 800,
              fontSize: 14.5,
              cursor: demoLoading ? 'wait' : 'pointer',
              boxShadow: '0 4px 0 #9A3412, 0 8px 20px rgba(245, 158, 11, 0.35)',
            }}
          >
            <Zap size={17} />
            <span>{demoLoading ? 'Preparing Suite...' : 'Quick Play Demo Account'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default AuthScreen;
