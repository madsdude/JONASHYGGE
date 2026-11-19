import React, { useEffect, useRef, useState } from 'react';
import { Crown, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react';
import type { PlacedFurniture, Rotation4 } from '@handihotel/shared';
import { audioManager } from '../audio/AudioManager';
import { SceneManager, type PlayerScreenPosition } from '../engine/SceneManager';
import { api } from '../network/api';
import { gameSocket } from '../network/socket';
import { useGameStore } from '../state/useGameStore';

export const GameCanvas: React.FC = () => {
  const user = useGameStore((s) => s.user);
  const currentRoom = useGameStore((s) => s.currentRoom);
  const players = useGameStore((s) => s.players);
  const chatBubbles = useGameStore((s) => s.chatBubbles);
  const activeMinigame = useGameStore((s) => s.activeMinigame);
  const editorOpen = useGameStore((s) => s.editorOpen);
  const editorTool = useGameStore((s) => s.editorTool);
  const placingCatalogItemId = useGameStore((s) => s.placingCatalogItemId);
  const placingRotation = useGameStore((s) => s.placingRotation);
  const graphicsQuality = useGameStore((s) => s.graphicsQuality);
  const isTransitioningRoom = useGameStore((s) => s.isTransitioningRoom);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<SceneManager | null>(null);
  const loadedRoomIdRef = useRef<string | null>(null);
  const hoveredTileRef = useRef<{ x: number; y: number } | null>(null);

  const [webglError, setWebglError] = useState(false);
  const [screenPositions, setScreenPositions] = useState<Record<string, PlayerScreenPosition>>({});

  // 1. Mount SceneManager & wire socket path listener + HUD screen projection loop
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let manager: SceneManager | null = null;
    try {
      manager = new SceneManager(container, {
        onTileHover: (x, y) => {
          if (x === null || y === null) {
            hoveredTileRef.current = null;
            manager?.clearGhostPreview();
            return;
          }
          hoveredTileRef.current = { x, y };
          const st = useGameStore.getState();
          if (st.editorOpen && st.editorTool === 'place' && st.placingCatalogItemId) {
            manager?.setGhostPreview(st.placingCatalogItemId, x, y, st.placingRotation);
          } else if (st.editorOpen && st.editorTool === 'move' && st.selectedFurniId) {
            const selected = st.currentRoom?.furniture.find((f) => f.id === st.selectedFurniId);
            if (selected) {
              manager?.setGhostPreview(selected.catalogItemId, x, y, st.placingRotation);
            }
          } else {
            manager?.clearGhostPreview();
          }
        },

        onTileClick: (x, y) => {
          audioManager.unlock();
          const st = useGameStore.getState();

          if (st.editorOpen && st.editorTool === 'place' && st.placingCatalogItemId) {
            const invItem =
              (st.placingInventoryItemId
                ? st.inventory.find(
                    (i) => i.id === st.placingInventoryItemId && !i.placedInRoomId
                  )
                : undefined) ??
              st.inventory.find(
                (i) => i.catalogItemId === st.placingCatalogItemId && !i.placedInRoomId
              );

            if (!invItem) {
              st.addNotification({
                type: 'warning',
                title: 'Out of Stock',
                message: 'You have no unplaced copies of this item left in your bag.',
              });
              st.setPlacingItem(null, null);
              manager?.clearGhostPreview();
              return;
            }

            void gameSocket
              .placeFurniture(invItem.id, x, y, st.placingRotation)
              .then((res) => {
                if (res.ok) {
                  void api.getInventory().then((items) => {
                    useGameStore.getState().setInventory(items);
                  });
                }
              });
            return;
          }

          if (st.editorOpen && st.editorTool === 'move' && st.selectedFurniId) {
            const furniId = st.selectedFurniId;
            void gameSocket.moveFurniture(furniId, x, y, st.placingRotation).then((res) => {
              if (res.ok) {
                useGameStore.getState().setSelectedFurniId(null);
                manager?.clearGhostPreview();
              }
            });
            return;
          }

          // Default: walk/roll avatar to clicked tile
          gameSocket.moveTo(x, y);
        },

        onFurnitureClick: (furni: PlacedFurniture) => {
          audioManager.unlock();
          const st = useGameStore.getState();

          if (st.editorOpen) {
            if (st.editorTool === 'rotate') {
              const nextRot = ((furni.rotation + 1) % 4) as Rotation4;
              void gameSocket.rotateFurniture(furni.id, nextRot);
              return;
            }
            if (st.editorTool === 'pickup') {
              void gameSocket.pickupFurniture(furni.id).then((res) => {
                if (res.ok) {
                  void api.getInventory().then((items) => {
                    useGameStore.getState().setInventory(items);
                  });
                }
              });
              return;
            }
            if (st.editorTool === 'select' || st.editorTool === 'move') {
              st.setSelectedFurniId(furni.id);
              st.setPlacingRotation(furni.rotation);
              st.setEditorTool('move');
              audioManager.playUiClick();
              return;
            }
          }

          gameSocket.interactFurniture(furni.id);
        },

        onPlayerClick: (userId: string) => {
          audioManager.playUiClick();
          useGameStore.getState().setProfileUserId(userId);
        },
      });

      sceneRef.current = manager;
      setWebglError(false);

      // Sync initial state immediately if already loaded
      const initial = useGameStore.getState();
      manager.setLocalUserId(initial.user?.id ?? null);
      manager.setGraphicsQuality(initial.graphicsQuality);
      if (initial.currentRoom) {
        manager.loadRoom(initial.currentRoom);
        loadedRoomIdRef.current = initial.currentRoom.id;
      }
      manager.syncPlayers(Object.values(initial.players));
      manager.setMinigameSession(initial.activeMinigame);
    } catch {
      setWebglError(true);
    }

    const unsubPath = gameSocket.onAvatarPath(({ userId, path }) => {
      sceneRef.current?.setPlayerPath(userId, path);
    });

    const handleCameraEvent = (evt: Event) => {
      const detail = (evt as CustomEvent<{ action: 'zoomIn' | 'zoomOut' | 'reset' }>).detail;
      if (!detail || !sceneRef.current) return;
      if (detail.action === 'zoomIn') sceneRef.current.zoomIn();
      else if (detail.action === 'zoomOut') sceneRef.current.zoomOut();
      else if (detail.action === 'reset') sceneRef.current.resetCamera();
    };
    window.addEventListener('handihotel:camera', handleCameraEvent);

    // Project 3D avatar positions to 2D screen coordinates at ~30fps for nameplates & chat bubbles
    let rafId = 0;
    let lastUpdate = 0;
    const syncOverlay = (now: number) => {
      rafId = requestAnimationFrame(syncOverlay);
      if (now - lastUpdate < 33) return;
      lastUpdate = now;
      if (sceneRef.current) {
        setScreenPositions(sceneRef.current.getPlayerScreenPositions());
      }
    };
    rafId = requestAnimationFrame(syncOverlay);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('handihotel:camera', handleCameraEvent);
      unsubPath();
      loadedRoomIdRef.current = null;
      sceneRef.current?.dispose();
      sceneRef.current = null;
    };
  }, []);

  // 2. Sync local user ID
  useEffect(() => {
    sceneRef.current?.setLocalUserId(user?.id ?? null);
  }, [user?.id]);

  // 3. Sync graphics quality
  useEffect(() => {
    sceneRef.current?.setGraphicsQuality(graphicsQuality);
  }, [graphicsQuality]);

  // 4. Sync room, appearance & furniture
  useEffect(() => {
    const manager = sceneRef.current;
    if (!manager || !currentRoom) return;

    if (loadedRoomIdRef.current !== currentRoom.id) {
      manager.loadRoom(currentRoom);
      loadedRoomIdRef.current = currentRoom.id;
    } else {
      manager.updateRoomAppearance(currentRoom);
      manager.syncFurniture(currentRoom.furniture);
    }
  }, [currentRoom]);

  // 5. Sync players
  useEffect(() => {
    sceneRef.current?.syncPlayers(Object.values(players));
  }, [players]);

  // 6. Sync minigame overlay
  useEffect(() => {
    sceneRef.current?.setMinigameSession(activeMinigame);
  }, [activeMinigame]);

  // 7. Refresh ghost preview when rotation / editor tool changes
  useEffect(() => {
    const manager = sceneRef.current;
    if (!manager) return;

    if (!editorOpen || (editorTool !== 'place' && editorTool !== 'move')) {
      manager.clearGhostPreview();
      return;
    }

    const tile = hoveredTileRef.current;
    if (!tile) return;

    if (editorTool === 'place' && placingCatalogItemId) {
      manager.setGhostPreview(placingCatalogItemId, tile.x, tile.y, placingRotation);
    }
  }, [editorOpen, editorTool, placingCatalogItemId, placingRotation]);

  // Group active chat bubbles per user so stacked bubbles rise cleanly
  const bubblesByUser: Record<string, typeof chatBubbles> = {};
  for (const b of chatBubbles) {
    if (!bubblesByUser[b.userId]) bubblesByUser[b.userId] = [];
    bubblesByUser[b.userId].push(b);
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 0,
        overflow: 'hidden',
        background: '#0F172A',
        fontFamily: "'Fredoka', 'Nunito', 'Segoe UI', system-ui, sans-serif",
      }}
    >
      {/* 3D WebGL Canvas Mount */}
      <div
        ref={containerRef}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          cursor: editorOpen ? 'crosshair' : 'pointer',
        }}
      />

      {/* WebGL Fallback Banner */}
      {webglError && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'radial-gradient(circle at center, #1E3A8A 0%, #0F172A 100%)',
            color: '#E2E8F0',
            textAlign: 'center',
            padding: 24,
          }}
        >
          <div style={{ fontSize: 48, marginBottom: 10 }}>🏨</div>
          <h2 style={{ margin: '0 0 8px', fontSize: 22, fontWeight: 800 }}>
            {currentRoom?.name ?? 'HandiHotel'}
          </h2>
          <p style={{ margin: 0, maxWidth: 420, fontSize: 14, color: '#94A3B8' }}>
            3D WebGL rendering is unavailable in this browser context, but chat, rooms, shop,
            inventory, trading, and minigames are fully active!
          </p>
        </div>
      )}

      {/* Projected 2D Nameplates & Floating Chat Bubbles */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          overflow: 'hidden',
          zIndex: 10,
        }}
      >
        {Object.values(screenPositions).map((pos) => {
          if (!pos.visible) return null;
          const userBubbles = bubblesByUser[pos.userId] ?? [];
          const isMe = pos.userId === user?.id;

          return (
            <div
              key={pos.userId}
              style={{
                position: 'absolute',
                left: pos.x,
                top: pos.y,
                transform: 'translate(-50%, -100%)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 5,
                willChange: 'transform',
              }}
            >
              {/* Floating Speech Bubbles */}
              {userBubbles.slice(-3).map((bubble) => {
                const isShout = bubble.mode === 'shout';
                const isWhisper = bubble.mode === 'whisper';
                return (
                  <div
                    key={bubble.id}
                    style={{
                      maxWidth: 230,
                      padding: '5px 10px',
                      borderRadius: 12,
                      background: isShout
                        ? '#FEF08A'
                        : isWhisper
                          ? '#F3E8FF'
                          : '#FFFFFF',
                      color: '#0F172A',
                      border: isShout
                        ? '2px solid #CA8A04'
                        : isWhisper
                          ? '2px solid #9333EA'
                          : '2px solid #0F172A',
                      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.35)',
                      fontSize: 12.5,
                      fontWeight: isShout ? 800 : 600,
                      fontStyle: isWhisper ? 'italic' : 'normal',
                      lineHeight: 1.3,
                      wordBreak: 'break-word',
                      textAlign: 'center',
                    }}
                  >
                    <span style={{ fontWeight: 800, marginRight: 4, color: '#1D4ED8' }}>
                      {bubble.username}:
                    </span>
                    <span>{bubble.text}</span>
                  </div>
                );
              })}

              {/* Crisp Player Nameplate */}
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '2px 8px',
                  borderRadius: 999,
                  background: isMe
                    ? 'rgba(14, 165, 233, 0.88)'
                    : 'rgba(15, 23, 42, 0.82)',
                  border: pos.isAdmin
                    ? '1.5px solid #FACC15'
                    : '1px solid rgba(255, 255, 255, 0.28)',
                  color: '#FFFFFF',
                  fontSize: 11.5,
                  fontWeight: 700,
                  whiteSpace: 'nowrap',
                  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.45)',
                }}
              >
                {pos.isAdmin && <Crown size={11} color="#FDE047" />}
                <span>{pos.username}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Subtle Floating Camera Controls (Bottom-Left above Dock) */}
      <div
        style={{
          position: 'fixed',
          left: 14,
          bottom: 84,
          zIndex: 30,
          display: 'flex',
          flexDirection: 'column',
          gap: 5,
          pointerEvents: 'auto',
        }}
      >
        <button
          type="button"
          onClick={() => sceneRef.current?.zoomIn()}
          title="Zoom In"
          style={{
            width: 34,
            height: 34,
            borderRadius: 10,
            border: '1px solid rgba(148, 163, 184, 0.3)',
            background: 'rgba(15, 23, 42, 0.82)',
            color: '#E2E8F0',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
          }}
        >
          <ZoomIn size={16} />
        </button>
        <button
          type="button"
          onClick={() => sceneRef.current?.zoomOut()}
          title="Zoom Out"
          style={{
            width: 34,
            height: 34,
            borderRadius: 10,
            border: '1px solid rgba(148, 163, 184, 0.3)',
            background: 'rgba(15, 23, 42, 0.82)',
            color: '#E2E8F0',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
          }}
        >
          <ZoomOut size={16} />
        </button>
        <button
          type="button"
          onClick={() => sceneRef.current?.resetCamera()}
          title="Reset Camera"
          style={{
            width: 34,
            height: 34,
            borderRadius: 10,
            border: '1px solid rgba(148, 163, 184, 0.3)',
            background: 'rgba(15, 23, 42, 0.82)',
            color: '#E2E8F0',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
          }}
        >
          <RotateCcw size={15} />
        </button>
      </div>

      {/* Smooth Room Transition Fade Overlay */}
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 55,
          pointerEvents: isTransitioningRoom ? 'auto' : 'none',
          background: 'rgba(2, 6, 23, 0.86)',
          opacity: isTransitioningRoom ? 1 : 0,
          transition: 'opacity 260ms ease',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#BAE6FD',
          fontSize: 18,
          fontWeight: 800,
          letterSpacing: 0.5,
        }}
      >
        {isTransitioningRoom && <span>Entering Room...</span>}
      </div>
    </div>
  );
};

export default GameCanvas;
