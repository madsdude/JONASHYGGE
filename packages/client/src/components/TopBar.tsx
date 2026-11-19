import React, { useEffect, useState } from 'react';
import {
  Coins,
  Gift,
  Heart,
  LogOut,
  Music,
  Settings,
  Sparkles,
  Star,
  Users,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { RoomTheme } from '@handihotel/shared';
import { audioManager, type AudioSettings } from '../audio/AudioManager';
import { api } from '../network/api';
import { gameSocket } from '../network/socket';
import { useGameStore } from '../state/useGameStore';

const THEME_BADGE: Record<RoomTheme, { label: string; bg: string; color: string; icon: string }> = {
  lobby: { label: 'Lobby', bg: 'rgba(245, 158, 11, 0.22)', color: '#FDE68A', icon: '🏨' },
  reception: { label: 'Reception', bg: 'rgba(59, 130, 246, 0.25)', color: '#BFDBFE', icon: '🛎️' },
  lounge: { label: 'Lounge', bg: 'rgba(239, 68, 68, 0.24)', color: '#FECACA', icon: '🛋️' },
  restaurant: { label: 'Dining', bg: 'rgba(249, 115, 22, 0.25)', color: '#FED7AA', icon: '🍽️' },
  nightclub: { label: 'Nightclub', bg: 'rgba(168, 85, 247, 0.28)', color: '#E9D5FF', icon: '🪩' },
  pool: { label: 'Pool', bg: 'rgba(14, 165, 233, 0.28)', color: '#BAE6FD', icon: '🏊' },
  arcade: { label: 'Arcade', bg: 'rgba(236, 72, 153, 0.28)', color: '#FBCFE8', icon: '🕹️' },
  rooftop: { label: 'Rooftop', bg: 'rgba(251, 146, 60, 0.26)', color: '#FFEDD5', icon: '🌅' },
  corridor: { label: 'Corridor', bg: 'rgba(148, 163, 184, 0.24)', color: '#E2E8F0', icon: '🛗' },
  race_arena: { label: 'Race Arena', bg: 'rgba(34, 197, 94, 0.26)', color: '#BBF7D0', icon: '🏁' },
  event_hall: { label: 'Events', bg: 'rgba(234, 179, 8, 0.28)', color: '#FEF08A', icon: '🎭' },
  private: { label: 'Suite', bg: 'rgba(99, 102, 241, 0.26)', color: '#C7D2FE', icon: '🏠' },
};

export const TopBar: React.FC = () => {
  const user = useGameStore((s) => s.user);
  const currentRoom = useGameStore((s) => s.currentRoom);
  const players = useGameStore((s) => s.players);
  const dailyReward = useGameStore((s) => s.dailyReward);
  const setDailyReward = useGameStore((s) => s.setDailyReward);
  const updateBalance = useGameStore((s) => s.updateBalance);
  const addNotification = useGameStore((s) => s.addNotification);
  const toggleModal = useGameStore((s) => s.toggleModal);
  const logout = useGameStore((s) => s.logout);

  const [audioSettings, setAudioSettings] = useState<AudioSettings>(() => audioManager.getSettings());
  const [claimingDaily, setClaimingDaily] = useState(false);

  useEffect(() => {
    return audioManager.subscribe(setAudioSettings);
  }, []);

  const playerCount = Object.keys(players).length;
  const themeMeta = currentRoom ? THEME_BADGE[currentRoom.theme] ?? THEME_BADGE.private : null;

  const handleClaimDaily = async () => {
    if (claimingDaily) return;
    setClaimingDaily(true);
    try {
      const res = await api.claimDailyReward();
      updateBalance(res.credits, res.stars);
      setDailyReward(res.status);
      audioManager.playCoin();
      addNotification({
        type: 'success',
        title: 'Daily Reward Claimed!',
        message: `+${res.rewardCredits} Credits & +${res.rewardStars} Stars (Day ${res.status.currentStreak} streak!)`,
      });
    } catch (err) {
      addNotification({
        type: 'info',
        title: 'Daily Reward',
        message: err instanceof Error ? err.message : 'Already claimed today! Come back tomorrow.',
      });
    } finally {
      setClaimingDaily(false);
    }
  };

  const handleLogout = () => {
    audioManager.stopAmbience();
    gameSocket.disconnect();
    logout();
  };

  const handleLikeRoom = () => {
    if (!currentRoom) return;
    gameSocket.likeRoom(currentRoom.id);
    audioManager.playUiClick();
  };

  return (
    <header
      style={{
        position: 'fixed',
        top: 10,
        left: 12,
        right: 12,
        zIndex: 40,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
        padding: '8px 14px',
        borderRadius: 16,
        background:
          'linear-gradient(180deg, rgba(15, 23, 42, 0.92) 0%, rgba(17, 29, 54, 0.88) 100%)',
        border: '2px solid rgba(56, 189, 248, 0.35)',
        boxShadow: '0 8px 28px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.14)',
        backdropFilter: 'blur(12px)',
        color: '#F8FAFC',
        fontFamily: "'Fredoka', 'Nunito', 'Segoe UI', system-ui, sans-serif",
        pointerEvents: 'auto',
      }}
    >
      {/* Left: Hotel Logo + Room Info */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
        <button
          type="button"
          onClick={() => {
            audioManager.playUiClick();
            toggleModal('navigator');
          }}
          title="Open Hotel Navigator"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 12px',
            borderRadius: 12,
            border: '2px solid #FACC15',
            background: 'linear-gradient(135deg, #F59E0B 0%, #EA580C 100%)',
            color: '#FFFBEB',
            fontWeight: 800,
            fontSize: 15,
            letterSpacing: 0.4,
            cursor: 'pointer',
            boxShadow: '0 3px 0 #9A3412, 0 4px 12px rgba(245, 158, 11, 0.35)',
            flexShrink: 0,
          }}
        >
          <Sparkles size={16} />
          <span>HANDIHOTEL</span>
        </button>

        {currentRoom && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              minWidth: 0,
              padding: '4px 10px',
              borderRadius: 10,
              background: 'rgba(30, 41, 59, 0.72)',
              border: '1px solid rgba(148, 163, 184, 0.24)',
            }}
          >
            {themeMeta && (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '2px 8px',
                  borderRadius: 999,
                  background: themeMeta.bg,
                  color: themeMeta.color,
                  fontSize: 11,
                  fontWeight: 700,
                  whiteSpace: 'nowrap',
                }}
              >
                <span>{themeMeta.icon}</span>
                <span>{themeMeta.label}</span>
              </span>
            )}
            <span
              style={{
                fontWeight: 700,
                fontSize: 14,
                color: '#F8FAFC',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxWidth: 200,
              }}
              title={currentRoom.name}
            >
              {currentRoom.name}
            </span>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 12,
                color: '#93C5FD',
                fontWeight: 700,
                whiteSpace: 'nowrap',
              }}
              title="Guests in room"
            >
              <Users size={13} />
              {playerCount}/{currentRoom.permissions.maxUsers}
            </span>
            <button
              type="button"
              onClick={handleLikeRoom}
              title="Like this room"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 3,
                padding: '2px 6px',
                borderRadius: 8,
                border: '1px solid rgba(244, 63, 94, 0.35)',
                background: 'rgba(244, 63, 94, 0.14)',
                color: '#FDA4AF',
                fontSize: 11,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              <Heart size={11} />
              {currentRoom.likes}
            </button>
          </div>
        )}
      </div>

      {/* Right: Currency, Daily Reward, Audio, Settings, Logout */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        {/* Credits */}
        <button
          type="button"
          onClick={() => {
            audioManager.playUiClick();
            toggleModal('shop');
          }}
          title="Credits — Open Shop"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '5px 10px',
            borderRadius: 10,
            background: 'rgba(250, 204, 21, 0.16)',
            border: '1px solid rgba(250, 204, 21, 0.45)',
            color: '#FDE047',
            fontWeight: 800,
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          <Coins size={15} />
          <span>{(user?.credits ?? 0).toLocaleString()}</span>
        </button>

        {/* Stars */}
        <button
          type="button"
          onClick={() => {
            audioManager.playUiClick();
            toggleModal('minigames');
          }}
          title="Hotel Stars — Earned in Minigames & Events"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '5px 10px',
            borderRadius: 10,
            background: 'rgba(56, 189, 248, 0.16)',
            border: '1px solid rgba(56, 189, 248, 0.45)',
            color: '#7DD3FC',
            fontWeight: 800,
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          <Star size={15} />
          <span>{(user?.stars ?? 0).toLocaleString()}</span>
        </button>

        {/* Daily Reward */}
        <button
          type="button"
          onClick={handleClaimDaily}
          disabled={claimingDaily}
          title={
            dailyReward?.canClaim
              ? `Claim +${dailyReward.nextRewardCredits} Credits!`
              : 'Daily Reward'
          }
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 11px',
            borderRadius: 10,
            border: dailyReward?.canClaim
              ? '1px solid #4ADE80'
              : '1px solid rgba(148, 163, 184, 0.28)',
            background: dailyReward?.canClaim
              ? 'linear-gradient(135deg, #16A34A 0%, #059669 100%)'
              : 'rgba(30, 41, 59, 0.72)',
            color: dailyReward?.canClaim ? '#FFFFFF' : '#94A3B8',
            fontWeight: 700,
            fontSize: 12,
            cursor: claimingDaily ? 'wait' : 'pointer',
            boxShadow: dailyReward?.canClaim ? '0 0 14px rgba(34, 197, 94, 0.45)' : 'none',
          }}
        >
          <Gift size={14} />
          <span>{dailyReward?.canClaim ? 'Claim Daily!' : 'Daily'}</span>
        </button>

        {/* Mute Master */}
        <button
          type="button"
          onClick={() => audioManager.toggleMute()}
          title={audioSettings.muted ? 'Unmute Audio' : 'Mute Audio'}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 34,
            height: 34,
            borderRadius: 10,
            border: '1px solid rgba(148, 163, 184, 0.28)',
            background: audioSettings.muted
              ? 'rgba(239, 68, 68, 0.22)'
              : 'rgba(30, 41, 59, 0.78)',
            color: audioSettings.muted ? '#FCA5A5' : '#E2E8F0',
            cursor: 'pointer',
          }}
        >
          {audioSettings.muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
        </button>

        {/* Music Toggle */}
        <button
          type="button"
          onClick={() => audioManager.toggleMusicMute()}
          title={audioSettings.musicMuted ? 'Enable Ambient Music' : 'Mute Ambient Music'}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 34,
            height: 34,
            borderRadius: 10,
            border: '1px solid rgba(148, 163, 184, 0.28)',
            background: audioSettings.musicMuted
              ? 'rgba(100, 116, 139, 0.25)'
              : 'rgba(139, 92, 246, 0.26)',
            color: audioSettings.musicMuted ? '#94A3B8' : '#DDD6FE',
            cursor: 'pointer',
          }}
        >
          <Music size={16} />
        </button>

        {/* Settings */}
        <button
          type="button"
          onClick={() => {
            audioManager.playUiClick();
            toggleModal('settings');
          }}
          title="Settings"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 34,
            height: 34,
            borderRadius: 10,
            border: '1px solid rgba(148, 163, 184, 0.28)',
            background: 'rgba(30, 41, 59, 0.78)',
            color: '#E2E8F0',
            cursor: 'pointer',
          }}
        >
          <Settings size={16} />
        </button>

        {/* Logout */}
        <button
          type="button"
          onClick={handleLogout}
          title="Log Out"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 34,
            height: 34,
            borderRadius: 10,
            border: '1px solid rgba(239, 68, 68, 0.35)',
            background: 'rgba(239, 68, 68, 0.16)',
            color: '#FCA5A5',
            cursor: 'pointer',
          }}
        >
          <LogOut size={16} />
        </button>
      </div>
    </header>
  );
};

export default TopBar;
