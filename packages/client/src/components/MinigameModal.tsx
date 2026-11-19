import React, { useEffect, useMemo, useState } from 'react';
import type { HotelEventInfo, MinigameType } from '@handihotel/shared';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Award,
  CalendarClock,
  CheckCircle2,
  Coins,
  Crown,
  Flame,
  Gamepad2,
  LogOut,
  Music,
  Play,
  ShieldAlert,
  Sparkles,
  Star,
  Timer,
  Trophy,
  X,
  Zap,
} from 'lucide-react';
import { audioManager } from '../audio/AudioManager';
import { api } from '../network/api';
import { gameSocket } from '../network/socket';
import { useGameStore } from '../state/useGameStore';

type HubTab = 'games' | 'events' | 'leaderboards';

interface MinigameCatalogCard {
  type: MinigameType;
  title: string;
  subtitle: string;
  description: string;
  roomId: string;
  roomLabel: string;
  rewardText: string;
  gradient: string;
  accent: string;
  icon: React.ReactNode;
}

const MINIGAME_CARDS: MinigameCatalogCard[] = [
  {
    type: 'wheelchair_racing',
    title: 'Wheelchair Racing',
    subtitle: '3-Lap Turbo Arena Drift',
    description:
      'Blaze through checkpoints, slam boost pads, and hit Spacebar for Turbo Boosts in the Grand Race Arena!',
    roomId: 'public-race-arena',
    roomLabel: 'Turbo Race Arena',
    rewardText: 'Up to 200 Credits + Stars',
    gradient: 'linear-gradient(135deg, rgba(234, 88, 12, 0.35), rgba(245, 158, 11, 0.16))',
    accent: '#fb923c',
    icon: <Zap size={24} />,
  },
  {
    type: 'hotel_olympics',
    title: 'Hotel Olympics',
    subtitle: 'Sprint, Slalom & Target Toss',
    description:
      'Compete across absurd multi-round hotel obstacle events! Time your sprints and rack up podium points.',
    roomId: 'public-race-arena',
    roomLabel: 'Turbo Race Arena',
    rewardText: 'Up to 180 Credits + Stars',
    gradient: 'linear-gradient(135deg, rgba(14, 165, 233, 0.35), rgba(37, 99, 235, 0.16))',
    accent: '#38bdf8',
    icon: <Trophy size={24} />,
  },
  {
    type: 'dance_battle',
    title: 'Dance Battles',
    subtitle: 'Synchronized Beat Prompts',
    description:
      'Hit the live beat prompts with Arrow keys / WASD or clicks to chain massive combo multipliers under neon lights!',
    roomId: 'public-nightclub',
    roomLabel: 'Neon Nightclub',
    rewardText: 'Up to 160 Credits + Stars',
    gradient: 'linear-gradient(135deg, rgba(168, 85, 247, 0.35), rgba(236, 72, 153, 0.18))',
    accent: '#e879f9',
    icon: <Music size={24} />,
  },
  {
    type: 'furniture_chaos',
    title: 'Furniture Chaos',
    subtitle: 'Hazard Survival & Musical Chairs',
    description:
      'Dodge flying sofas & rubber ducks, grab golden stars, and claim a safe chair before the timer hits zero!',
    roomId: 'public-event-hall',
    roomLabel: 'Grand Event Ballroom',
    rewardText: 'Up to 175 Credits + Stars',
    gradient: 'linear-gradient(135deg, rgba(34, 197, 94, 0.3), rgba(20, 184, 166, 0.16))',
    accent: '#4ade80',
    icon: <Flame size={24} />,
  },
];

const FALLBACK_EVENTS: HotelEventInfo[] = [
  {
    id: 'evt-turbo-gp',
    title: 'Hourly Turbo Wheelchair Grand Prix',
    description: 'Open-entry 3-lap championship in the Turbo Race Arena with double star bonuses!',
    roomId: 'public-race-arena',
    roomName: 'Turbo Race Arena',
    hostUsername: 'Concierge Clara',
    startsAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    endsAt: new Date(Date.now() + 40 * 60_000).toISOString(),
    active: true,
    rewardCredits: 250,
    rewardStars: 15,
    minigameType: 'wheelchair_racing',
  },
  {
    id: 'evt-neon-disco',
    title: 'Neon Nightclub Dance-Off',
    description: 'Show off your best combos and wheelie spins on the disco floor.',
    roomId: 'public-nightclub',
    roomName: 'Neon Nightclub',
    hostUsername: 'DJ Rollz',
    startsAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    endsAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    active: false,
    rewardCredits: 200,
    rewardStars: 12,
    minigameType: 'dance_battle',
  },
  {
    id: 'evt-ballroom-chaos',
    title: 'Grand Ballroom Furniture Chaos',
    description: 'Last guest seated wins the Golden Rubber Duck trophy bonus!',
    roomId: 'public-event-hall',
    roomName: 'Grand Event Ballroom',
    hostUsername: 'Bellhop Benny',
    startsAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    endsAt: new Date(Date.now() + 90 * 60_000).toISOString(),
    active: false,
    rewardCredits: 220,
    rewardStars: 10,
    minigameType: 'furniture_chaos',
  },
];

const DANCE_KEYS: { key: 'left' | 'up' | 'down' | 'right' | 'space'; label: string; icon: React.ReactNode }[] = [
  { key: 'left', label: 'A / ←', icon: <ArrowLeft size={16} /> },
  { key: 'up', label: 'W / ↑', icon: <ArrowUp size={16} /> },
  { key: 'down', label: 'S / ↓', icon: <ArrowDown size={16} /> },
  { key: 'right', label: 'D / →', icon: <ArrowRight size={16} /> },
  { key: 'space', label: 'SPACE', icon: <Sparkles size={16} /> },
];

export function MinigameModal() {
  const activeModal = useGameStore((s) => s.activeModal);
  const setActiveModal = useGameStore((s) => s.setActiveModal);
  const currentRoom = useGameStore((s) => s.currentRoom);
  const user = useGameStore((s) => s.user);
  const activeMinigame = useGameStore((s) => s.activeMinigame);
  const setActiveMinigame = useGameStore((s) => s.setActiveMinigame);
  const leaderboards = useGameStore((s) => s.leaderboards);
  const setLeaderboard = useGameStore((s) => s.setLeaderboard);
  const hotelEvents = useGameStore((s) => s.hotelEvents);
  const setHotelEvents = useGameStore((s) => s.setHotelEvents);
  const setProfileUserId = useGameStore((s) => s.setProfileUserId);
  const addNotification = useGameStore((s) => s.addNotification);

  const [hubTab, setHubTab] = useState<HubTab>('games');
  const [lbType, setLbType] = useState<MinigameType>('wheelchair_racing');
  const [joiningType, setJoiningType] = useState<MinigameType | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [actionFlash, setActionFlash] = useState<string | null>(null);

  // Tick timer while a minigame is active
  useEffect(() => {
    if (!activeMinigame) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [activeMinigame]);

  // Fetch events & leaderboards when hub opens
  useEffect(() => {
    if (activeModal !== 'minigames') return;
    api
      .getEvents()
      .then((evts) => {
        if (evts.length > 0) setHotelEvents(evts);
      })
      .catch(() => undefined);
  }, [activeModal, setHotelEvents]);

  useEffect(() => {
    if (activeModal !== 'minigames' || hubTab !== 'leaderboards') return;
    api
      .getLeaderboards(lbType)
      .then((entries) => setLeaderboard(lbType, entries))
      .catch(() => undefined);
  }, [activeModal, hubTab, lbType, setLeaderboard]);

  // Keyboard bindings during active minigame
  useEffect(() => {
    if (!activeMinigame || activeMinigame.status !== 'playing') return;

    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }

      const code = e.code;
      if (activeMinigame.type === 'wheelchair_racing') {
        if (code === 'Space') {
          e.preventDefault();
          gameSocket.minigameAction({ sessionId: activeMinigame.id, action: 'boost' });
          setActionFlash('TURBO BOOST!');
          setTimeout(() => setActionFlash(null), 500);
        } else if (
          code === 'ArrowUp' ||
          code === 'KeyW' ||
          code === 'ArrowRight' ||
          code === 'KeyD'
        ) {
          gameSocket.minigameAction({ sessionId: activeMinigame.id, action: 'checkpoint' });
        }
      } else if (activeMinigame.type === 'dance_battle') {
        let mapped: 'up' | 'down' | 'left' | 'right' | 'space' | null = null;
        if (code === 'ArrowUp' || code === 'KeyW') mapped = 'up';
        else if (code === 'ArrowDown' || code === 'KeyS') mapped = 'down';
        else if (code === 'ArrowLeft' || code === 'KeyA') mapped = 'left';
        else if (code === 'ArrowRight' || code === 'KeyD') mapped = 'right';
        else if (code === 'Space') mapped = 'space';
        if (mapped) {
          e.preventDefault();
          gameSocket.minigameAction({
            sessionId: activeMinigame.id,
            action: 'dance_hit',
            key: mapped,
          });
          audioManager.playEmote('dance');
          setActionFlash(mapped.toUpperCase());
          setTimeout(() => setActionFlash(null), 320);
        }
      } else if (activeMinigame.type === 'hotel_olympics') {
        if (code === 'Space') {
          e.preventDefault();
          gameSocket.minigameAction({
            sessionId: activeMinigame.id,
            action: 'olympics_score',
            value: 10,
          });
          audioManager.playBoost();
          setActionFlash('+10 SPRINT!');
          setTimeout(() => setActionFlash(null), 320);
        }
      } else if (activeMinigame.type === 'furniture_chaos') {
        if (code === 'Space') {
          e.preventDefault();
          gameSocket.minigameAction({
            sessionId: activeMinigame.id,
            action: 'collect_star',
          });
          audioManager.playCoin();
          setActionFlash('STAR GRAB!');
          setTimeout(() => setActionFlash(null), 350);
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeMinigame]);

  const handleJoinMinigame = async (roomId: string, type: MinigameType) => {
    setJoiningType(type);
    try {
      if (currentRoom?.id !== roomId) {
        const res = await gameSocket.joinRoom(roomId);
        if (!res.ok) {
          addNotification({
            type: 'warning',
            title: 'Room Join Notice',
            message: res.error || 'Joining minigame in current room instead.',
          });
        }
      }
      gameSocket.joinMinigame(roomId, type);
      setActiveModal(null);
    } finally {
      setJoiningType(null);
    }
  };

  const myPlayer = useMemo(() => {
    if (!activeMinigame || !user) return null;
    return activeMinigame.players.find((p) => p.userId === user.id) ?? null;
  }, [activeMinigame, user]);

  const sortedPlayers = useMemo(() => {
    if (!activeMinigame) return [];
    return [...activeMinigame.players].sort((a, b) => {
      if (a.rank && b.rank && a.rank !== b.rank) return a.rank - b.rank;
      return b.score - a.score;
    });
  }, [activeMinigame]);

  const remainingSeconds = useMemo(() => {
    if (!activeMinigame?.endsAt) return null;
    return Math.max(0, Math.ceil((activeMinigame.endsAt - nowMs) / 1000));
  }, [activeMinigame?.endsAt, nowMs]);

  const displayedEvents = hotelEvents.length > 0 ? hotelEvents : FALLBACK_EVENTS;
  const leaderboardEntries = leaderboards[lbType] ?? [];

  const activeCardMeta = activeMinigame
    ? MINIGAME_CARDS.find((c) => c.type === activeMinigame.type)
    : null;

  return (
    <>
      {/* =====================================================================
          PART A: MINIGAMES HUB MODAL (when activeModal === 'minigames')
         ===================================================================== */}
      {activeModal === 'minigames' && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 60,
            background: 'rgba(2, 6, 23, 0.74)',
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
              width: 'min(980px, 96vw)',
              height: 'min(680px, 90vh)',
              background: 'linear-gradient(160deg, rgba(15, 23, 42, 0.98), rgba(30, 41, 59, 0.97))',
              border: '1px solid rgba(251, 191, 36, 0.35)',
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
                    width: 38,
                    height: 38,
                    borderRadius: 10,
                    background: 'linear-gradient(135deg, #f59e0b, #ea580c)',
                    color: '#0f172a',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Gamepad2 size={21} />
                </div>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 800 }}>
                    HandiHotel Minigames &amp; Events
                  </div>
                  <div style={{ fontSize: 12, color: '#94a3b8' }}>
                    Race, dance, survive furniture chaos, and climb the hotel leaderboards!
                  </div>
                </div>
              </div>

              <button
                onClick={() => setActiveModal(null)}
                aria-label="Close Minigames Hub"
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

            {/* Tabs */}
            <div
              style={{
                display: 'flex',
                gap: 8,
                padding: '12px 20px',
                borderBottom: '1px solid rgba(148, 163, 184, 0.12)',
              }}
            >
              {(
                [
                  { id: 'games', label: 'Minigames', icon: <Gamepad2 size={15} /> },
                  { id: 'events', label: 'Scheduled Hotel Events', icon: <CalendarClock size={15} /> },
                  { id: 'leaderboards', label: 'Leaderboards', icon: <Trophy size={15} /> },
                ] as const
              ).map((t) => {
                const active = hubTab === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => setHubTab(t.id)}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 7,
                      padding: '8px 15px',
                      borderRadius: 10,
                      fontSize: 13,
                      fontWeight: 700,
                      cursor: 'pointer',
                      border: active
                        ? '1px solid rgba(251, 191, 36, 0.7)'
                        : '1px solid rgba(148, 163, 184, 0.2)',
                      background: active ? 'rgba(251, 191, 36, 0.18)' : 'rgba(15, 23, 42, 0.5)',
                      color: active ? '#fde68a' : '#cbd5e1',
                    }}
                  >
                    {t.icon}
                    {t.label}
                  </button>
                );
              })}
            </div>

            {/* Tab Content */}
            <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
              {/* GAMES GRID */}
              {hubTab === 'games' && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 16 }}>
                  {MINIGAME_CARDS.map((card) => (
                    <div
                      key={card.type}
                      style={{
                        borderRadius: 16,
                        padding: 18,
                        background: card.gradient,
                        border: `1px solid ${card.accent}55`,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 12,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <div
                            style={{
                              width: 44,
                              height: 44,
                              borderRadius: 12,
                              background: 'rgba(15, 23, 42, 0.65)',
                              border: `1px solid ${card.accent}66`,
                              color: card.accent,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                          >
                            {card.icon}
                          </div>
                          <div>
                            <div style={{ fontSize: 17, fontWeight: 900 }}>{card.title}</div>
                            <div style={{ fontSize: 12, color: card.accent, fontWeight: 700 }}>
                              {card.subtitle}
                            </div>
                          </div>
                        </div>
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            padding: '3px 9px',
                            borderRadius: 999,
                            background: 'rgba(15, 23, 42, 0.72)',
                            color: '#e2e8f0',
                          }}
                        >
                          {card.roomLabel}
                        </span>
                      </div>

                      <p style={{ margin: 0, fontSize: 13, color: '#e2e8f0', lineHeight: 1.45 }}>
                        {card.description}
                      </p>

                      <div
                        style={{
                          marginTop: 'auto',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 10,
                          paddingTop: 6,
                        }}
                      >
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 5,
                            fontSize: 12,
                            fontWeight: 700,
                            color: '#fde68a',
                          }}
                        >
                          <Coins size={14} /> {card.rewardText}
                        </span>
                        <button
                          disabled={joiningType === card.type}
                          onClick={() => handleJoinMinigame(card.roomId, card.type)}
                          style={{
                            padding: '9px 16px',
                            borderRadius: 10,
                            border: 'none',
                            background: 'linear-gradient(135deg, #f59e0b, #d97706)',
                            color: '#0f172a',
                            fontWeight: 900,
                            fontSize: 13,
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 6,
                          }}
                        >
                          <Play size={14} />
                          {joiningType === card.type ? 'Joining...' : 'Play Now / Join Match'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* EVENTS SCHEDULE */}
              {hubTab === 'events' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {displayedEvents.map((ev) => (
                    <div
                      key={ev.id}
                      style={{
                        padding: 16,
                        borderRadius: 14,
                        background: 'rgba(15, 23, 42, 0.72)',
                        border: ev.active
                          ? '1px solid rgba(34, 197, 94, 0.6)'
                          : '1px solid rgba(148, 163, 184, 0.2)',
                        display: 'flex',
                        flexWrap: 'wrap',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 12,
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 240 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 16, fontWeight: 800 }}>{ev.title}</span>
                          {ev.active && (
                            <span
                              style={{
                                fontSize: 10,
                                fontWeight: 800,
                                padding: '2px 8px',
                                borderRadius: 999,
                                background: 'rgba(34, 197, 94, 0.22)',
                                color: '#4ade80',
                              }}
                            >
                              LIVE NOW
                            </span>
                          )}
                        </div>
                        <p style={{ margin: '4px 0 6px', fontSize: 13, color: '#cbd5e1' }}>
                          {ev.description}
                        </p>
                        <div style={{ fontSize: 11, color: '#94a3b8', display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                          <span>Room: {ev.roomName}</span>
                          <span>Host: {ev.hostUsername}</span>
                          <span style={{ color: '#fbbf24' }}>
                            Reward: {ev.rewardCredits} Credits + {ev.rewardStars} Stars
                          </span>
                        </div>
                      </div>

                      <button
                        onClick={async () => {
                          if (ev.minigameType) {
                            await handleJoinMinigame(ev.roomId, ev.minigameType);
                          } else {
                            await gameSocket.joinRoom(ev.roomId);
                            setActiveModal(null);
                          }
                        }}
                        style={{
                          padding: '9px 15px',
                          borderRadius: 10,
                          border: 'none',
                          background: ev.active
                            ? 'linear-gradient(135deg, #22c55e, #16a34a)'
                            : 'linear-gradient(135deg, #38bdf8, #2563eb)',
                          color: '#0f172a',
                          fontWeight: 800,
                          fontSize: 12,
                          cursor: 'pointer',
                        }}
                      >
                        {ev.minigameType ? 'Join Event Match' : 'Visit Event Room'}
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* LEADERBOARDS */}
              {hubTab === 'leaderboards' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {MINIGAME_CARDS.map((c) => {
                      const active = lbType === c.type;
                      return (
                        <button
                          key={c.type}
                          onClick={() => setLbType(c.type)}
                          style={{
                            padding: '7px 13px',
                            borderRadius: 999,
                            fontSize: 12,
                            fontWeight: 700,
                            cursor: 'pointer',
                            border: active
                              ? `1px solid ${c.accent}`
                              : '1px solid rgba(148, 163, 184, 0.25)',
                            background: active ? `${c.accent}28` : 'rgba(15, 23, 42, 0.6)',
                            color: active ? c.accent : '#cbd5e1',
                          }}
                        >
                          {c.title}
                        </button>
                      );
                    })}
                  </div>

                  {leaderboardEntries.length === 0 ? (
                    <div
                      style={{
                        textAlign: 'center',
                        padding: 48,
                        borderRadius: 14,
                        background: 'rgba(15, 23, 42, 0.6)',
                        color: '#94a3b8',
                        fontSize: 13,
                      }}
                    >
                      No scores recorded yet for this minigame. Play a match to claim #1!
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {leaderboardEntries.map((entry) => {
                        const medalColor =
                          entry.rank === 1
                            ? '#fbbf24'
                            : entry.rank === 2
                            ? '#cbd5e1'
                            : entry.rank === 3
                            ? '#fb923c'
                            : '#64748b';
                        return (
                          <div
                            key={`${entry.userId}-${entry.rank}`}
                            onClick={() => setProfileUserId(entry.userId)}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              padding: '11px 16px',
                              borderRadius: 12,
                              background: 'rgba(15, 23, 42, 0.72)',
                              border: `1px solid ${
                                entry.rank <= 3 ? `${medalColor}55` : 'rgba(148, 163, 184, 0.16)'
                              }`,
                              cursor: 'pointer',
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                              <span
                                style={{
                                  width: 28,
                                  textAlign: 'center',
                                  fontWeight: 900,
                                  fontSize: 15,
                                  color: medalColor,
                                }}
                              >
                                #{entry.rank}
                              </span>
                              <div>
                                <div style={{ fontWeight: 800, fontSize: 14 }}>{entry.username}</div>
                                <div style={{ fontSize: 11, color: '#94a3b8' }}>
                                  {entry.wins} wins • {entry.gamesPlayed} games
                                </div>
                              </div>
                            </div>
                            <div style={{ fontWeight: 900, fontSize: 16, color: '#fde68a' }}>
                              {entry.score.toLocaleString()} pts
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          PART B: ACTIVE IN-GAME HUD OVERLAY (even when modal is closed!)
         ===================================================================== */}
      {activeMinigame && (
        <>
          {/* Top-Center Status & Timer Bar */}
          <div
            style={{
              position: 'fixed',
              top: 72,
              left: '50%',
              transform: 'translateX(-50%)',
              zIndex: 50,
              background: 'rgba(15, 23, 42, 0.92)',
              border: `1px solid ${activeCardMeta?.accent ?? '#fbbf24'}66`,
              borderRadius: 14,
              padding: '8px 16px',
              boxShadow: '0 12px 32px rgba(0, 0, 0, 0.5)',
              backdropFilter: 'blur(8px)',
              color: '#f8fafc',
              display: 'flex',
              alignItems: 'center',
              gap: 14,
              fontFamily: 'system-ui, -apple-system, sans-serif',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: activeCardMeta?.accent ?? '#fbbf24' }}>
                {activeCardMeta?.icon ?? <Gamepad2 size={18} />}
              </span>
              <span style={{ fontWeight: 900, fontSize: 14 }}>
                {activeCardMeta?.title ?? activeMinigame.type}
              </span>
            </div>

            {activeMinigame.status === 'countdown' && (
              <span
                style={{
                  padding: '3px 10px',
                  borderRadius: 999,
                  background: 'rgba(245, 158, 11, 0.25)',
                  color: '#fde68a',
                  fontWeight: 900,
                  fontSize: 13,
                }}
              >
                STARTING IN {activeMinigame.countdownSeconds}...
              </span>
            )}

            {activeMinigame.status === 'playing' && remainingSeconds !== null && (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  padding: '3px 10px',
                  borderRadius: 999,
                  background:
                    remainingSeconds <= 10
                      ? 'rgba(239, 68, 68, 0.28)'
                      : 'rgba(56, 189, 248, 0.2)',
                  color: remainingSeconds <= 10 ? '#fca5a5' : '#7dd3fc',
                  fontWeight: 800,
                  fontSize: 13,
                }}
              >
                <Timer size={14} /> {remainingSeconds}s
              </span>
            )}

            {activeMinigame.status === 'lobby' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button
                  onClick={() =>
                    gameSocket.setMinigameReady(activeMinigame.id, !(myPlayer?.ready ?? false))
                  }
                  style={{
                    padding: '5px 10px',
                    borderRadius: 8,
                    border: 'none',
                    background: myPlayer?.ready ? '#22c55e' : '#38bdf8',
                    color: '#0f172a',
                    fontWeight: 800,
                    fontSize: 12,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  <CheckCircle2 size={13} /> {myPlayer?.ready ? 'Ready!' : 'Ready Up'}
                </button>
                <button
                  onClick={() => gameSocket.startMinigame(activeMinigame.id)}
                  style={{
                    padding: '5px 11px',
                    borderRadius: 8,
                    border: 'none',
                    background: 'linear-gradient(135deg, #f59e0b, #d97706)',
                    color: '#0f172a',
                    fontWeight: 800,
                    fontSize: 12,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  <Play size={13} /> Start Now
                </button>
              </div>
            )}

            <button
              onClick={() => gameSocket.leaveMinigame(activeMinigame.id)}
              style={{
                padding: '5px 10px',
                borderRadius: 8,
                border: '1px solid rgba(239, 68, 68, 0.45)',
                background: 'rgba(239, 68, 68, 0.16)',
                color: '#fca5a5',
                fontWeight: 700,
                fontSize: 12,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <LogOut size={13} /> Leave Minigame
            </button>
          </div>

          {/* Live Scoreboard (Top-Left under header) */}
          <div
            style={{
              position: 'fixed',
              top: 130,
              left: 16,
              zIndex: 48,
              width: 220,
              background: 'rgba(15, 23, 42, 0.88)',
              border: '1px solid rgba(148, 163, 184, 0.25)',
              borderRadius: 14,
              padding: 10,
              backdropFilter: 'blur(8px)',
              color: '#f8fafc',
              fontFamily: 'system-ui, -apple-system, sans-serif',
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 800, color: '#94a3b8', marginBottom: 6, textTransform: 'uppercase' }}>
              Live Scoreboard
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {sortedPlayers.slice(0, 6).map((p, idx) => (
                <div
                  key={p.userId}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '5px 8px',
                    borderRadius: 8,
                    background:
                      p.userId === user?.id
                        ? 'rgba(56, 189, 248, 0.2)'
                        : 'rgba(30, 41, 59, 0.6)',
                    fontSize: 12,
                    opacity: p.eliminated ? 0.5 : 1,
                  }}
                >
                  <span style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {idx + 1}. {p.username}
                  </span>
                  <span style={{ fontWeight: 800, color: '#fde68a' }}>
                    {activeMinigame.type === 'wheelchair_racing'
                      ? `L${p.lap ?? 1} • ${p.score}`
                      : p.score}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Bottom-Center Interactive Controls HUD (while playing) */}
          {activeMinigame.status === 'playing' && (
            <div
              style={{
                position: 'fixed',
                bottom: 92,
                left: '50%',
                transform: 'translateX(-50%)',
                zIndex: 50,
                background: 'rgba(15, 23, 42, 0.92)',
                border: `1px solid ${activeCardMeta?.accent ?? '#fbbf24'}66`,
                borderRadius: 16,
                padding: '12px 18px',
                boxShadow: '0 16px 40px rgba(0, 0, 0, 0.55)',
                backdropFilter: 'blur(8px)',
                color: '#f8fafc',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 10,
                minWidth: 340,
                fontFamily: 'system-ui, -apple-system, sans-serif',
              }}
            >
              {actionFlash && (
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 900,
                    color: '#fde68a',
                    letterSpacing: 1,
                  }}
                >
                  {actionFlash}
                </div>
              )}

              {/* WHEELCHAIR RACING CONTROLS */}
              {activeMinigame.type === 'wheelchair_racing' && (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 13, fontWeight: 800 }}>
                    <span style={{ color: '#fb923c' }}>
                      LAP {myPlayer?.lap ?? 1} / {activeMinigame.totalLaps ?? 3}
                    </span>
                    <span style={{ color: '#7dd3fc' }}>
                      CHECKPOINT {myPlayer?.checkpointIndex ?? 0} /{' '}
                      {activeMinigame.checkpoints?.length ?? 6}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <button
                      onClick={() => {
                        gameSocket.minigameAction({
                          sessionId: activeMinigame.id,
                          action: 'checkpoint',
                        });
                      }}
                      style={{
                        padding: '10px 14px',
                        borderRadius: 10,
                        border: '1px solid rgba(56, 189, 248, 0.55)',
                        background: 'rgba(56, 189, 248, 0.2)',
                        color: '#7dd3fc',
                        fontWeight: 800,
                        fontSize: 13,
                        cursor: 'pointer',
                      }}
                    >
                      Accelerate / Checkpoint (W / ↑)
                    </button>
                    <button
                      onClick={() => {
                        gameSocket.minigameAction({
                          sessionId: activeMinigame.id,
                          action: 'boost',
                        });
                        setActionFlash('TURBO BOOST!');
                        setTimeout(() => setActionFlash(null), 500);
                      }}
                      style={{
                        padding: '10px 18px',
                        borderRadius: 10,
                        border: 'none',
                        background: 'linear-gradient(135deg, #f97316, #f59e0b)',
                        color: '#0f172a',
                        fontWeight: 900,
                        fontSize: 14,
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      <Zap size={16} /> TURBO BOOST (Space)
                    </button>
                  </div>
                </>
              )}

              {/* DANCE BATTLE CONTROLS */}
              {activeMinigame.type === 'dance_battle' && (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                    <span style={{ fontSize: 13, fontWeight: 800, color: '#e879f9' }}>
                      BEAT PROMPT:{' '}
                      <strong style={{ color: '#fde68a', fontSize: 16 }}>
                        {activeMinigame.currentPrompt?.key.toUpperCase() ?? 'GET READY'}
                      </strong>
                    </span>
                    <span
                      style={{
                        padding: '2px 9px',
                        borderRadius: 999,
                        background: 'rgba(168, 85, 247, 0.25)',
                        color: '#d8b4fe',
                        fontWeight: 900,
                        fontSize: 12,
                      }}
                    >
                      {myPlayer?.combo ?? 0}x COMBO
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {DANCE_KEYS.map((dk) => {
                      const isTarget = activeMinigame.currentPrompt?.key === dk.key;
                      return (
                        <button
                          key={dk.key}
                          onClick={() => {
                            gameSocket.minigameAction({
                              sessionId: activeMinigame.id,
                              action: 'dance_hit',
                              key: dk.key,
                            });
                            audioManager.playEmote('dance');
                          }}
                          style={{
                            padding: '9px 12px',
                            borderRadius: 10,
                            border: isTarget
                              ? '2px solid #fbbf24'
                              : '1px solid rgba(148, 163, 184, 0.3)',
                            background: isTarget
                              ? 'linear-gradient(135deg, #a855f7, #ec4899)'
                              : 'rgba(30, 41, 59, 0.85)',
                            color: '#ffffff',
                            fontWeight: 800,
                            fontSize: 11,
                            cursor: 'pointer',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            gap: 3,
                            minWidth: 56,
                          }}
                        >
                          {dk.icon}
                          <span>{dk.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}

              {/* HOTEL OLYMPICS CONTROLS */}
              {activeMinigame.type === 'hotel_olympics' && (
                <>
                  <div style={{ fontSize: 13, fontWeight: 800, color: '#7dd3fc' }}>
                    ROUND CHALLENGE:{' '}
                    <span style={{ color: '#fde68a', textTransform: 'uppercase' }}>
                      {(activeMinigame.olympicsRound ?? 'sprint').replace('_', ' ')}
                    </span>
                  </div>
                  <button
                    onClick={() => {
                      gameSocket.minigameAction({
                        sessionId: activeMinigame.id,
                        action: 'olympics_score',
                        value: 10,
                      });
                      audioManager.playBoost();
                      setActionFlash('+10 POINTS!');
                      setTimeout(() => setActionFlash(null), 300);
                    }}
                    style={{
                      padding: '11px 24px',
                      borderRadius: 12,
                      border: 'none',
                      background: 'linear-gradient(135deg, #38bdf8, #2563eb)',
                      color: '#0f172a',
                      fontWeight: 900,
                      fontSize: 14,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    <Award size={17} /> RAPID ACTION — SPRINT / JUMP (Space)
                  </button>
                </>
              )}

              {/* FURNITURE CHAOS CONTROLS */}
              {activeMinigame.type === 'furniture_chaos' && (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 13, fontWeight: 800 }}>
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 5,
                        color: myPlayer?.eliminated ? '#f87171' : '#4ade80',
                      }}
                    >
                      <ShieldAlert size={15} />
                      {myPlayer?.eliminated ? 'ELIMINATED' : 'SAFE — KEEP MOVING!'}
                    </span>
                    <span style={{ color: '#fbbf24' }}>
                      Hazards: {activeMinigame.activeHazards?.length ?? 0}
                    </span>
                  </div>
                  <button
                    disabled={Boolean(myPlayer?.eliminated)}
                    onClick={() => {
                      gameSocket.minigameAction({
                        sessionId: activeMinigame.id,
                        action: 'collect_star',
                      });
                      audioManager.playCoin();
                    }}
                    style={{
                      padding: '10px 20px',
                      borderRadius: 10,
                      border: 'none',
                      background: myPlayer?.eliminated
                        ? 'rgba(71, 85, 105, 0.5)'
                        : 'linear-gradient(135deg, #22c55e, #10b981)',
                      color: myPlayer?.eliminated ? '#94a3b8' : '#052e16',
                      fontWeight: 900,
                      fontSize: 13,
                      cursor: myPlayer?.eliminated ? 'not-allowed' : 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <Star size={15} /> Grab Golden Star / Safe Chair (Space)
                  </button>
                </>
              )}
            </div>
          )}

          {/* VICTORY PODIUM RESULTS SCREEN */}
          {activeMinigame.status === 'finished' && (
            <div
              style={{
                position: 'fixed',
                inset: 0,
                zIndex: 75,
                background: 'rgba(2, 6, 23, 0.78)',
                backdropFilter: 'blur(6px)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 16,
              }}
            >
              <div
                style={{
                  width: 'min(480px, 95vw)',
                  background: 'linear-gradient(160deg, rgba(15, 23, 42, 0.98), rgba(30, 41, 59, 0.98))',
                  border: '2px solid rgba(251, 191, 36, 0.65)',
                  borderRadius: 20,
                  padding: 24,
                  textAlign: 'center',
                  color: '#f8fafc',
                  boxShadow: '0 24px 64px rgba(0,0,0,0.75)',
                  fontFamily: 'system-ui, -apple-system, sans-serif',
                }}
              >
                <Crown size={40} color="#fbbf24" style={{ marginBottom: 8 }} />
                <div style={{ fontSize: 22, fontWeight: 900 }}>Match Complete!</div>
                <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 4 }}>
                  {activeCardMeta?.title ?? activeMinigame.type} — Victory Podium
                </div>

                <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {sortedPlayers.slice(0, 3).map((p, idx) => (
                    <div
                      key={p.userId}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '10px 14px',
                        borderRadius: 12,
                        background:
                          idx === 0
                            ? 'rgba(251, 191, 36, 0.2)'
                            : idx === 1
                            ? 'rgba(203, 213, 225, 0.14)'
                            : 'rgba(251, 146, 60, 0.16)',
                        border:
                          idx === 0
                            ? '1px solid rgba(251, 191, 36, 0.65)'
                            : '1px solid rgba(148, 163, 184, 0.25)',
                      }}
                    >
                      <span style={{ fontWeight: 900, fontSize: 15 }}>
                        {idx === 0 ? '🥇' : idx === 1 ? '🥈' : '🥉'} {p.username}
                      </span>
                      <span style={{ fontWeight: 800, color: '#fde68a' }}>{p.score} pts</span>
                    </div>
                  ))}
                </div>

                <div style={{ marginTop: 14, fontSize: 12, color: '#4ade80', fontWeight: 700 }}>
                  Pool Rewards: +{activeMinigame.rewardCredits} Credits &amp; +
                  {activeMinigame.rewardStars} Stars
                </div>

                <div style={{ marginTop: 18, display: 'flex', justifyContent: 'center', gap: 10 }}>
                  <button
                    onClick={() =>
                      gameSocket.joinMinigame(activeMinigame.roomId, activeMinigame.type)
                    }
                    style={{
                      padding: '10px 18px',
                      borderRadius: 10,
                      border: 'none',
                      background: 'linear-gradient(135deg, #f59e0b, #d97706)',
                      color: '#0f172a',
                      fontWeight: 900,
                      fontSize: 13,
                      cursor: 'pointer',
                    }}
                  >
                    Play Again
                  </button>
                  <button
                    onClick={() => setActiveMinigame(null)}
                    style={{
                      padding: '10px 18px',
                      borderRadius: 10,
                      border: '1px solid rgba(148, 163, 184, 0.35)',
                      background: 'rgba(30, 41, 59, 0.9)',
                      color: '#e2e8f0',
                      fontWeight: 700,
                      fontSize: 13,
                      cursor: 'pointer',
                    }}
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}

export default MinigameModal;
