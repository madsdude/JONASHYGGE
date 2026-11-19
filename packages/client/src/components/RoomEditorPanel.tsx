import React, { useEffect, useMemo, useState } from 'react';
import {
  getCatalogItem,
  type CatalogItem,
  type FloorStyle,
  type InventoryItem,
  type RoomAccessMode,
  type WallStyle,
} from '@handihotel/shared';
import {
  Check,
  Hammer,
  Hand,
  MousePointer2,
  Paintbrush,
  PlusSquare,
  RotateCw,
  Save,
  Settings2,
  Trash2,
  X,
} from 'lucide-react';
import { audioManager } from '../audio/AudioManager';
import { gameSocket } from '../network/socket';
import { useGameStore, type EditorTool } from '../state/useGameStore';

type EditorTab = 'build' | 'styles' | 'settings';

const FLOOR_STYLES: { id: FloorStyle; label: string; color: string }[] = [
  { id: 'wood_oak', label: 'Oak Wood', color: '#C89B6E' },
  { id: 'wood_dark', label: 'Dark Walnut', color: '#5C4033' },
  { id: 'marble_white', label: 'White Marble', color: '#ECEFF4' },
  { id: 'marble_gold', label: 'Gold Marble', color: '#F3E8D2' },
  { id: 'checkerboard', label: 'Checkerboard', color: '#CBD5E1' },
  { id: 'carpet_red', label: 'Velvet Red', color: '#991B1B' },
  { id: 'carpet_blue', label: 'Royal Blue', color: '#1E3A8A' },
  { id: 'tile_pool', label: 'Pool Tile', color: '#38BDF8' },
  { id: 'neon_grid', label: 'Neon Grid', color: '#111827' },
  { id: 'track_asphalt', label: 'Race Track', color: '#334155' },
  { id: 'concrete', label: 'Concrete', color: '#64748B' },
  { id: 'grass', label: 'Garden Grass', color: '#22C55E' },
];

const WALL_STYLES: { id: WallStyle; label: string; color: string }[] = [
  { id: 'cream_plaster', label: 'Cream Plaster', color: '#F5EFE6' },
  { id: 'royal_blue', label: 'Royal Blue', color: '#2B4C7E' },
  { id: 'warm_brick', label: 'Warm Brick', color: '#9A3412' },
  { id: 'dark_club', label: 'Nightclub', color: '#090D16' },
  { id: 'marble_panel', label: 'Marble Panel', color: '#E2E8F0' },
  { id: 'pastel_mint', label: 'Pastel Mint', color: '#A7F3D0' },
  { id: 'sunset_orange', label: 'Sunset Arena', color: '#EA580C' },
  { id: 'glass_skyline', label: 'Skyline Glass', color: '#1E293B' },
  { id: 'retro_arcade', label: 'Retro Arcade', color: '#4C1D95' },
  { id: 'hotel_gold', label: 'Hotel Gold', color: '#B45309' },
];

const VISITOR_BUILD_TAG = 'allow_visitor_build';

export function RoomEditorPanel() {
  const editorOpen = useGameStore((s) => s.editorOpen);
  const setEditorOpen = useGameStore((s) => s.setEditorOpen);
  const editorTool = useGameStore((s) => s.editorTool);
  const setEditorTool = useGameStore((s) => s.setEditorTool);
  const placingCatalogItemId = useGameStore((s) => s.placingCatalogItemId);
  const placingRotation = useGameStore((s) => s.placingRotation);
  const setPlacingItem = useGameStore((s) => s.setPlacingItem);
  const rotatePlacing = useGameStore((s) => s.rotatePlacing);
  const selectedFurniId = useGameStore((s) => s.selectedFurniId);
  const setSelectedFurniId = useGameStore((s) => s.setSelectedFurniId);
  const currentRoom = useGameStore((s) => s.currentRoom);
  const user = useGameStore((s) => s.user);
  const inventory = useGameStore((s) => s.inventory);
  const catalog = useGameStore((s) => s.catalog);
  const addNotification = useGameStore((s) => s.addNotification);

  const [tab, setTab] = useState<EditorTab>('build');
  const [roomName, setRoomName] = useState('');
  const [roomDescription, setRoomDescription] = useState('');
  const [accessMode, setAccessMode] = useState<RoomAccessMode>('open');
  const [allowVisitorBuild, setAllowVisitorBuild] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);

  useEffect(() => {
    if (!currentRoom) return;
    setRoomName(currentRoom.name);
    setRoomDescription(currentRoom.description);
    setAccessMode(currentRoom.permissions.accessMode);
    setAllowVisitorBuild(currentRoom.tags.includes(VISITOR_BUILD_TAG));
  }, [currentRoom]);

  // 'R' shortcut to rotate placing item or selected furniture
  useEffect(() => {
    if (!editorOpen) return;
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
      if (e.key.toLowerCase() === 'r') {
        e.preventDefault();
        if (selectedFurniId) {
          gameSocket.rotateFurniture(selectedFurniId);
          audioManager.playFurnitureRotate();
        } else {
          rotatePlacing();
          audioManager.playFurnitureRotate();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [editorOpen, rotatePlacing, selectedFurniId]);

  const catalogById = useMemo(() => {
    const map = new Map<string, CatalogItem>();
    for (const c of catalog) map.set(c.id, c);
    return map;
  }, [catalog]);

  const quickFurniture = useMemo(() => {
    const groups = new Map<string, { catalogItem: CatalogItem; items: InventoryItem[] }>();
    for (const inv of inventory) {
      if (inv.placedInRoomId) continue;
      const cat = catalogById.get(inv.catalogItemId) ?? getCatalogItem(inv.catalogItemId);
      if (!cat || cat.category === 'cosmetic') continue;
      const existing = groups.get(cat.id);
      if (existing) {
        existing.items.push(inv);
      } else {
        groups.set(cat.id, { catalogItem: cat, items: [inv] });
      }
    }
    return Array.from(groups.values());
  }, [inventory, catalogById]);

  if (!editorOpen || !currentRoom) return null;

  const isOwnerOrAdmin =
    Boolean(user) &&
    (currentRoom.ownerId === user?.id ||
      user?.role === 'admin' ||
      user?.role === 'moderator');

  const canBuild = isOwnerOrAdmin || currentRoom.tags.includes(VISITOR_BUILD_TAG);

  const handleRotateAction = () => {
    setEditorTool('rotate');
    if (selectedFurniId) {
      gameSocket.rotateFurniture(selectedFurniId);
    } else {
      rotatePlacing();
    }
    audioManager.playFurnitureRotate();
  };

  const handlePickupSelected = async () => {
    if (!selectedFurniId) return;
    const res = await gameSocket.pickupFurniture(selectedFurniId);
    if (res.ok) {
      setSelectedFurniId(null);
    } else if (res.error) {
      addNotification({
        type: 'warning',
        title: 'Pickup Failed',
        message: res.error,
      });
    }
  };

  const handleApplyFloor = async (style: FloorStyle, color: string) => {
    const res = await gameSocket.updateRoomSettings(currentRoom.id, {
      floorStyle: style,
      floorColor: color,
    });
    if (!res.ok && res.error) {
      addNotification({ type: 'error', title: 'Style Update Failed', message: res.error });
    }
  };

  const handleApplyWall = async (style: WallStyle, color: string) => {
    const res = await gameSocket.updateRoomSettings(currentRoom.id, {
      wallStyle: style,
      wallColor: color,
    });
    if (!res.ok && res.error) {
      addNotification({ type: 'error', title: 'Style Update Failed', message: res.error });
    }
  };

  const handleSaveRoomSettings = async () => {
    if (savingSettings) return;
    setSavingSettings(true);
    try {
      const nextTags = allowVisitorBuild
        ? Array.from(new Set([...currentRoom.tags, VISITOR_BUILD_TAG]))
        : currentRoom.tags.filter((t) => t !== VISITOR_BUILD_TAG);

      const res = await gameSocket.updateRoomSettings(currentRoom.id, {
        name: roomName.trim() || currentRoom.name,
        description: roomDescription.trim(),
        permissions: {
          accessMode,
        },
        tags: nextTags,
      });
      if (res.ok) {
        addNotification({
          type: 'success',
          title: 'Room Settings Saved',
          message: 'Your room configuration has been updated.',
        });
      } else {
        addNotification({
          type: 'error',
          title: 'Could Not Save Settings',
          message: res.error || 'Only the room owner can change settings.',
        });
      }
    } finally {
      setSavingSettings(false);
    }
  };

  const tools: { id: EditorTool; label: string; hint?: string; icon: React.ReactNode }[] = [
    { id: 'select', label: 'Select / Move', icon: <MousePointer2 size={15} /> },
    { id: 'place', label: 'Place', icon: <PlusSquare size={15} /> },
    { id: 'rotate', label: 'Rotate 90°', hint: 'R', icon: <RotateCw size={15} /> },
    { id: 'pickup', label: 'Pick Up', icon: <Hand size={15} /> },
  ];

  return (
    <div
      style={{
        position: 'fixed',
        top: 76,
        right: 16,
        zIndex: 45,
        width: 330,
        maxHeight: 'calc(100vh - 165px)',
        background: 'linear-gradient(165deg, rgba(15, 23, 42, 0.96), rgba(30, 41, 59, 0.95))',
        border: '1px solid rgba(251, 191, 36, 0.35)',
        borderRadius: 16,
        boxShadow: '0 16px 42px rgba(0, 0, 0, 0.55)',
        backdropFilter: 'blur(10px)',
        color: '#f8fafc',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      {/* Panel Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '11px 14px',
          borderBottom: '1px solid rgba(148, 163, 184, 0.16)',
          background: 'rgba(15, 23, 42, 0.75)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Hammer size={17} color="#fbbf24" />
          <span style={{ fontWeight: 800, fontSize: 14 }}>Room Builder</span>
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              padding: '2px 7px',
              borderRadius: 999,
              background: 'rgba(251, 191, 36, 0.16)',
              color: '#fde68a',
            }}
          >
            {placingRotation * 90}°
          </span>
        </div>
        <button
          onClick={() => setEditorOpen(false)}
          aria-label="Close Room Builder"
          style={{
            background: 'rgba(148, 163, 184, 0.12)',
            border: '1px solid rgba(148, 163, 184, 0.25)',
            color: '#e2e8f0',
            width: 28,
            height: 28,
            borderRadius: 8,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <X size={15} />
        </button>
      </div>

      {!canBuild && (
        <div
          style={{
            padding: '7px 12px',
            fontSize: 11,
            color: '#fcd34d',
            background: 'rgba(245, 158, 11, 0.14)',
            borderBottom: '1px solid rgba(245, 158, 11, 0.25)',
          }}
        >
          You are visiting this room. Only the owner (or rooms with Visitor Build enabled) can edit.
        </div>
      )}

      {/* Sub-tabs */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 4,
          padding: '8px 10px',
          borderBottom: '1px solid rgba(148, 163, 184, 0.12)',
        }}
      >
        {(
          [
            { id: 'build', label: 'Build', icon: <Hammer size={13} /> },
            { id: 'styles', label: 'Styles', icon: <Paintbrush size={13} /> },
            { id: 'settings', label: 'Room', icon: <Settings2 size={13} /> },
          ] as const
        ).map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 5,
                padding: '6px 8px',
                borderRadius: 8,
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer',
                border: active
                  ? '1px solid rgba(251, 191, 36, 0.6)'
                  : '1px solid rgba(148, 163, 184, 0.16)',
                background: active ? 'rgba(251, 191, 36, 0.18)' : 'rgba(15, 23, 42, 0.45)',
                color: active ? '#fde68a' : '#94a3b8',
              }}
            >
              {t.icon}
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {tab === 'build' && (
          <>
            {/* Tool Grid */}
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', marginBottom: 6, textTransform: 'uppercase' }}>
                Builder Tools
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                {tools.map((tool) => {
                  const active =
                    editorTool === tool.id ||
                    (tool.id === 'select' && editorTool === 'move');
                  return (
                    <button
                      key={tool.id}
                      onClick={() => {
                        if (tool.id === 'rotate') {
                          handleRotateAction();
                        } else {
                          setEditorTool(tool.id);
                        }
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '8px 10px',
                        borderRadius: 10,
                        cursor: 'pointer',
                        fontSize: 12,
                        fontWeight: 700,
                        border: active
                          ? '1px solid rgba(56, 189, 248, 0.75)'
                          : '1px solid rgba(148, 163, 184, 0.2)',
                        background: active
                          ? 'rgba(56, 189, 248, 0.2)'
                          : 'rgba(15, 23, 42, 0.6)',
                        color: active ? '#7dd3fc' : '#e2e8f0',
                      }}
                    >
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        {tool.icon}
                        {tool.label}
                      </span>
                      {tool.hint && (
                        <kbd
                          style={{
                            fontSize: 10,
                            padding: '1px 5px',
                            borderRadius: 4,
                            background: 'rgba(15, 23, 42, 0.85)',
                            border: '1px solid rgba(148, 163, 184, 0.35)',
                            color: '#cbd5e1',
                          }}
                        >
                          {tool.hint}
                        </kbd>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Selected Furniture Quick Actions */}
            {selectedFurniId && (
              <div
                style={{
                  padding: 10,
                  borderRadius: 10,
                  background: 'rgba(56, 189, 248, 0.12)',
                  border: '1px solid rgba(56, 189, 248, 0.35)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                }}
              >
                <span style={{ fontSize: 12, fontWeight: 700, color: '#7dd3fc' }}>
                  Item Selected
                </span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    onClick={() => {
                      gameSocket.rotateFurniture(selectedFurniId);
                      audioManager.playFurnitureRotate();
                    }}
                    style={{
                      padding: '5px 8px',
                      borderRadius: 7,
                      border: '1px solid rgba(56, 189, 248, 0.45)',
                      background: 'rgba(15, 23, 42, 0.7)',
                      color: '#7dd3fc',
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    <RotateCw size={12} /> Rotate
                  </button>
                  <button
                    onClick={handlePickupSelected}
                    style={{
                      padding: '5px 8px',
                      borderRadius: 7,
                      border: '1px solid rgba(248, 113, 113, 0.45)',
                      background: 'rgba(127, 29, 29, 0.4)',
                      color: '#fca5a5',
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    <Trash2 size={12} /> Pick Up
                  </button>
                </div>
              </div>
            )}

            {/* Quick Furniture Strip */}
            <div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 6,
                }}
              >
                <span style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' }}>
                  Quick Inventory ({quickFurniture.length})
                </span>
                {placingCatalogItemId && (
                  <button
                    onClick={() => setPlacingItem(null, null)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: '#f87171',
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    Clear Placing
                  </button>
                )}
              </div>

              {quickFurniture.length === 0 ? (
                <div
                  style={{
                    padding: 16,
                    borderRadius: 10,
                    background: 'rgba(15, 23, 42, 0.5)',
                    border: '1px dashed rgba(148, 163, 184, 0.25)',
                    textAlign: 'center',
                    fontSize: 12,
                    color: '#94a3b8',
                  }}
                >
                  No unplaced furniture in inventory. Buy items in the Shop!
                </div>
              ) : (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, 1fr)',
                    gap: 6,
                    maxHeight: 230,
                    overflowY: 'auto',
                  }}
                >
                  {quickFurniture.map(({ catalogItem, items }) => {
                    const active = placingCatalogItemId === catalogItem.id;
                    return (
                      <button
                        key={catalogItem.id}
                        onClick={() => {
                          setPlacingItem(catalogItem.id, items[0].id);
                          audioManager.playFurnitureRotate();
                        }}
                        title={catalogItem.name}
                        style={{
                          padding: 7,
                          borderRadius: 10,
                          cursor: 'pointer',
                          background: active
                            ? 'rgba(251, 191, 36, 0.22)'
                            : 'rgba(15, 23, 42, 0.65)',
                          border: active
                            ? '1px solid rgba(251, 191, 36, 0.8)'
                            : '1px solid rgba(148, 163, 184, 0.2)',
                          color: '#f8fafc',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 5,
                          position: 'relative',
                        }}
                      >
                        <div
                          style={{
                            height: 36,
                            borderRadius: 7,
                            background: `linear-gradient(135deg, ${catalogItem.primaryColor}, ${catalogItem.accentColor})`,
                          }}
                        />
                        <span
                          style={{
                            position: 'absolute',
                            top: 4,
                            right: 4,
                            fontSize: 10,
                            fontWeight: 800,
                            padding: '1px 5px',
                            borderRadius: 999,
                            background: 'rgba(15, 23, 42, 0.9)',
                            color: '#fde68a',
                          }}
                        >
                          ×{items.length}
                        </span>
                        <div
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {catalogItem.name}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}

        {tab === 'styles' && (
          <>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', marginBottom: 6, textTransform: 'uppercase' }}>
                Floor Style
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                {FLOOR_STYLES.map((f) => {
                  const active = currentRoom.floorStyle === f.id;
                  return (
                    <button
                      key={f.id}
                      onClick={() => handleApplyFloor(f.id, f.color)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '7px 9px',
                        borderRadius: 9,
                        cursor: 'pointer',
                        background: active ? 'rgba(56, 189, 248, 0.18)' : 'rgba(15, 23, 42, 0.6)',
                        border: active
                          ? '1px solid rgba(56, 189, 248, 0.75)'
                          : '1px solid rgba(148, 163, 184, 0.2)',
                        color: '#e2e8f0',
                        fontSize: 11,
                        fontWeight: 700,
                      }}
                    >
                      <span
                        style={{
                          width: 16,
                          height: 16,
                          borderRadius: 5,
                          background: f.color,
                          border: '1px solid rgba(255,255,255,0.35)',
                          flexShrink: 0,
                        }}
                      />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {f.label}
                      </span>
                      {active && <Check size={12} style={{ marginLeft: 'auto', color: '#38bdf8' }} />}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', marginBottom: 6, textTransform: 'uppercase' }}>
                Wall Style
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                {WALL_STYLES.map((w) => {
                  const active = currentRoom.wallStyle === w.id;
                  return (
                    <button
                      key={w.id}
                      onClick={() => handleApplyWall(w.id, w.color)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '7px 9px',
                        borderRadius: 9,
                        cursor: 'pointer',
                        background: active ? 'rgba(251, 191, 36, 0.18)' : 'rgba(15, 23, 42, 0.6)',
                        border: active
                          ? '1px solid rgba(251, 191, 36, 0.75)'
                          : '1px solid rgba(148, 163, 184, 0.2)',
                        color: '#e2e8f0',
                        fontSize: 11,
                        fontWeight: 700,
                      }}
                    >
                      <span
                        style={{
                          width: 16,
                          height: 16,
                          borderRadius: 5,
                          background: w.color,
                          border: '1px solid rgba(255,255,255,0.35)',
                          flexShrink: 0,
                        }}
                      />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {w.label}
                      </span>
                      {active && <Check size={12} style={{ marginLeft: 'auto', color: '#fbbf24' }} />}
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        )}

        {tab === 'settings' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#94a3b8', marginBottom: 4 }}>
                Room Name
              </label>
              <input
                type="text"
                value={roomName}
                onChange={(e) => setRoomName(e.target.value)}
                maxLength={48}
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  padding: '8px 10px',
                  borderRadius: 9,
                  border: '1px solid rgba(148, 163, 184, 0.28)',
                  background: 'rgba(15, 23, 42, 0.75)',
                  color: '#f8fafc',
                  fontSize: 13,
                  outline: 'none',
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#94a3b8', marginBottom: 4 }}>
                Description
              </label>
              <textarea
                value={roomDescription}
                onChange={(e) => setRoomDescription(e.target.value)}
                rows={3}
                maxLength={180}
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  padding: '8px 10px',
                  borderRadius: 9,
                  border: '1px solid rgba(148, 163, 184, 0.28)',
                  background: 'rgba(15, 23, 42, 0.75)',
                  color: '#f8fafc',
                  fontSize: 12,
                  resize: 'vertical',
                  outline: 'none',
                  fontFamily: 'inherit',
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#94a3b8', marginBottom: 5 }}>
                Access Mode
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
                {(
                  [
                    { id: 'open', label: 'Public' },
                    { id: 'locked', label: 'Private' },
                    { id: 'friends_only', label: 'Friends' },
                  ] as const
                ).map((mode) => {
                  const active = accessMode === mode.id;
                  return (
                    <button
                      key={mode.id}
                      onClick={() => setAccessMode(mode.id)}
                      style={{
                        padding: '7px 6px',
                        borderRadius: 8,
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: 'pointer',
                        border: active
                          ? '1px solid rgba(56, 189, 248, 0.75)'
                          : '1px solid rgba(148, 163, 184, 0.2)',
                        background: active ? 'rgba(56, 189, 248, 0.2)' : 'rgba(15, 23, 42, 0.55)',
                        color: active ? '#7dd3fc' : '#cbd5e1',
                      }}
                    >
                      {mode.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '9px 11px',
                borderRadius: 10,
                background: 'rgba(15, 23, 42, 0.6)',
                border: '1px solid rgba(148, 163, 184, 0.2)',
                cursor: 'pointer',
              }}
            >
              <div>
                <div style={{ fontSize: 12, fontWeight: 700 }}>Allow Visitor Build</div>
                <div style={{ fontSize: 10, color: '#94a3b8' }}>Let guests move &amp; place furniture</div>
              </div>
              <input
                type="checkbox"
                checked={allowVisitorBuild}
                onChange={(e) => setAllowVisitorBuild(e.target.checked)}
                style={{ width: 17, height: 17, accentColor: '#fbbf24', cursor: 'pointer' }}
              />
            </label>

            <button
              disabled={savingSettings}
              onClick={handleSaveRoomSettings}
              style={{
                width: '100%',
                padding: '10px 14px',
                borderRadius: 10,
                border: 'none',
                background: 'linear-gradient(135deg, #f59e0b, #d97706)',
                color: '#0f172a',
                fontWeight: 800,
                fontSize: 13,
                cursor: savingSettings ? 'wait' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 7,
              }}
            >
              <Save size={15} />
              {savingSettings ? 'Saving...' : 'Save Room Settings'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default RoomEditorPanel;
