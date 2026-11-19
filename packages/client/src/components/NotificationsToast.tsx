import React, { useEffect } from 'react';
import {
  AlertTriangle,
  ArrowLeftRight,
  Bell,
  Check,
  CheckCircle2,
  DoorOpen,
  Info,
  UserPlus,
  X,
  XCircle,
} from 'lucide-react';
import { audioManager } from '../audio/AudioManager';
import { api } from '../network/api';
import { gameSocket } from '../network/socket';
import { useGameStore } from '../state/useGameStore';

const TOAST_TTL_MS = 5500;

export const NotificationsToast: React.FC = () => {
  const notifications = useGameStore((s) => s.notifications);
  const dismissNotification = useGameStore((s) => s.dismissNotification);
  const pendingInvites = useGameStore((s) => s.pendingInvites);
  const removePendingInvite = useGameStore((s) => s.removePendingInvite);
  const incomingTradeRequest = useGameStore((s) => s.incomingTradeRequest);
  const friendRequests = useGameStore((s) => s.friendRequests);
  const removeFriendRequest = useGameStore((s) => s.removeFriendRequest);
  const setFriends = useGameStore((s) => s.setFriends);
  const addNotification = useGameStore((s) => s.addNotification);

  // Auto-dismiss standard toast notifications after TTL
  useEffect(() => {
    if (notifications.length === 0) return;
    const timer = window.setInterval(() => {
      const now = Date.now();
      for (const n of useGameStore.getState().notifications) {
        if (now - n.createdAt >= TOAST_TTL_MS) {
          dismissNotification(n.id);
        }
      }
    }, 800);
    return () => window.clearInterval(timer);
  }, [notifications.length, dismissNotification]);

  const handleAcceptInvite = async (inviteId: string, roomId: string) => {
    audioManager.playUiClick();
    removePendingInvite(inviteId);
    await gameSocket.joinRoom(roomId);
  };

  const handleDeclineInvite = (inviteId: string) => {
    audioManager.playUiClick();
    removePendingInvite(inviteId);
  };

  const handleRespondTrade = (tradeId: string, accept: boolean) => {
    audioManager.playUiClick();
    gameSocket.respondTrade(tradeId, accept);
  };

  const handleRespondFriendRequest = async (requestId: string, fromUsername: string, accept: boolean) => {
    audioManager.playUiClick();
    try {
      await api.respondFriendRequest(requestId, accept);
      removeFriendRequest(requestId);
      if (accept) {
        const updatedFriends = await api.getFriends();
        setFriends(updatedFriends);
        addNotification({
          type: 'success',
          title: 'New Friend!',
          message: `You and ${fromUsername} are now friends.`,
        });
      }
    } catch (err) {
      addNotification({
        type: 'error',
        title: 'Friend Request Failed',
        message: err instanceof Error ? err.message : 'Could not respond to friend request.',
      });
    }
  };

  const pendingFriendRequests = friendRequests.filter((r) => r.status === 'pending').slice(0, 2);

  if (
    notifications.length === 0 &&
    pendingInvites.length === 0 &&
    !incomingTradeRequest &&
    pendingFriendRequests.length === 0
  ) {
    return null;
  }

  return (
    <div
      style={{
        position: 'fixed',
        top: 70,
        right: 14,
        zIndex: 70,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        width: 330,
        maxWidth: 'calc(100vw - 28px)',
        pointerEvents: 'none',
        fontFamily: "'Fredoka', 'Nunito', 'Segoe UI', system-ui, sans-serif",
      }}
    >
      {/* Incoming Trade Request Banner */}
      {incomingTradeRequest && (
        <div
          style={{
            pointerEvents: 'auto',
            padding: '12px 14px',
            borderRadius: 14,
            background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.96), rgba(30, 58, 138, 0.95))',
            border: '2px solid #FACC15',
            boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
            color: '#F8FAFC',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <ArrowLeftRight size={17} color="#FACC15" />
            <span style={{ fontWeight: 800, fontSize: 13, color: '#FEF08A' }}>
              Incoming Trade Request
            </span>
          </div>
          <p style={{ margin: '0 0 10px', fontSize: 13, color: '#E2E8F0' }}>
            <strong>{incomingTradeRequest.fromUsername}</strong> wants to trade items & credits with you!
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={() => handleRespondTrade(incomingTradeRequest.tradeId, true)}
              style={{
                flex: 1,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 5,
                padding: '7px 10px',
                borderRadius: 9,
                border: 'none',
                background: '#16A34A',
                color: '#FFFFFF',
                fontWeight: 700,
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              <Check size={14} /> Accept
            </button>
            <button
              type="button"
              onClick={() => handleRespondTrade(incomingTradeRequest.tradeId, false)}
              style={{
                flex: 1,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 5,
                padding: '7px 10px',
                borderRadius: 9,
                border: '1px solid rgba(248, 113, 113, 0.4)',
                background: 'rgba(239, 68, 68, 0.2)',
                color: '#FCA5A5',
                fontWeight: 700,
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              <X size={14} /> Decline
            </button>
          </div>
        </div>
      )}

      {/* Room Invite Banners */}
      {pendingInvites.slice(0, 2).map((invite) => (
        <div
          key={invite.id}
          style={{
            pointerEvents: 'auto',
            padding: '12px 14px',
            borderRadius: 14,
            background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.96), rgba(14, 116, 144, 0.92))',
            border: '2px solid #38BDF8',
            boxShadow: '0 10px 30px rgba(0,0,0,0.45)',
            color: '#F8FAFC',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <DoorOpen size={17} color="#38BDF8" />
            <span style={{ fontWeight: 800, fontSize: 13, color: '#BAE6FD' }}>
              Room Invite from {invite.fromUsername}
            </span>
          </div>
          <p style={{ margin: '0 0 10px', fontSize: 12.5, color: '#E2E8F0' }}>
            Join <strong>{invite.roomName}</strong>
            {invite.message ? ` — "${invite.message}"` : ''}
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={() => handleAcceptInvite(invite.id, invite.roomId)}
              style={{
                flex: 1,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 5,
                padding: '6px 10px',
                borderRadius: 9,
                border: 'none',
                background: '#0EA5E9',
                color: '#FFFFFF',
                fontWeight: 700,
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              <Check size={14} /> Join Room
            </button>
            <button
              type="button"
              onClick={() => handleDeclineInvite(invite.id)}
              style={{
                padding: '6px 12px',
                borderRadius: 9,
                border: '1px solid rgba(148, 163, 184, 0.35)',
                background: 'rgba(30, 41, 59, 0.8)',
                color: '#CBD5E1',
                fontWeight: 700,
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              Decline
            </button>
          </div>
        </div>
      ))}

      {/* Incoming Friend Request Banners */}
      {pendingFriendRequests.map((req) => (
        <div
          key={req.id}
          style={{
            pointerEvents: 'auto',
            padding: '11px 14px',
            borderRadius: 14,
            background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.96), rgba(88, 28, 135, 0.92))',
            border: '2px solid #C084FC',
            boxShadow: '0 10px 30px rgba(0,0,0,0.45)',
            color: '#F8FAFC',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <UserPlus size={16} color="#E9D5FF" />
            <span style={{ fontWeight: 800, fontSize: 13, color: '#F3E8FF' }}>
              Friend Request
            </span>
          </div>
          <p style={{ margin: '0 0 9px', fontSize: 12.5, color: '#E2E8F0' }}>
            <strong>{req.fromUsername}</strong> wants to add you as a friend.
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={() => handleRespondFriendRequest(req.id, req.fromUsername, true)}
              style={{
                flex: 1,
                padding: '6px 10px',
                borderRadius: 9,
                border: 'none',
                background: '#9333EA',
                color: '#FFFFFF',
                fontWeight: 700,
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              Accept
            </button>
            <button
              type="button"
              onClick={() => handleRespondFriendRequest(req.id, req.fromUsername, false)}
              style={{
                padding: '6px 12px',
                borderRadius: 9,
                border: '1px solid rgba(148, 163, 184, 0.35)',
                background: 'rgba(30, 41, 59, 0.8)',
                color: '#CBD5E1',
                fontWeight: 700,
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              Decline
            </button>
          </div>
        </div>
      ))}

      {/* Standard Toast Stack */}
      {notifications.map((notif) => {
        const palette =
          notif.type === 'success'
            ? { border: '#22C55E', bg: 'rgba(6, 78, 59, 0.92)', icon: <CheckCircle2 size={17} color="#4ADE80" /> }
            : notif.type === 'warning'
              ? { border: '#F59E0B', bg: 'rgba(120, 53, 15, 0.92)', icon: <AlertTriangle size={17} color="#FBBF24" /> }
              : notif.type === 'error'
                ? { border: '#EF4444', bg: 'rgba(127, 29, 29, 0.94)', icon: <XCircle size={17} color="#F87171" /> }
                : { border: '#38BDF8', bg: 'rgba(15, 23, 42, 0.94)', icon: <Info size={17} color="#38BDF8" /> };

        return (
          <div
            key={notif.id}
            style={{
              pointerEvents: 'auto',
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
              padding: '10px 12px',
              borderRadius: 12,
              background: palette.bg,
              border: `1.5px solid ${palette.border}`,
              boxShadow: '0 8px 24px rgba(0,0,0,0.42)',
              color: '#F8FAFC',
              backdropFilter: 'blur(10px)',
            }}
          >
            <div style={{ marginTop: 2, flexShrink: 0 }}>{palette.icon ?? <Bell size={16} />}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 800, fontSize: 13, lineHeight: 1.25 }}>{notif.title}</div>
              <div style={{ fontSize: 12, color: '#E2E8F0', marginTop: 2, lineHeight: 1.35 }}>
                {notif.message}
              </div>
            </div>
            <button
              type="button"
              onClick={() => dismissNotification(notif.id)}
              aria-label="Dismiss notification"
              style={{
                background: 'transparent',
                border: 'none',
                color: '#94A3B8',
                cursor: 'pointer',
                padding: 2,
                flexShrink: 0,
              }}
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
};

export default NotificationsToast;
