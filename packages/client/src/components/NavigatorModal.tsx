import React, { useEffect, useMemo, useState } from 'react';
import {
  Building2,
  Compass,
  DoorOpen,
  Heart,
  Home,
  Lock,
  PlusCircle,
  RefreshCw,
  Search,
  Users,
  X,
} from 'lucide-react';
import {
  PUBLIC_ROOMS,
  ROOM_TEMPLATES,
  type FloorStyle,
  type RoomSummary,
  type RoomTemplateId,
  type RoomTheme,
  type WallStyle,
} from '@handihotel/shared';
import { audioManager } from '../audio/AudioManager';
import { api } from '../network/api';
import { gameSocket } from '../network/socket';
import { useGameStore } from '../state/useGameStore';

type NavTab = 'public' | 'player' | 'mine' | 'create';

const THEME_ICON: Record<RoomTheme, string> = {
  lobby: '🏨',
  reception: '🛎️',
  lounge: '🛋️',
  restaurant: '🍽️',
  nightclub: '🪩',
  pool: '🏊',
  arcade: '🕹️',
  rooftop: '🌅',
  corridor: '🛗',
  race_arena: '🏁',
  event_hall: '🎭',
  private: '🏠',
};

const FLOOR_STYLES: Array<{ id: FloorStyle; label: string; color: string }> = [
  { id: 'wood_oak', label: 'Oak Wood', color: '#C89B6E' },
  { id: 'wood_dark', label: 'Dark Walnut', color: '#5C4033' },
  { id: 'marble_white', label: 'White Marble', color: '#ECEFF4' },
  { id: 'marble_gold', label: 'Gold Marble', color: '#F3E8D2' },
  { id: 'checkerboard', label: 'Checkerboard', color: '#CBD5E1' },
  { id: 'carpet_red', label: 'Velvet Red', color: '#991B1B' },
  { id: 'carpet_blue', label: 'Royal Blue', color: '#1E40AF' },
  { id: 'tile_pool', label: 'Pool Tile', color: '#38BDF8' },
  { id: 'neon_grid', label: 'Neon Grid', color: '#4C1D95' },
  { id: 'track_asphalt', label: 'Race Track', color: '#334155' },
  { id: 'grass', label: 'Garden Grass', color: '#22C55E' },
];

const WALL_STYLES: Array<{ id: WallStyle; label: string; color: string }> = [
  { id: 'cream_plaster', label: 'Cream Plaster', color: '#F5EFE6' },
  { id: 'royal_blue', label: 'Royal Blue', color: '#2B4C7E' },
  { id: 'warm_brick', label: 'Warm Brick', color: '#9A3412' },
  { id: 'dark_club', label: 'Dark Club', color: '#111827' },
  { id: 'marble_panel', label: 'Marble Panel', color: '#CBD5E1' },
  { id: 'pastel_mint', label: 'Pastel Mint', color: '#A7F3D0' },
  { id: 'sunset_orange', label: 'Sunset Glow', color: '#EA580C' },
  { id: 'glass_skyline', label: 'Skyline Glass', color: '#0F172A' },
  { id: 'retro_arcade', label: 'Retro Arcade', color: '#6D28D9' },
  { id: 'hotel_gold', label: 'Hotel Gold', color: '#B45309' },
];

export const NavigatorModal: React.FC = () => {
  const activeModal = useGameStore((s) => s.activeModal);
  const setActiveModal = useGameStore((s) => s.setActiveModal);
  const currentRoom = useGameStore((s) => s.currentRoom);
  const publicRooms = useGameStore((s) => s.publicRooms);
  const playerRooms = useGameStore((s) => s.playerRooms);
  const myRooms = useGameStore((s) => s.myRooms);
  const setPublicRooms = useGameStore((s) => s.setPublicRooms);
  const setPlayerRooms = useGameStore((s) => s.setPlayerRooms);
  const setMyRooms = useGameStore((s) => s.setMyRooms);
  const addNotification = useGameStore((s) => s.addNotification);

  const [tab, setTab] = useState<NavTab>('public');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [joiningId, setJoiningId] = useState<string | null>(null);

  // Create Room state
  const [roomName, setRoomName] = useState('');
  const [roomDesc, setRoomDesc] = useState('');
  const [templateId, setTemplateId] = useState<RoomTemplateId>('studio');
  const [floorStyle, setFloorStyle] = useState<FloorStyle>('wood_oak');
  const [wallStyle, setWallStyle] = useState<WallStyle>('cream_plaster');
  const [isPublic, setIsPublic] = useState(true);
  const [creating, setCreating] = useState(false);

  const fetchRooms = async () => {
    setLoading(true);
    try {
      const res = await api.listRooms();
      setPublicRooms(res.publicRooms);
      setPlayerRooms(res.playerRooms);
      setMyRooms(res.myRooms);
    } catch {
      // Keep existing store / fallback list
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (activeModal === 'navigator') {
      void fetchRooms();
    }
  }, [activeModal]);

  // Fallback to static PUBLIC_ROOMS summaries if backend list hasn't returned yet
  const effectivePublicRooms: RoomSummary[] = useMemo(() => {
    if (publicRooms.length > 0) return publicRooms;
    return PUBLIC_ROOMS.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      ownerId: r.ownerId,
      ownerUsername: r.ownerUsername,
      isPublic: true,
      templateId: r.templateId,
      theme: r.theme,
      userCount: 0,
      maxUsers: r.permissions.maxUsers,
      likes: r.likes,
      accessMode: r.permissions.accessMode,
      tags: r.tags,
    }));
  }, [publicRooms]);

  const filteredRooms = useMemo(() => {
    const source =
      tab === 'public' ? effectivePublicRooms : tab === 'player' ? playerRooms : myRooms;
    const q = search.trim().toLowerCase();
    if (!q) return source;
    return source.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q) ||
        r.ownerUsername.toLowerCase().includes(q) ||
        r.tags.some((t) => t.toLowerCase().includes(q))
    );
  }, [tab, effectivePublicRooms, playerRooms, myRooms, search]);

  if (activeModal !== 'navigator') return null;

  const handleJoinRoom = async (roomId: string) => {
    if (joiningId) return;
    audioManager.playUiClick();
    setJoiningId(roomId);
    const res = await gameSocket.joinRoom(roomId);
    setJoiningId(null);
    if (res.ok) {
      setActiveModal(null);
    }
  };

  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = roomName.trim();
    if (!trimmedName) {
      addNotification({
        type: 'warning',
        title: 'Room Name Required',
        message: 'Give your new hotel suite a catchy name!',
      });
      return;
    }

    setCreating(true);
    try {
      const tpl = ROOM_TEMPLATES[templateId];
      const floorColor = FLOOR_STYLES.find((f) => f.id === floorStyle)?.color ?? tpl.defaultFloorColor;
      const wallColor = WALL_STYLES.find((w) => w.id === wallStyle)?.color ?? tpl.defaultWallColor;
      const res = await api.createRoom({
        name: trimmedName,
        description: roomDesc.trim() || `Welcome to ${trimmedName}!`,
        templateId,
        floorStyle,
        wallStyle,
        floorColor,
        wallColor,
        isPublic: false,
        accessMode: isPublic ? 'open' : 'locked',
      });
      audioManager.playDoorChime();
      addNotification({
        type: 'success',
        title: 'Room Created!',
        message: `Moving into "${res.room.name}"...`,
      });
      setRoomName('');
      setRoomDesc('');
      await fetchRooms();
      await gameSocket.joinRoom(res.room.id);
      setActiveModal(null);
    } catch (err) {
      addNotification({
        type: 'error',
        title: 'Could Not Create Room',
        message: err instanceof Error ? err.message : 'Failed to create room.',
      });
    } finally {
      setCreating(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-label="Hotel Navigator"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(2, 6, 23, 0.62)',
        backdropFilter: 'blur(6px)',
        padding: 16,
        fontFamily: "'Fredoka', 'Nunito', 'Segoe UI', system-ui, sans-serif",
      }}
      onClick={() => setActiveModal(null)}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(860px, 96vw)',
          maxHeight: '86vh',
          display: 'flex',
          flexDirection: 'column',
          borderRadius: 20,
          background: 'linear-gradient(180deg, #0F172A 0%, #1E293B 100%)',
          border: '2px solid rgba(56, 189, 248, 0.5)',
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
            padding: '14px 18px',
            background: 'linear-gradient(90deg, #0284C7 0%, #1D4ED8 100%)',
            borderBottom: '2px solid rgba(255, 255, 255, 0.16)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Compass size={22} color="#FDE047" />
            <div>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Hotel Navigator</h2>
              <div style={{ fontSize: 12, color: '#DBEAFE' }}>
                Explore 11 public hotel spaces or visit player suites instantly
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              onClick={() => void fetchRooms()}
              title="Refresh rooms"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 34,
                height: 34,
                borderRadius: 10,
                border: '1px solid rgba(255,255,255,0.28)',
                background: 'rgba(15, 23, 42, 0.3)',
                color: '#FFFFFF',
                cursor: 'pointer',
              }}
            >
              <RefreshCw size={16} />
            </button>
            <button
              type="button"
              onClick={() => setActiveModal(null)}
              aria-label="Close Navigator"
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
        </div>

        {/* Tabs & Search */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
            padding: '12px 18px',
            borderBottom: '1px solid rgba(148, 163, 184, 0.2)',
            background: 'rgba(15, 23, 42, 0.5)',
          }}
        >
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {(
              [
                { id: 'public', label: `Public Spaces (${effectivePublicRooms.length})`, icon: <Building2 size={14} /> },
                { id: 'player', label: `Player Rooms (${playerRooms.length})`, icon: <Users size={14} /> },
                { id: 'mine', label: `My Rooms (${myRooms.length})`, icon: <Home size={14} /> },
                { id: 'create', label: 'Create Room', icon: <PlusCircle size={14} /> },
              ] as const
            ).map((t) => {
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
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '7px 12px',
                    borderRadius: 10,
                    border: active ? '1.5px solid #38BDF8' : '1px solid rgba(148, 163, 184, 0.25)',
                    background: active ? 'rgba(14, 165, 233, 0.28)' : 'rgba(30, 41, 59, 0.8)',
                    color: active ? '#FFFFFF' : '#CBD5E1',
                    fontWeight: 700,
                    fontSize: 12.5,
                    cursor: 'pointer',
                  }}
                >
                  {t.icon}
                  <span>{t.label}</span>
                </button>
              );
            })}
          </div>

          {tab !== 'create' && (
            <div style={{ position: 'relative', minWidth: 210, flex: '0 1 240px' }}>
              <Search
                size={15}
                color="#94A3B8"
                style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }}
              />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search rooms or tags..."
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  padding: '7px 10px 7px 32px',
                  borderRadius: 10,
                  border: '1px solid rgba(148, 163, 184, 0.3)',
                  background: 'rgba(15, 23, 42, 0.9)',
                  color: '#F8FAFC',
                  fontSize: 13,
                  outline: 'none',
                }}
              />
            </div>
          )}
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 18 }}>
          {tab === 'create' ? (
            <form
              onSubmit={handleCreateRoom}
              style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 13, fontWeight: 700 }}>
                  Room Name
                  <input
                    type="text"
                    value={roomName}
                    onChange={(e) => setRoomName(e.target.value)}
                    placeholder="e.g. Turbo Chill Suite"
                    maxLength={48}
                    required
                    style={{
                      padding: '9px 12px',
                      borderRadius: 10,
                      border: '1px solid rgba(148, 163, 184, 0.35)',
                      background: '#0F172A',
                      color: '#F8FAFC',
                      fontSize: 14,
                    }}
                  />
                </label>

                <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 13, fontWeight: 700 }}>
                  Description
                  <textarea
                    value={roomDesc}
                    onChange={(e) => setRoomDesc(e.target.value)}
                    placeholder="Tell guests what's happening in your room..."
                    rows={3}
                    maxLength={160}
                    style={{
                      padding: '9px 12px',
                      borderRadius: 10,
                      border: '1px solid rgba(148, 163, 184, 0.35)',
                      background: '#0F172A',
                      color: '#F8FAFC',
                      fontSize: 13,
                      resize: 'vertical',
                    }}
                  />
                </label>

                <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 13, fontWeight: 700 }}>
                  Room Template
                  <select
                    value={templateId}
                    onChange={(e) => {
                      const next = e.target.value as RoomTemplateId;
                      setTemplateId(next);
                      setFloorStyle(ROOM_TEMPLATES[next].defaultFloorStyle);
                      setWallStyle(ROOM_TEMPLATES[next].defaultWallStyle);
                    }}
                    style={{
                      padding: '9px 12px',
                      borderRadius: 10,
                      border: '1px solid rgba(148, 163, 184, 0.35)',
                      background: '#0F172A',
                      color: '#F8FAFC',
                      fontSize: 13,
                    }}
                  >
                    {Object.values(ROOM_TEMPLATES).map((tpl) => (
                      <option key={tpl.id} value={tpl.id}>
                        {tpl.name} ({tpl.width}×{tpl.height} tiles)
                      </option>
                    ))}
                  </select>
                </label>

                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={isPublic}
                    onChange={(e) => setIsPublic(e.target.checked)}
                  />
                  Open to all hotel guests (uncheck for Private)
                </label>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Floor Style</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {FLOOR_STYLES.map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setFloorStyle(f.id)}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6,
                          padding: '5px 9px',
                          borderRadius: 8,
                          border:
                            floorStyle === f.id
                              ? '2px solid #FACC15'
                              : '1px solid rgba(148, 163, 184, 0.25)',
                          background: floorStyle === f.id ? 'rgba(250, 204, 21, 0.16)' : '#0F172A',
                          color: '#F8FAFC',
                          fontSize: 11.5,
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        <span
                          style={{
                            width: 12,
                            height: 12,
                            borderRadius: 4,
                            background: f.color,
                            border: '1px solid rgba(255,255,255,0.4)',
                          }}
                        />
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Wall Style</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {WALL_STYLES.map((w) => (
                      <button
                        key={w.id}
                        type="button"
                        onClick={() => setWallStyle(w.id)}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6,
                          padding: '5px 9px',
                          borderRadius: 8,
                          border:
                            wallStyle === w.id
                              ? '2px solid #38BDF8'
                              : '1px solid rgba(148, 163, 184, 0.25)',
                          background: wallStyle === w.id ? 'rgba(56, 189, 248, 0.16)' : '#0F172A',
                          color: '#F8FAFC',
                          fontSize: 11.5,
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        <span
                          style={{
                            width: 12,
                            height: 12,
                            borderRadius: 4,
                            background: w.color,
                            border: '1px solid rgba(255,255,255,0.4)',
                          }}
                        />
                        {w.label}
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={creating}
                  style={{
                    marginTop: 'auto',
                    padding: '11px 16px',
                    borderRadius: 12,
                    border: '2px solid #4ADE80',
                    background: 'linear-gradient(135deg, #16A34A 0%, #059669 100%)',
                    color: '#FFFFFF',
                    fontWeight: 800,
                    fontSize: 14,
                    cursor: creating ? 'wait' : 'pointer',
                  }}
                >
                  {creating ? 'Building Suite...' : 'Create & Enter Room'}
                </button>
              </div>
            </form>
          ) : loading && filteredRooms.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: '#94A3B8' }}>
              Loading hotel directory...
            </div>
          ) : filteredRooms.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: '#94A3B8' }}>
              No rooms match your search. Try creating your own suite!
            </div>
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))',
                gap: 12,
              }}
            >
              {filteredRooms.map((room) => {
                const isCurrent = currentRoom?.id === room.id;
                const isJoining = joiningId === room.id;
                return (
                  <div
                    key={room.id}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                      gap: 10,
                      padding: 13,
                      borderRadius: 14,
                      background: isCurrent
                        ? 'rgba(14, 165, 233, 0.16)'
                        : 'rgba(15, 23, 42, 0.72)',
                      border: isCurrent
                        ? '2px solid #38BDF8'
                        : '1px solid rgba(148, 163, 184, 0.22)',
                    }}
                  >
                    <div>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 8,
                          marginBottom: 5,
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                          <span style={{ fontSize: 19 }}>
                            {THEME_ICON[room.theme] ?? '🏠'}
                          </span>
                          <span
                            style={{
                              fontWeight: 800,
                              fontSize: 14,
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                          >
                            {room.name}
                          </span>
                        </div>
                        {room.accessMode === 'locked' && <Lock size={14} color="#F59E0B" />}
                      </div>
                      <p
                        style={{
                          margin: '0 0 8px',
                          fontSize: 12,
                          color: '#CBD5E1',
                          lineHeight: 1.4,
                          minHeight: 34,
                        }}
                      >
                        {room.description}
                      </p>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          fontSize: 11.5,
                          color: '#94A3B8',
                        }}
                      >
                        <span>by {room.ownerUsername}</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 3,
                              color: room.userCount > 0 ? '#4ADE80' : '#94A3B8',
                              fontWeight: 700,
                            }}
                          >
                            <Users size={12} />
                            {room.userCount}/{room.maxUsers}
                          </span>
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 3,
                              color: '#FDA4AF',
                              fontWeight: 700,
                            }}
                          >
                            <Heart size={12} />
                            {room.likes}
                          </span>
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      disabled={isCurrent || Boolean(joiningId)}
                      onClick={() => void handleJoinRoom(room.id)}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 6,
                        padding: '8px 12px',
                        borderRadius: 10,
                        border: 'none',
                        background: isCurrent
                          ? 'rgba(56, 189, 248, 0.25)'
                          : 'linear-gradient(135deg, #0EA5E9 0%, #2563EB 100%)',
                        color: isCurrent ? '#BAE6FD' : '#FFFFFF',
                        fontWeight: 800,
                        fontSize: 12.5,
                        cursor: isCurrent ? 'default' : 'pointer',
                      }}
                    >
                      <DoorOpen size={14} />
                      <span>
                        {isCurrent ? 'Currently Here' : isJoining ? 'Entering...' : 'Enter Room'}
                      </span>
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default NavigatorModal;
