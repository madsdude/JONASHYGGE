import React, { useEffect, useRef, useState } from 'react';
import {
  Backpack,
  Compass,
  Gamepad2,
  Hammer,
  MessageSquare,
  Send,
  ShoppingBag,
  Smile,
  UserCircle,
  Users,
  X,
} from 'lucide-react';
import { EMOTE_TYPES, type ChatMode, type EmoteType } from '@handihotel/shared';
import { audioManager } from '../audio/AudioManager';
import { gameSocket } from '../network/socket';
import { useGameStore, type ActiveModal } from '../state/useGameStore';

const QUICK_EMOTES = EMOTE_TYPES.filter((e) => e.id !== 'sit');

export const BottomDock: React.FC = () => {
  const activeModal = useGameStore((s) => s.activeModal);
  const toggleModal = useGameStore((s) => s.toggleModal);
  const editorOpen = useGameStore((s) => s.editorOpen);
  const toggleEditor = useGameStore((s) => s.toggleEditor);
  const friendRequests = useGameStore((s) => s.friendRequests);
  const pendingInvites = useGameStore((s) => s.pendingInvites);
  const chatMessages = useGameStore((s) => s.chatMessages);
  const currentRoom = useGameStore((s) => s.currentRoom);
  const user = useGameStore((s) => s.user);

  const [chatText, setChatText] = useState('');
  const [chatMode, setChatMode] = useState<ChatMode>('normal');
  const [whisperTarget, setWhisperTarget] = useState('');
  const [emotesOpen, setEmotesOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const historyEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (historyOpen) {
      historyEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatMessages.length, historyOpen]);

  const socialBadgeCount =
    friendRequests.filter((r) => r.status === 'pending').length + pendingInvites.length;

  const handleOpenModal = (modal: Exclude<ActiveModal, null>) => {
    audioManager.playUiClick();
    setEmotesOpen(false);
    toggleModal(modal);
  };

  const handleToggleBuilder = () => {
    audioManager.playUiClick();
    setEmotesOpen(false);
    toggleEditor();
  };

  const handleEmote = (emote: EmoteType) => {
    gameSocket.sendEmote(emote);
    audioManager.playEmote(emote);
    setEmotesOpen(false);
  };

  const handleSendChat = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = chatText.trim();
    if (!trimmed) return;

    // Support /w username message or :shout shortcut
    if (trimmed.startsWith('/w ') || trimmed.startsWith('/whisper ')) {
      const parts = trimmed.split(/\s+/);
      const target = parts[1];
      const msg = parts.slice(2).join(' ');
      if (target && msg) {
        gameSocket.sendChat(msg, 'whisper', target);
        setChatText('');
        return;
      }
    }

    if (chatMode === 'whisper') {
      gameSocket.sendChat(trimmed, 'whisper', whisperTarget.trim() || undefined);
    } else {
      gameSocket.sendChat(trimmed, chatMode);
    }
    setChatText('');
  };

  const dockButtons: Array<{
    id: Exclude<ActiveModal, null>;
    label: string;
    icon: React.ReactNode;
    accent: string;
    badge?: number;
  }> = [
    { id: 'navigator', label: 'Rooms', icon: <Compass size={18} />, accent: '#0EA5E9' },
    { id: 'avatar', label: 'Avatar', icon: <UserCircle size={18} />, accent: '#A855F7' },
    { id: 'shop', label: 'Shop', icon: <ShoppingBag size={18} />, accent: '#F59E0B' },
    { id: 'inventory', label: 'Bag', icon: <Backpack size={18} />, accent: '#14B8A6' },
    {
      id: 'social',
      label: 'Friends',
      icon: <Users size={18} />,
      accent: '#EC4899',
      badge: socialBadgeCount,
    },
    { id: 'minigames', label: 'Games', icon: <Gamepad2 size={18} />, accent: '#22C55E' },
  ];

  return (
    <div
      style={{
        position: 'fixed',
        left: 12,
        right: 12,
        bottom: 10,
        zIndex: 45,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        pointerEvents: 'none',
        fontFamily: "'Fredoka', 'Nunito', 'Segoe UI', system-ui, sans-serif",
      }}
    >
      {/* Collapsible Chat History Drawer */}
      {historyOpen && (
        <div
          style={{
            pointerEvents: 'auto',
            width: 'min(620px, 94vw)',
            maxHeight: 240,
            marginBottom: 8,
            borderRadius: 14,
            background: 'rgba(15, 23, 42, 0.92)',
            border: '2px solid rgba(56, 189, 248, 0.35)',
            boxShadow: '0 12px 32px rgba(0, 0, 0, 0.5)',
            backdropFilter: 'blur(12px)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '7px 12px',
              borderBottom: '1px solid rgba(148, 163, 184, 0.2)',
              color: '#BAE6FD',
              fontSize: 12,
              fontWeight: 800,
            }}
          >
            <span>Room Chat History — {currentRoom?.name ?? 'HandiHotel'}</span>
            <button
              type="button"
              onClick={() => setHistoryOpen(false)}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#94A3B8',
                cursor: 'pointer',
                display: 'inline-flex',
              }}
            >
              <X size={15} />
            </button>
          </div>
          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '8px 12px',
              display: 'flex',
              flexDirection: 'column',
              gap: 5,
              fontSize: 12.5,
              color: '#E2E8F0',
            }}
          >
            {chatMessages.length === 0 ? (
              <div style={{ color: '#64748B', fontStyle: 'italic' }}>
                No messages yet. Say hello to the hotel!
              </div>
            ) : (
              chatMessages.map((msg) => {
                const isSystem = msg.mode === 'system';
                const isShout = msg.mode === 'shout';
                const isWhisper = msg.mode === 'whisper';
                return (
                  <div
                    key={msg.id}
                    style={{
                      lineHeight: 1.35,
                      color: isSystem
                        ? '#93C5FD'
                        : isWhisper
                          ? '#E9D5FF'
                          : isShout
                            ? '#FEF08A'
                            : '#F8FAFC',
                      fontWeight: isShout ? 700 : 500,
                      fontStyle: isWhisper || isSystem ? 'italic' : 'normal',
                    }}
                  >
                    {!isSystem && (
                      <span
                        style={{
                          fontWeight: 800,
                          color: msg.userId === user?.id ? '#38BDF8' : '#FACC15',
                          marginRight: 6,
                        }}
                      >
                        {msg.username}
                        {isWhisper && msg.targetUsername ? ` → ${msg.targetUsername}` : ''}:
                      </span>
                    )}
                    <span>{msg.text}</span>
                  </div>
                );
              })
            )}
            <div ref={historyEndRef} />
          </div>
        </div>
      )}

      {/* Emote Picker Popover */}
      {emotesOpen && (
        <div
          style={{
            pointerEvents: 'auto',
            marginBottom: 8,
            padding: '10px 12px',
            borderRadius: 14,
            background: 'rgba(15, 23, 42, 0.96)',
            border: '2px solid #FACC15',
            boxShadow: '0 12px 32px rgba(0, 0, 0, 0.5)',
            display: 'flex',
            flexWrap: 'wrap',
            gap: 8,
            justifyContent: 'center',
            maxWidth: '94vw',
          }}
        >
          {QUICK_EMOTES.map((emote) => (
            <button
              key={emote.id}
              type="button"
              onClick={() => handleEmote(emote.id)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 11px',
                borderRadius: 10,
                border: '1px solid rgba(250, 204, 21, 0.35)',
                background: 'rgba(30, 41, 59, 0.9)',
                color: '#F8FAFC',
                fontWeight: 700,
                fontSize: 12.5,
                cursor: 'pointer',
              }}
            >
              <span style={{ fontSize: 16 }}>{emote.icon}</span>
              <span>{emote.label}</span>
            </button>
          ))}
        </div>
      )}

      {/* Main Dock Bar */}
      <div
        style={{
          pointerEvents: 'auto',
          width: '100%',
          maxWidth: 1180,
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          padding: '8px 12px',
          borderRadius: 18,
          background:
            'linear-gradient(180deg, rgba(15, 23, 42, 0.94) 0%, rgba(15, 23, 42, 0.98) 100%)',
          border: '2px solid rgba(56, 189, 248, 0.38)',
          boxShadow: '0 10px 32px rgba(0, 0, 0, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.14)',
          backdropFilter: 'blur(12px)',
        }}
      >
        {/* Navigation & Tool Buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {dockButtons.map((btn) => {
            const isActive = activeModal === btn.id;
            return (
              <button
                key={btn.id}
                type="button"
                onClick={() => handleOpenModal(btn.id)}
                title={btn.label}
                style={{
                  position: 'relative',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '8px 11px',
                  borderRadius: 12,
                  border: isActive
                    ? `2px solid ${btn.accent}`
                    : '1px solid rgba(148, 163, 184, 0.25)',
                  background: isActive
                    ? `${btn.accent}33`
                    : 'rgba(30, 41, 59, 0.85)',
                  color: isActive ? '#FFFFFF' : '#E2E8F0',
                  fontWeight: 700,
                  fontSize: 12.5,
                  cursor: 'pointer',
                  boxShadow: isActive ? `0 0 14px ${btn.accent}55` : '0 2px 0 rgba(0,0,0,0.35)',
                }}
              >
                <span style={{ color: btn.accent, display: 'inline-flex' }}>{btn.icon}</span>
                <span>{btn.label}</span>
                {btn.badge !== undefined && btn.badge > 0 && (
                  <span
                    style={{
                      position: 'absolute',
                      top: -5,
                      right: -5,
                      minWidth: 18,
                      height: 18,
                      padding: '0 5px',
                      borderRadius: 999,
                      background: '#EF4444',
                      color: '#FFFFFF',
                      fontSize: 10.5,
                      fontWeight: 800,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      border: '2px solid #0F172A',
                    }}
                  >
                    {btn.badge}
                  </span>
                )}
              </button>
            );
          })}

          {/* Room Builder Button */}
          <button
            type="button"
            onClick={handleToggleBuilder}
            title="Toggle Room Builder"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 11px',
              borderRadius: 12,
              border: editorOpen
                ? '2px solid #FACC15'
                : '1px solid rgba(148, 163, 184, 0.25)',
              background: editorOpen
                ? 'linear-gradient(135deg, rgba(245, 158, 11, 0.4), rgba(234, 88, 12, 0.4))'
                : 'rgba(30, 41, 59, 0.85)',
              color: editorOpen ? '#FEF08A' : '#E2E8F0',
              fontWeight: 800,
              fontSize: 12.5,
              cursor: 'pointer',
              boxShadow: editorOpen ? '0 0 16px rgba(250, 204, 21, 0.45)' : '0 2px 0 rgba(0,0,0,0.35)',
            }}
          >
            <Hammer size={17} color="#FACC15" />
            <span>Build</span>
          </button>

          {/* Emote Picker Trigger */}
          <button
            type="button"
            onClick={() => {
              audioManager.playUiClick();
              setEmotesOpen((v) => !v);
            }}
            title="Emotes"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 38,
              height: 36,
              borderRadius: 12,
              border: emotesOpen
                ? '2px solid #FACC15'
                : '1px solid rgba(148, 163, 184, 0.25)',
              background: emotesOpen ? 'rgba(250, 204, 21, 0.25)' : 'rgba(30, 41, 59, 0.85)',
              color: '#FDE047',
              cursor: 'pointer',
            }}
          >
            <Smile size={18} />
          </button>
        </div>

        {/* Chat Input Bar */}
        <form
          onSubmit={handleSendChat}
          style={{
            flex: '1 1 320px',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            minWidth: 260,
          }}
        >
          <select
            aria-label="Chat mode"
            value={chatMode}
            onChange={(e) => setChatMode(e.target.value as ChatMode)}
            style={{
              padding: '8px 8px',
              borderRadius: 10,
              border: '1px solid rgba(148, 163, 184, 0.3)',
              background: '#1E293B',
              color:
                chatMode === 'shout'
                  ? '#FDE047'
                  : chatMode === 'whisper'
                    ? '#E9D5FF'
                    : '#F8FAFC',
              fontWeight: 700,
              fontSize: 12,
              cursor: 'pointer',
              outline: 'none',
            }}
          >
            <option value="normal">Say</option>
            <option value="shout">Shout</option>
            <option value="whisper">Whisper</option>
          </select>

          {chatMode === 'whisper' && (
            <input
              type="text"
              value={whisperTarget}
              onChange={(e) => setWhisperTarget(e.target.value)}
              placeholder="@user"
              style={{
                width: 90,
                padding: '8px 9px',
                borderRadius: 10,
                border: '1px solid rgba(192, 132, 252, 0.45)',
                background: 'rgba(88, 28, 135, 0.28)',
                color: '#F3E8FF',
                fontSize: 12.5,
                outline: 'none',
              }}
            />
          )}

          <input
            type="text"
            value={chatText}
            onChange={(e) => setChatText(e.target.value)}
            placeholder={
              chatMode === 'shout'
                ? 'Shout to the whole room...'
                : chatMode === 'whisper'
                  ? 'Whisper message...'
                  : 'Click to chat with the room...'
            }
            maxLength={220}
            style={{
              flex: 1,
              minWidth: 120,
              padding: '8px 12px',
              borderRadius: 10,
              border: '1px solid rgba(148, 163, 184, 0.3)',
              background: 'rgba(15, 23, 42, 0.85)',
              color: '#F8FAFC',
              fontSize: 13,
              outline: 'none',
            }}
          />

          <button
            type="submit"
            title="Send message"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 5,
              padding: '8px 12px',
              borderRadius: 10,
              border: 'none',
              background: 'linear-gradient(135deg, #0EA5E9 0%, #2563EB 100%)',
              color: '#FFFFFF',
              fontWeight: 700,
              fontSize: 12.5,
              cursor: 'pointer',
            }}
          >
            <Send size={15} />
          </button>

          <button
            type="button"
            onClick={() => {
              audioManager.playUiClick();
              setHistoryOpen((v) => !v);
            }}
            title="Toggle Chat History"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 36,
              height: 36,
              borderRadius: 10,
              border: historyOpen
                ? '1.5px solid #38BDF8'
                : '1px solid rgba(148, 163, 184, 0.3)',
              background: historyOpen ? 'rgba(56, 189, 248, 0.22)' : 'rgba(30, 41, 59, 0.85)',
              color: historyOpen ? '#7DD3FC' : '#CBD5E1',
              cursor: 'pointer',
            }}
          >
            <MessageSquare size={16} />
          </button>
        </form>
      </div>
    </div>
  );
};

export default BottomDock;
