import React, { useEffect, useState } from 'react';
import {
  ACCESSORIES,
  EXPRESSIONS,
  HAIR_STYLES,
  MOBILITY_AIDS,
  SHIRT_STYLES,
  type ReportReason,
  type UserProfile,
  type UserRole,
} from '@handihotel/shared';
import {
  Accessibility,
  ArrowLeftRight,
  Ban,
  Calendar,
  Coins,
  DoorOpen,
  Flag,
  MessageCircle,
  Shield,
  Star,
  UserPlus,
  X,
} from 'lucide-react';
import { api } from '../network/api';
import { gameSocket } from '../network/socket';
import { useGameStore } from '../state/useGameStore';

const ROLE_BADGES: Record<UserRole, { label: string; bg: string; color: string }> = {
  player: { label: 'Guest', bg: 'rgba(148, 163, 184, 0.2)', color: '#cbd5e1' },
  vip: { label: 'VIP', bg: 'rgba(251, 191, 36, 0.22)', color: '#fbbf24' },
  moderator: { label: 'Mod', bg: 'rgba(56, 189, 248, 0.22)', color: '#38bdf8' },
  admin: { label: 'Hotel Staff', bg: 'rgba(239, 68, 68, 0.24)', color: '#f87171' },
};

const REPORT_REASONS: { id: ReportReason; label: string }[] = [
  { id: 'harassment', label: 'Harassment or Bullying' },
  { id: 'spam', label: 'Spam or Flooding' },
  { id: 'inappropriate_content', label: 'Inappropriate Content' },
  { id: 'cheating', label: 'Cheating / Exploiting' },
  { id: 'scamming', label: 'Trade Scamming' },
  { id: 'other', label: 'Other' },
];

export function ProfileModal() {
  const profileUserId = useGameStore((s) => s.profileUserId);
  const setProfileUserId = useGameStore((s) => s.setProfileUserId);
  const user = useGameStore((s) => s.user);
  const currentRoom = useGameStore((s) => s.currentRoom);
  const friends = useGameStore((s) => s.friends);
  const blockedIds = useGameStore((s) => s.blockedIds);
  const addBlockedId = useGameStore((s) => s.addBlockedId);
  const removeBlockedId = useGameStore((s) => s.removeBlockedId);
  const setActiveDmUserId = useGameStore((s) => s.setActiveDmUserId);
  const setActiveModal = useGameStore((s) => s.setActiveModal);
  const addNotification = useGameStore((s) => s.addNotification);

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState<ReportReason>('harassment');
  const [reportDetails, setReportDetails] = useState('');
  const [submittingReport, setSubmittingReport] = useState(false);

  useEffect(() => {
    if (!profileUserId) {
      setProfile(null);
      setReportOpen(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getUserProfile(profileUserId)
      .then((data) => {
        if (!cancelled) setProfile(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not load profile.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [profileUserId]);

  if (!profileUserId) return null;

  const isSelf = user?.id === profileUserId;
  const isFriend = friends.some((f) => f.userId === profileUserId);
  const isBlocked = blockedIds.includes(profileUserId);

  const mobilityLabel =
    MOBILITY_AIDS.find((m) => m.id === profile?.avatar?.mobilityAid)?.label ?? 'None';
  const shirtLabel =
    SHIRT_STYLES.find((s) => s.id === profile?.avatar?.shirtStyle)?.label ?? 'Standard';
  const hairLabel =
    HAIR_STYLES.find((h) => h.id === profile?.avatar?.hairStyle)?.label ?? 'Classic';
  const accessoryLabel =
    ACCESSORIES.find((a) => a.id === profile?.avatar?.accessory)?.label ?? 'None';
  const expressionLabel =
    EXPRESSIONS.find((e) => e.id === profile?.avatar?.expression)?.label ?? 'Happy';

  const handleAddFriend = async () => {
    if (!profile) return;
    try {
      await api.sendFriendRequest(profile.username);
      addNotification({
        type: 'success',
        title: 'Friend Request Sent',
        message: `Sent a friend request to ${profile.username}.`,
      });
    } catch (err) {
      addNotification({
        type: 'error',
        title: 'Request Failed',
        message: err instanceof Error ? err.message : 'Could not send friend request.',
      });
    }
  };

  const handleSendDm = () => {
    if (!profile) return;
    setActiveDmUserId(profile.id);
    setProfileUserId(null);
    setActiveModal('social');
  };

  const handleInviteToRoom = () => {
    if (!profile || !currentRoom) return;
    gameSocket.sendRoomInvite(
      profile.id,
      currentRoom.id,
      `Come hang out in ${currentRoom.name}!`
    );
    addNotification({
      type: 'success',
      title: 'Invite Sent',
      message: `Invited ${profile.username} to ${currentRoom.name}.`,
    });
  };

  const handleStartTrade = () => {
    if (!profile) return;
    gameSocket.requestTrade(profile.id);
    setProfileUserId(null);
    addNotification({
      type: 'info',
      title: 'Trade Request Sent',
      message: `Waiting for ${profile.username} to accept your trade.`,
    });
  };

  const handleToggleBlock = async () => {
    if (!profile) return;
    try {
      if (isBlocked) {
        await api.unblockUser(profile.id);
        removeBlockedId(profile.id);
        addNotification({
          type: 'info',
          title: 'User Unblocked',
          message: `${profile.username} has been unblocked.`,
        });
      } else {
        await api.blockUser(profile.id);
        addBlockedId(profile.id);
        addNotification({
          type: 'warning',
          title: 'User Blocked',
          message: `${profile.username} has been blocked.`,
        });
      }
    } catch (err) {
      addNotification({
        type: 'error',
        title: 'Action Failed',
        message: err instanceof Error ? err.message : 'Could not update block status.',
      });
    }
  };

  const handleSubmitReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile || !reportDetails.trim() || submittingReport) return;
    setSubmittingReport(true);
    try {
      await api.reportUser({
        targetUserId: profile.id,
        targetUsername: profile.username,
        roomId: currentRoom?.id,
        reason: reportReason,
        details: reportDetails.trim(),
      });
      setReportDetails('');
      setReportOpen(false);
      addNotification({
        type: 'success',
        title: 'Report Submitted',
        message: 'Thank you. Hotel moderators will review your report.',
      });
    } catch (err) {
      addNotification({
        type: 'error',
        title: 'Report Failed',
        message: err instanceof Error ? err.message : 'Could not submit report.',
      });
    } finally {
      setSubmittingReport(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 65,
        background: 'rgba(2, 6, 23, 0.72)',
        backdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) setProfileUserId(null);
      }}
    >
      <div
        style={{
          width: 'min(480px, 95vw)',
          maxHeight: '90vh',
          overflowY: 'auto',
          background: 'linear-gradient(160deg, rgba(15, 23, 42, 0.98), rgba(30, 41, 59, 0.97))',
          border: '1px solid rgba(251, 191, 36, 0.35)',
          borderRadius: 18,
          boxShadow: '0 24px 64px rgba(0, 0, 0, 0.65)',
          color: '#f8fafc',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        {/* Top Bar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '13px 18px',
            borderBottom: '1px solid rgba(148, 163, 184, 0.16)',
          }}
        >
          <span style={{ fontWeight: 800, fontSize: 15 }}>Guest Profile</span>
          <button
            onClick={() => setProfileUserId(null)}
            aria-label="Close Profile"
            style={{
              background: 'rgba(148, 163, 184, 0.12)',
              border: '1px solid rgba(148, 163, 184, 0.25)',
              color: '#e2e8f0',
              width: 30,
              height: 30,
              borderRadius: 9,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <X size={16} />
          </button>
        </div>

        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>
              Loading guest profile...
            </div>
          ) : error || !profile ? (
            <div style={{ textAlign: 'center', padding: 36, color: '#fca5a5' }}>
              {error || 'Profile not found.'}
            </div>
          ) : (
            <>
              {/* Identity Banner */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div
                  style={{
                    width: 64,
                    height: 64,
                    borderRadius: 16,
                    background: `linear-gradient(135deg, ${profile.avatar?.shirtColor || '#3b82f6'}, ${
                      profile.avatar?.mobilityAidColor || '#0ea5e9'
                    })`,
                    border: '2px solid rgba(255,255,255,0.22)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 24,
                    fontWeight: 900,
                    color: '#fff',
                    position: 'relative',
                    flexShrink: 0,
                  }}
                >
                  {profile.username.slice(0, 1).toUpperCase()}
                  <span
                    style={{
                      position: 'absolute',
                      bottom: -3,
                      right: -3,
                      width: 14,
                      height: 14,
                      borderRadius: '50%',
                      background:
                        profile.onlineStatus === 'online' ? '#22c55e' : '#64748b',
                      border: '2px solid #0f172a',
                    }}
                  />
                </div>

                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 19, fontWeight: 900 }}>{profile.username}</span>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 800,
                        padding: '2px 8px',
                        borderRadius: 999,
                        background: ROLE_BADGES[profile.role].bg,
                        color: ROLE_BADGES[profile.role].color,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                      }}
                    >
                      <Shield size={11} />
                      {ROLE_BADGES[profile.role].label}
                    </span>
                  </div>
                  <div style={{ fontSize: 13, color: '#cbd5e1', marginTop: 3 }}>
                    &ldquo;{profile.motto || 'Living the high life at HandiHotel!'}&rdquo;
                  </div>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Calendar size={12} />
                    Joined {new Date(profile.createdAt).toLocaleDateString()}
                    {profile.currentRoomName ? ` • In ${profile.currentRoomName}` : ''}
                  </div>
                </div>
              </div>

              {/* Stats Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                <div
                  style={{
                    padding: 10,
                    borderRadius: 10,
                    background: 'rgba(15, 23, 42, 0.65)',
                    border: '1px solid rgba(148, 163, 184, 0.16)',
                    textAlign: 'center',
                  }}
                >
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>Credits</div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: '#fbbf24', display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
                    <Coins size={13} /> {profile.credits.toLocaleString()}
                  </div>
                </div>
                <div
                  style={{
                    padding: 10,
                    borderRadius: 10,
                    background: 'rgba(15, 23, 42, 0.65)',
                    border: '1px solid rgba(148, 163, 184, 0.16)',
                    textAlign: 'center',
                  }}
                >
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>Stars</div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: '#38bdf8', display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
                    <Star size={13} /> {profile.stars.toLocaleString()}
                  </div>
                </div>
                <div
                  style={{
                    padding: 10,
                    borderRadius: 10,
                    background: 'rgba(15, 23, 42, 0.65)',
                    border: '1px solid rgba(148, 163, 184, 0.16)',
                    textAlign: 'center',
                  }}
                >
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>Level</div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: '#4ade80', marginTop: 2 }}>
                    Lv. {profile.level} ({profile.xp} XP)
                  </div>
                </div>
              </div>

              {/* Mobility Aid & Outfit Summary */}
              <div
                style={{
                  padding: 12,
                  borderRadius: 12,
                  background: 'rgba(15, 23, 42, 0.65)',
                  border: '1px solid rgba(148, 163, 184, 0.16)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  fontSize: 12,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 800, color: '#fde68a' }}>
                  <Accessibility size={15} /> Mobility &amp; Style Summary
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, color: '#cbd5e1' }}>
                  <div>
                    <span style={{ color: '#94a3b8' }}>Mobility Aid:</span> {mobilityLabel}
                  </div>
                  <div>
                    <span style={{ color: '#94a3b8' }}>Outfit:</span> {shirtLabel}
                  </div>
                  <div>
                    <span style={{ color: '#94a3b8' }}>Hair:</span> {hairLabel}
                  </div>
                  <div>
                    <span style={{ color: '#94a3b8' }}>Accessory:</span> {accessoryLabel}
                  </div>
                  <div>
                    <span style={{ color: '#94a3b8' }}>Expression:</span> {expressionLabel}
                  </div>
                  <div>
                    <span style={{ color: '#94a3b8' }}>Badges:</span>{' '}
                    {profile.badges.length > 0 ? profile.badges.join(', ') : 'Newcomer'}
                  </div>
                </div>
              </div>

              {/* Action Buttons (for other users) */}
              {!isSelf && (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <button
                      disabled={isFriend}
                      onClick={handleAddFriend}
                      style={{
                        padding: '9px 12px',
                        borderRadius: 10,
                        border: 'none',
                        background: isFriend
                          ? 'rgba(34, 197, 94, 0.18)'
                          : 'linear-gradient(135deg, #22c55e, #16a34a)',
                        color: isFriend ? '#4ade80' : '#052e16',
                        fontWeight: 800,
                        fontSize: 12,
                        cursor: isFriend ? 'default' : 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 6,
                      }}
                    >
                      <UserPlus size={14} /> {isFriend ? 'Already Friends' : 'Add Friend'}
                    </button>

                    <button
                      onClick={handleSendDm}
                      style={{
                        padding: '9px 12px',
                        borderRadius: 10,
                        border: '1px solid rgba(56, 189, 248, 0.5)',
                        background: 'rgba(56, 189, 248, 0.16)',
                        color: '#7dd3fc',
                        fontWeight: 800,
                        fontSize: 12,
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 6,
                      }}
                    >
                      <MessageCircle size={14} /> Send DM
                    </button>

                    <button
                      disabled={!currentRoom}
                      onClick={handleInviteToRoom}
                      style={{
                        padding: '9px 12px',
                        borderRadius: 10,
                        border: '1px solid rgba(168, 85, 247, 0.45)',
                        background: 'rgba(168, 85, 247, 0.16)',
                        color: '#d8b4fe',
                        fontWeight: 800,
                        fontSize: 12,
                        cursor: currentRoom ? 'pointer' : 'not-allowed',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 6,
                      }}
                    >
                      <DoorOpen size={14} /> Invite to Room
                    </button>

                    <button
                      onClick={handleStartTrade}
                      style={{
                        padding: '9px 12px',
                        borderRadius: 10,
                        border: '1px solid rgba(251, 191, 36, 0.5)',
                        background: 'rgba(251, 191, 36, 0.16)',
                        color: '#fde68a',
                        fontWeight: 800,
                        fontSize: 12,
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 6,
                      }}
                    >
                      <ArrowLeftRight size={14} /> Start Trade
                    </button>
                  </div>

                  {/* Moderation Row */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <button
                      onClick={handleToggleBlock}
                      style={{
                        flex: 1,
                        padding: '8px 10px',
                        borderRadius: 9,
                        border: '1px solid rgba(239, 68, 68, 0.35)',
                        background: 'rgba(239, 68, 68, 0.12)',
                        color: '#fca5a5',
                        fontWeight: 700,
                        fontSize: 12,
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 5,
                      }}
                    >
                      <Ban size={13} /> {isBlocked ? 'Unblock User' : 'Block User'}
                    </button>
                    <button
                      onClick={() => setReportOpen((v) => !v)}
                      style={{
                        flex: 1,
                        padding: '8px 10px',
                        borderRadius: 9,
                        border: '1px solid rgba(245, 158, 11, 0.35)',
                        background: 'rgba(245, 158, 11, 0.12)',
                        color: '#fcd34d',
                        fontWeight: 700,
                        fontSize: 12,
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 5,
                      }}
                    >
                      <Flag size={13} /> {reportOpen ? 'Hide Report' : 'Report User'}
                    </button>
                  </div>

                  {/* Collapsible Report Form */}
                  {reportOpen && (
                    <form
                      onSubmit={handleSubmitReport}
                      style={{
                        padding: 12,
                        borderRadius: 12,
                        background: 'rgba(127, 29, 29, 0.2)',
                        border: '1px solid rgba(239, 68, 68, 0.35)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8,
                      }}
                    >
                      <div style={{ fontSize: 12, fontWeight: 800, color: '#fca5a5' }}>
                        Report {profile.username}
                      </div>
                      <select
                        value={reportReason}
                        onChange={(e) => setReportReason(e.target.value as ReportReason)}
                        style={{
                          padding: '8px 10px',
                          borderRadius: 8,
                          border: '1px solid rgba(148, 163, 184, 0.3)',
                          background: '#0f172a',
                          color: '#f8fafc',
                          fontSize: 12,
                        }}
                      >
                        {REPORT_REASONS.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                      <textarea
                        value={reportDetails}
                        onChange={(e) => setReportDetails(e.target.value)}
                        rows={3}
                        placeholder="Describe what happened..."
                        required
                        style={{
                          padding: '8px 10px',
                          borderRadius: 8,
                          border: '1px solid rgba(148, 163, 184, 0.3)',
                          background: '#0f172a',
                          color: '#f8fafc',
                          fontSize: 12,
                          fontFamily: 'inherit',
                        }}
                      />
                      <button
                        type="submit"
                        disabled={submittingReport || !reportDetails.trim()}
                        style={{
                          padding: '8px 12px',
                          borderRadius: 8,
                          border: 'none',
                          background: '#ef4444',
                          color: '#fff',
                          fontWeight: 800,
                          fontSize: 12,
                          cursor: 'pointer',
                        }}
                      >
                        {submittingReport ? 'Submitting...' : 'Submit Report'}
                      </button>
                    </form>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default ProfileModal;
