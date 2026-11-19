import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { OnlineStatus } from '@handihotel/shared';
import {
  ArrowLeftRight,
  Ban,
  Check,
  DoorOpen,
  MessageCircle,
  Search,
  Send,
  UserMinus,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { api, type UserSearchResult } from '../network/api';
import { gameSocket } from '../network/socket';
import { useGameStore } from '../state/useGameStore';

type SocialTab = 'friends' | 'requests' | 'dms' | 'find' | 'blocked';

function statusColor(status?: OnlineStatus | string): string {
  switch (status) {
    case 'online':
      return '#22c55e';
    case 'away':
      return '#f59e0b';
    case 'busy':
      return '#ef4444';
    default:
      return '#64748b';
  }
}

export function SocialModal() {
  const activeModal = useGameStore((s) => s.activeModal);
  const setActiveModal = useGameStore((s) => s.setActiveModal);
  const user = useGameStore((s) => s.user);
  const friends = useGameStore((s) => s.friends);
  const setFriends = useGameStore((s) => s.setFriends);
  const friendRequests = useGameStore((s) => s.friendRequests);
  const setFriendRequests = useGameStore((s) => s.setFriendRequests);
  const removeFriendRequest = useGameStore((s) => s.removeFriendRequest);
  const blockedIds = useGameStore((s) => s.blockedIds);
  const setBlockedIds = useGameStore((s) => s.setBlockedIds);
  const removeBlockedId = useGameStore((s) => s.removeBlockedId);
  const directMessages = useGameStore((s) => s.directMessages);
  const setDirectMessages = useGameStore((s) => s.setDirectMessages);
  const addDirectMessage = useGameStore((s) => s.addDirectMessage);
  const activeDmUserId = useGameStore((s) => s.activeDmUserId);
  const setActiveDmUserId = useGameStore((s) => s.setActiveDmUserId);
  const setProfileUserId = useGameStore((s) => s.setProfileUserId);
  const addNotification = useGameStore((s) => s.addNotification);

  const [tab, setTab] = useState<SocialTab>('friends');
  const [dmText, setDmText] = useState('');
  const [sendingDm, setSendingDm] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<UserSearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  const dmEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (activeModal !== 'social') return;
    if (activeDmUserId) {
      setTab('dms');
    }
    Promise.allSettled([api.getFriends(), api.getFriendRequests(), api.getBlockedUsers()]).then(
      ([fRes, rRes, bRes]) => {
        if (fRes.status === 'fulfilled') setFriends(fRes.value);
        if (rRes.status === 'fulfilled') setFriendRequests(rRes.value);
        if (bRes.status === 'fulfilled') setBlockedIds(bRes.value);
      }
    );
  }, [activeModal, activeDmUserId, setFriends, setFriendRequests, setBlockedIds]);

  useEffect(() => {
    if (activeModal !== 'social' || tab !== 'dms' || !activeDmUserId) return;
    api
      .getDirectMessages(activeDmUserId)
      .then((msgs) => setDirectMessages(activeDmUserId, msgs))
      .catch(() => {
        // Keep existing cached DMs
      });
  }, [activeModal, tab, activeDmUserId, setDirectMessages]);

  const currentMessages = useMemo(
    () => (activeDmUserId ? directMessages[activeDmUserId] ?? [] : []),
    [directMessages, activeDmUserId]
  );

  useEffect(() => {
    dmEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [currentMessages.length, activeDmUserId]);

  const dmPeers = useMemo(() => {
    const map = new Map<string, { userId: string; username: string; onlineStatus: string }>();
    for (const f of friends) {
      map.set(f.userId, {
        userId: f.userId,
        username: f.username,
        onlineStatus: f.onlineStatus,
      });
    }
    for (const [peerId, msgs] of Object.entries(directMessages)) {
      if (!map.has(peerId)) {
        const last = msgs[msgs.length - 1];
        const peerName = last
          ? last.fromUserId === peerId
            ? last.fromUsername
            : last.toUsername
          : `Guest ${peerId.slice(0, 6)}`;
        map.set(peerId, { userId: peerId, username: peerName, onlineStatus: 'offline' });
      }
    }
    if (activeDmUserId && !map.has(activeDmUserId)) {
      map.set(activeDmUserId, {
        userId: activeDmUserId,
        username: `Player ${activeDmUserId.slice(0, 6)}`,
        onlineStatus: 'offline',
      });
    }
    return Array.from(map.values());
  }, [friends, directMessages, activeDmUserId]);

  if (activeModal !== 'social') return null;

  const handleFollowFriend = async (roomId: string | null) => {
    if (!roomId) return;
    await gameSocket.joinRoom(roomId);
    setActiveModal(null);
  };

  const handleRemoveFriend = async (friendUserId: string, username: string) => {
    try {
      await api.removeFriend(friendUserId);
      setFriends(friends.filter((f) => f.userId !== friendUserId));
      addNotification({
        type: 'info',
        title: 'Friend Removed',
        message: `${username} was removed from your friends list.`,
      });
    } catch (err) {
      addNotification({
        type: 'error',
        title: 'Error',
        message: err instanceof Error ? err.message : 'Could not remove friend.',
      });
    }
  };

  const handleRespondRequest = async (requestId: string, accept: boolean) => {
    try {
      const res = await api.respondFriendRequest(requestId, accept);
      removeFriendRequest(requestId);
      if (accept) {
        if (res.friend) {
          setFriends([...friends, res.friend]);
        } else {
          api.getFriends().then(setFriends).catch(() => undefined);
        }
        addNotification({
          type: 'success',
          title: 'Friend Added',
          message: 'You are now friends!',
        });
      }
    } catch (err) {
      addNotification({
        type: 'error',
        title: 'Request Error',
        message: err instanceof Error ? err.message : 'Could not respond to request.',
      });
    }
  };

  const handleSendDm = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = dmText.trim();
    if (!trimmed || !activeDmUserId || sendingDm) return;
    setSendingDm(true);
    try {
      const res = await gameSocket.sendDm(activeDmUserId, trimmed);
      if (!res.ok) {
        const apiRes = await api.sendDirectMessage(activeDmUserId, trimmed);
        if (apiRes.message) addDirectMessage(apiRes.message);
      }
      setDmText('');
    } catch (err) {
      addNotification({
        type: 'error',
        title: 'DM Failed',
        message: err instanceof Error ? err.message : 'Could not send message.',
      });
    } finally {
      setSendingDm(false);
    }
  };

  const handleSearchPlayers = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchQuery.trim();
    if (!q) return;
    setSearching(true);
    try {
      const users = await api.searchUsers(q);
      setSearchResults(users.filter((u) => u.id !== user?.id));
    } catch (err) {
      addNotification({
        type: 'error',
        title: 'Search Failed',
        message: err instanceof Error ? err.message : 'Could not search players.',
      });
    } finally {
      setSearching(false);
    }
  };

  const handleAddFriend = async (username: string) => {
    try {
      await api.sendFriendRequest(username);
      addNotification({
        type: 'success',
        title: 'Friend Request Sent',
        message: `Sent a friend request to ${username}.`,
      });
    } catch (err) {
      addNotification({
        type: 'error',
        title: 'Could Not Add Friend',
        message: err instanceof Error ? err.message : 'Request failed.',
      });
    }
  };

  const handleUnblock = async (targetId: string) => {
    try {
      await api.unblockUser(targetId);
      removeBlockedId(targetId);
      addNotification({
        type: 'info',
        title: 'User Unblocked',
        message: 'Player has been removed from your block list.',
      });
    } catch (err) {
      addNotification({
        type: 'error',
        title: 'Unblock Failed',
        message: err instanceof Error ? err.message : 'Could not unblock user.',
      });
    }
  };

  const tabs: { id: SocialTab; label: string; badge?: number; icon: React.ReactNode }[] = [
    { id: 'friends', label: 'Friends', badge: friends.length, icon: <Users size={14} /> },
    {
      id: 'requests',
      label: 'Requests',
      badge: friendRequests.length,
      icon: <UserPlus size={14} />,
    },
    { id: 'dms', label: 'Direct Messages', icon: <MessageCircle size={14} /> },
    { id: 'find', label: 'Find Players', icon: <Search size={14} /> },
    { id: 'blocked', label: 'Blocked', badge: blockedIds.length, icon: <Ban size={14} /> },
  ];

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        background: 'rgba(2, 6, 23, 0.72)',
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
          width: 'min(920px, 96vw)',
          height: 'min(640px, 88vh)',
          background: 'linear-gradient(160deg, rgba(15, 23, 42, 0.98), rgba(30, 41, 59, 0.97))',
          border: '1px solid rgba(56, 189, 248, 0.35)',
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
                width: 36,
                height: 36,
                borderRadius: 10,
                background: 'linear-gradient(135deg, #38bdf8, #0ea5e9)',
                color: '#0f172a',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Users size={19} />
            </div>
            <div>
              <div style={{ fontSize: 18, fontWeight: 800 }}>Hotel Social Hub</div>
              <div style={{ fontSize: 12, color: '#94a3b8' }}>
                Connect with friends, chat via DM, and hop into rooms together
              </div>
            </div>
          </div>

          <button
            onClick={() => setActiveModal(null)}
            aria-label="Close Social"
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

        {/* Tab Bar */}
        <div
          style={{
            display: 'flex',
            gap: 6,
            padding: '10px 18px',
            borderBottom: '1px solid rgba(148, 163, 184, 0.14)',
            overflowX: 'auto',
          }}
        >
          {tabs.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '8px 13px',
                  borderRadius: 10,
                  fontSize: 12,
                  fontWeight: 700,
                  whiteSpace: 'nowrap',
                  cursor: 'pointer',
                  border: active
                    ? '1px solid rgba(56, 189, 248, 0.7)'
                    : '1px solid rgba(148, 163, 184, 0.2)',
                  background: active ? 'rgba(56, 189, 248, 0.18)' : 'rgba(15, 23, 42, 0.5)',
                  color: active ? '#7dd3fc' : '#cbd5e1',
                }}
              >
                {t.icon}
                {t.label}
                {typeof t.badge === 'number' && t.badge > 0 && (
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 800,
                      padding: '1px 6px',
                      borderRadius: 999,
                      background:
                        t.id === 'requests' ? '#ef4444' : 'rgba(148, 163, 184, 0.28)',
                      color: '#fff',
                    }}
                  >
                    {t.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Body */}
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* FRIENDS TAB */}
          {tab === 'friends' && (
            <div style={{ flex: 1, overflowY: 'auto', padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {friends.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 48, color: '#94a3b8' }}>
                  No friends yet. Use the <strong>Find Players</strong> tab to make new friends!
                </div>
              ) : (
                friends.map((friend) => (
                  <div
                    key={friend.userId}
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 12,
                      padding: '12px 14px',
                      borderRadius: 12,
                      background: 'rgba(15, 23, 42, 0.7)',
                      border: '1px solid rgba(148, 163, 184, 0.18)',
                    }}
                  >
                    <div
                      onClick={() => setProfileUserId(friend.userId)}
                      style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}
                    >
                      <div
                        style={{
                          width: 40,
                          height: 40,
                          borderRadius: '50%',
                          background: friend.avatar?.shirtColor || '#3b82f6',
                          border: '2px solid rgba(255,255,255,0.2)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontWeight: 800,
                          fontSize: 15,
                          position: 'relative',
                        }}
                      >
                        {friend.username.slice(0, 1).toUpperCase()}
                        <span
                          style={{
                            position: 'absolute',
                            bottom: 0,
                            right: 0,
                            width: 11,
                            height: 11,
                            borderRadius: '50%',
                            background: statusColor(friend.onlineStatus),
                            border: '2px solid #0f172a',
                          }}
                        />
                      </div>
                      <div>
                        <div style={{ fontWeight: 800, fontSize: 14 }}>{friend.username}</div>
                        <div style={{ fontSize: 12, color: '#94a3b8' }}>
                          {friend.onlineStatus === 'online'
                            ? friend.currentRoomName
                              ? `In ${friend.currentRoomName}`
                              : 'Online in Hotel'
                            : 'Offline'}
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {friend.currentRoomId && (
                        <button
                          onClick={() => handleFollowFriend(friend.currentRoomId)}
                          style={{
                            padding: '6px 10px',
                            borderRadius: 8,
                            border: '1px solid rgba(34, 197, 94, 0.45)',
                            background: 'rgba(34, 197, 94, 0.16)',
                            color: '#4ade80',
                            fontSize: 11,
                            fontWeight: 700,
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                          }}
                        >
                          <DoorOpen size={13} /> Follow
                        </button>
                      )}
                      <button
                        onClick={() => {
                          setActiveDmUserId(friend.userId);
                          setTab('dms');
                        }}
                        style={{
                          padding: '6px 10px',
                          borderRadius: 8,
                          border: '1px solid rgba(56, 189, 248, 0.45)',
                          background: 'rgba(56, 189, 248, 0.16)',
                          color: '#7dd3fc',
                          fontSize: 11,
                          fontWeight: 700,
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                        }}
                      >
                        <MessageCircle size={13} /> DM
                      </button>
                      <button
                        onClick={() => {
                          gameSocket.requestTrade(friend.userId);
                          setActiveModal(null);
                          addNotification({
                            type: 'info',
                            title: 'Trade Request Sent',
                            message: `Requested a trade with ${friend.username}.`,
                          });
                        }}
                        style={{
                          padding: '6px 10px',
                          borderRadius: 8,
                          border: '1px solid rgba(251, 191, 36, 0.45)',
                          background: 'rgba(251, 191, 36, 0.16)',
                          color: '#fde68a',
                          fontSize: 11,
                          fontWeight: 700,
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                        }}
                      >
                        <ArrowLeftRight size={13} /> Trade
                      </button>
                      <button
                        onClick={() => handleRemoveFriend(friend.userId, friend.username)}
                        title="Remove Friend"
                        style={{
                          padding: '6px 8px',
                          borderRadius: 8,
                          border: '1px solid rgba(239, 68, 68, 0.35)',
                          background: 'rgba(239, 68, 68, 0.12)',
                          color: '#fca5a5',
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                        }}
                      >
                        <UserMinus size={13} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* REQUESTS TAB */}
          {tab === 'requests' && (
            <div style={{ flex: 1, overflowY: 'auto', padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {friendRequests.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 48, color: '#94a3b8' }}>
                  No pending friend requests.
                </div>
              ) : (
                friendRequests.map((req) => (
                  <div
                    key={req.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '12px 14px',
                      borderRadius: 12,
                      background: 'rgba(15, 23, 42, 0.7)',
                      border: '1px solid rgba(148, 163, 184, 0.2)',
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 800, fontSize: 14 }}>{req.fromUsername}</div>
                      <div style={{ fontSize: 11, color: '#94a3b8' }}>
                        Wants to be your hotel friend
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        onClick={() => handleRespondRequest(req.id, true)}
                        style={{
                          padding: '7px 12px',
                          borderRadius: 8,
                          border: 'none',
                          background: 'linear-gradient(135deg, #22c55e, #16a34a)',
                          color: '#052e16',
                          fontWeight: 800,
                          fontSize: 12,
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                        }}
                      >
                        <Check size={14} /> Accept
                      </button>
                      <button
                        onClick={() => handleRespondRequest(req.id, false)}
                        style={{
                          padding: '7px 12px',
                          borderRadius: 8,
                          border: '1px solid rgba(239, 68, 68, 0.4)',
                          background: 'rgba(239, 68, 68, 0.16)',
                          color: '#fca5a5',
                          fontWeight: 700,
                          fontSize: 12,
                          cursor: 'pointer',
                        }}
                      >
                        Decline
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* DIRECT MESSAGES TAB */}
          {tab === 'dms' && (
            <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
              {/* Conversation List */}
              <div
                style={{
                  width: 220,
                  borderRight: '1px solid rgba(148, 163, 184, 0.16)',
                  overflowY: 'auto',
                  padding: 10,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                {dmPeers.length === 0 ? (
                  <div style={{ fontSize: 12, color: '#64748b', padding: 12, textAlign: 'center' }}>
                    Add friends to start messaging.
                  </div>
                ) : (
                  dmPeers.map((peer) => {
                    const active = activeDmUserId === peer.userId;
                    return (
                      <button
                        key={peer.userId}
                        onClick={() => setActiveDmUserId(peer.userId)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          padding: '9px 10px',
                          borderRadius: 10,
                          textAlign: 'left',
                          cursor: 'pointer',
                          border: active
                            ? '1px solid rgba(56, 189, 248, 0.7)'
                            : '1px solid transparent',
                          background: active ? 'rgba(56, 189, 248, 0.18)' : 'rgba(15, 23, 42, 0.5)',
                          color: '#f8fafc',
                          fontSize: 13,
                          fontWeight: 700,
                        }}
                      >
                        <span
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: '50%',
                            background: statusColor(peer.onlineStatus),
                            flexShrink: 0,
                          }}
                        />
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {peer.username}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>

              {/* Chat Thread */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                {!activeDmUserId ? (
                  <div style={{ margin: 'auto', color: '#94a3b8', fontSize: 13 }}>
                    Select a conversation on the left to view messages.
                  </div>
                ) : (
                  <>
                    <div
                      style={{
                        flex: 1,
                        overflowY: 'auto',
                        padding: 16,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8,
                      }}
                    >
                      {currentMessages.length === 0 ? (
                        <div style={{ margin: 'auto', color: '#64748b', fontSize: 12 }}>
                          No messages yet. Say hello!
                        </div>
                      ) : (
                        currentMessages.map((msg) => {
                          const mine = msg.fromUserId === user?.id;
                          return (
                            <div
                              key={msg.id}
                              style={{
                                alignSelf: mine ? 'flex-end' : 'flex-start',
                                maxWidth: '75%',
                                padding: '8px 12px',
                                borderRadius: 12,
                                background: mine
                                  ? 'linear-gradient(135deg, #0284c7, #2563eb)'
                                  : 'rgba(30, 41, 59, 0.9)',
                                border: mine
                                  ? '1px solid rgba(56, 189, 248, 0.5)'
                                  : '1px solid rgba(148, 163, 184, 0.2)',
                                fontSize: 13,
                              }}
                            >
                              <div style={{ fontSize: 10, color: mine ? '#bae6fd' : '#94a3b8', marginBottom: 2 }}>
                                {msg.fromUsername}
                              </div>
                              <div>{msg.text}</div>
                            </div>
                          );
                        })
                      )}
                      <div ref={dmEndRef} />
                    </div>

                    <form
                      onSubmit={handleSendDm}
                      style={{
                        display: 'flex',
                        gap: 8,
                        padding: 12,
                        borderTop: '1px solid rgba(148, 163, 184, 0.16)',
                        background: 'rgba(15, 23, 42, 0.7)',
                      }}
                    >
                      <input
                        type="text"
                        value={dmText}
                        onChange={(e) => setDmText(e.target.value)}
                        placeholder="Type a direct message..."
                        maxLength={300}
                        style={{
                          flex: 1,
                          padding: '9px 12px',
                          borderRadius: 10,
                          border: '1px solid rgba(148, 163, 184, 0.28)',
                          background: 'rgba(15, 23, 42, 0.9)',
                          color: '#f8fafc',
                          fontSize: 13,
                          outline: 'none',
                        }}
                      />
                      <button
                        type="submit"
                        disabled={!dmText.trim() || sendingDm}
                        style={{
                          padding: '9px 16px',
                          borderRadius: 10,
                          border: 'none',
                          background: 'linear-gradient(135deg, #38bdf8, #2563eb)',
                          color: '#0f172a',
                          fontWeight: 800,
                          fontSize: 13,
                          cursor: dmText.trim() && !sendingDm ? 'pointer' : 'not-allowed',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6,
                        }}
                      >
                        <Send size={14} /> Send
                      </button>
                    </form>
                  </>
                )}
              </div>
            </div>
          )}

          {/* FIND PLAYERS TAB */}
          {tab === 'find' && (
            <div style={{ flex: 1, overflowY: 'auto', padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <form onSubmit={handleSearchPlayers} style={{ display: 'flex', gap: 8 }}>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by username..."
                  style={{
                    flex: 1,
                    padding: '10px 14px',
                    borderRadius: 10,
                    border: '1px solid rgba(148, 163, 184, 0.28)',
                    background: 'rgba(15, 23, 42, 0.8)',
                    color: '#f8fafc',
                    fontSize: 13,
                    outline: 'none',
                  }}
                />
                <button
                  type="submit"
                  disabled={searching}
                  style={{
                    padding: '10px 18px',
                    borderRadius: 10,
                    border: 'none',
                    background: 'linear-gradient(135deg, #38bdf8, #2563eb)',
                    color: '#0f172a',
                    fontWeight: 800,
                    fontSize: 13,
                    cursor: 'pointer',
                  }}
                >
                  {searching ? 'Searching...' : 'Search'}
                </button>
              </form>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {searchResults.map((p) => {
                  const alreadyFriend = friends.some((f) => f.userId === p.id);
                  return (
                    <div
                      key={p.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '11px 14px',
                        borderRadius: 12,
                        background: 'rgba(15, 23, 42, 0.7)',
                        border: '1px solid rgba(148, 163, 184, 0.18)',
                      }}
                    >
                      <div
                        onClick={() => setProfileUserId(p.id)}
                        style={{ cursor: 'pointer' }}
                      >
                        <div style={{ fontWeight: 800, fontSize: 14 }}>{p.username}</div>
                        <div style={{ fontSize: 12, color: '#94a3b8' }}>
                          {p.motto || 'Exploring HandiHotel'}
                        </div>
                      </div>
                      <button
                        disabled={alreadyFriend}
                        onClick={() => handleAddFriend(p.username)}
                        style={{
                          padding: '7px 12px',
                          borderRadius: 8,
                          border: 'none',
                          background: alreadyFriend
                            ? 'rgba(34, 197, 94, 0.18)'
                            : 'linear-gradient(135deg, #f59e0b, #d97706)',
                          color: alreadyFriend ? '#4ade80' : '#0f172a',
                          fontWeight: 800,
                          fontSize: 12,
                          cursor: alreadyFriend ? 'default' : 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 5,
                        }}
                      >
                        <UserPlus size={14} />
                        {alreadyFriend ? 'Friends' : 'Add Friend'}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* BLOCKED TAB */}
          {tab === 'blocked' && (
            <div style={{ flex: 1, overflowY: 'auto', padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {blockedIds.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 48, color: '#94a3b8' }}>
                  You haven&apos;t blocked anyone.
                </div>
              ) : (
                blockedIds.map((blockedId) => (
                  <div
                    key={blockedId}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '11px 14px',
                      borderRadius: 12,
                      background: 'rgba(15, 23, 42, 0.7)',
                      border: '1px solid rgba(148, 163, 184, 0.18)',
                    }}
                  >
                    <span style={{ fontWeight: 700, fontSize: 13 }}>User {blockedId}</span>
                    <button
                      onClick={() => handleUnblock(blockedId)}
                      style={{
                        padding: '6px 12px',
                        borderRadius: 8,
                        border: '1px solid rgba(148, 163, 184, 0.35)',
                        background: 'rgba(30, 41, 59, 0.85)',
                        color: '#e2e8f0',
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      Unblock
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default SocialModal;
