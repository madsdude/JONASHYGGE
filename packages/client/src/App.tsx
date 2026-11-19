import React, { useEffect } from 'react';
import { audioManager } from './audio/AudioManager';
import { api } from './network/api';
import { gameSocket } from './network/socket';
import { useGameStore } from './state/useGameStore';

import AuthScreen from './components/AuthScreen';
import GameCanvas from './components/GameCanvas';
import TopBar from './components/TopBar';
import BottomDock from './components/BottomDock';
import NavigatorModal from './components/NavigatorModal';
import AvatarEditorModal from './components/AvatarEditorModal';
import ShopModal from './components/ShopModal';
import InventoryModal from './components/InventoryModal';
import RoomEditorPanel from './components/RoomEditorPanel';
import SocialModal from './components/SocialModal';
import TradeModal from './components/TradeModal';
import MinigameModal from './components/MinigameModal';
import ProfileModal from './components/ProfileModal';
import SettingsModal from './components/SettingsModal';
import NotificationsToast from './components/NotificationsToast';

export function App(): React.ReactElement {
  const token = useGameStore((s) => s.token);
  const user = useGameStore((s) => s.user);
  const isAuthenticated = useGameStore((s) => s.isAuthenticated);
  const authLoading = useGameStore((s) => s.authLoading);
  const activeModal = useGameStore((s) => s.activeModal);
  const editorOpen = useGameStore((s) => s.editorOpen);
  const activeTrade = useGameStore((s) => s.activeTrade);
  const profileUserId = useGameStore((s) => s.profileUserId);

  // 1. Rehydrate existing JWT token on initial mount
  useEffect(() => {
    const storedToken = useGameStore.getState().token;
    if (!storedToken) {
      useGameStore.getState().setAuthLoading(false);
      return;
    }

    let cancelled = false;
    useGameStore.getState().setAuthLoading(true);

    api
      .me()
      .then(({ user: meUser }) => {
        if (cancelled) return;
        useGameStore.getState().setAuth(storedToken, meUser);
      })
      .catch(() => {
        if (cancelled) return;
        useGameStore.getState().logout();
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // 2. Connect socket, bootstrap initial hotel data, and join Main Lobby once authenticated
  useEffect(() => {
    if (!isAuthenticated || !token || !user) {
      gameSocket.disconnect();
      audioManager.stopAmbience();
      return;
    }

    gameSocket.connect(token);

    let cancelled = false;

    const bootstrap = async (): Promise<void> => {
      const store = useGameStore.getState();

      await Promise.allSettled([
        api.listRooms().then((rooms) => {
          if (cancelled) return;
          store.setPublicRooms(rooms.publicRooms);
          store.setMyRooms(rooms.myRooms);
          store.setPlayerRooms(rooms.playerRooms);
        }),
        api.getCatalog().then((items) => {
          if (!cancelled) store.setCatalog(items);
        }),
        api.getInventory().then((items) => {
          if (!cancelled) store.setInventory(items);
        }),
        api.getDailyReward().then((status) => {
          if (!cancelled) store.setDailyReward(status);
        }),
        api.getFriends().then((friends) => {
          if (!cancelled) store.setFriends(friends);
        }),
        api.getFriendRequests().then((reqs) => {
          if (!cancelled) store.setFriendRequests(reqs);
        }),
        api.getBlockedUsers().then((ids) => {
          if (!cancelled) store.setBlockedIds(ids);
        }),
        api.getEvents().then((events) => {
          if (!cancelled) store.setHotelEvents(events);
        }),
      ]);

      if (!cancelled && !useGameStore.getState().currentRoom) {
        const publicRooms = useGameStore.getState().publicRooms;
        const lobbyId =
          publicRooms.find((r) => r.id === 'public-lobby')?.id ??
          publicRooms[0]?.id ??
          'public-lobby';
        gameSocket.joinRoom(lobbyId);
      }
    };

    void bootstrap();

    const bubbleTimer = window.setInterval(() => {
      useGameStore.getState().clearExpiredBubbles();
    }, 1000);

    return () => {
      cancelled = true;
      window.clearInterval(bubbleTimer);
      gameSocket.disconnect();
      audioManager.stopAmbience();
    };
  }, [isAuthenticated, token, user?.id]);

  // 3. Global keyboard shortcuts (Escape to close modals, R to rotate furniture in builder)
  useEffect(() => {
    if (!isAuthenticated) return;

    const handleKeyDown = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      const isTyping =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      if (e.key === 'Escape') {
        const state = useGameStore.getState();
        if (state.profileUserId) {
          state.setProfileUserId(null);
        } else if (state.activeModal) {
          state.setActiveModal(null);
        } else if (state.editorOpen) {
          state.setEditorOpen(false);
        }
        return;
      }

      if (!isTyping && (e.key === 'r' || e.key === 'R')) {
        const state = useGameStore.getState();
        if (state.editorOpen) {
          state.rotatePlacing();
          audioManager.playFurnitureRotate();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isAuthenticated]);

  if (authLoading) {
    return (
      <div className="hh-splash">
        <div className="hh-spinner" />
        <div style={{ fontSize: 22, fontWeight: 800, color: '#f5b82e', letterSpacing: '0.04em' }}>
          HandiHotel
        </div>
        <div style={{ fontSize: 13, color: '#cbd5e1' }}>Checking your hotel keycard...</div>
      </div>
    );
  }

  if (!isAuthenticated || !user) {
    return (
      <>
        <AuthScreen />
        <NotificationsToast />
      </>
    );
  }

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
      }}
    >
      {/* Full-viewport 3D Isometric World */}
      <GameCanvas />

      {/* Top HUD Bar & Classic Bottom Dock */}
      <TopBar />
      <BottomDock />

      {/* Room Builder Floating Panel */}
      {editorOpen && <RoomEditorPanel />}

      {/* Feature Modals */}
      {activeModal === 'navigator' && <NavigatorModal />}
      {activeModal === 'avatar' && <AvatarEditorModal />}
      {activeModal === 'shop' && <ShopModal />}
      {activeModal === 'inventory' && <InventoryModal />}
      {activeModal === 'social' && <SocialModal />}
      {activeModal === 'settings' && <SettingsModal />}

      {/* Minigames Hub Modal + Active In-Game Minigame HUD */}
      <MinigameModal />

      {/* Player Trade & Profile Modals */}
      {activeTrade && <TradeModal />}
      {profileUserId && <ProfileModal />}

      {/* Stacking Notifications, Invites, Trade & Friend Banners */}
      <NotificationsToast />
    </div>
  );
}

export default App;
