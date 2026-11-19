import React, { useMemo, useState } from 'react';
import { getCatalogItem, type CatalogItem, type InventoryItem } from '@handihotel/shared';
import {
  ArrowLeftRight,
  CheckCircle2,
  Coins,
  Lock,
  Package,
  Plus,
  ShieldCheck,
  Unlock,
  X,
} from 'lucide-react';
import { gameSocket } from '../network/socket';
import { useGameStore } from '../state/useGameStore';

export function TradeModal() {
  const activeTrade = useGameStore((s) => s.activeTrade);
  const user = useGameStore((s) => s.user);
  const inventory = useGameStore((s) => s.inventory);
  const catalog = useGameStore((s) => s.catalog);

  const [creditInput, setCreditInput] = useState<string>('');

  const catalogById = useMemo(() => {
    const map = new Map<string, CatalogItem>();
    for (const c of catalog) map.set(c.id, c);
    return map;
  }, [catalog]);

  const inventoryById = useMemo(() => {
    const map = new Map<string, InventoryItem>();
    for (const inv of inventory) map.set(inv.id, inv);
    return map;
  }, [inventory]);

  if (!activeTrade || !user) return null;

  const isInitiator = activeTrade.initiator.userId === user.id;
  const myOffer = isInitiator ? activeTrade.initiator : activeTrade.recipient;
  const partnerOffer = isInitiator ? activeTrade.recipient : activeTrade.initiator;

  const availableItems = inventory.filter(
    (inv) => !inv.placedInRoomId && !myOffer.itemIds.includes(inv.id)
  );

  const bothAccepted = myOffer.accepted && partnerOffer.accepted;
  const displayedCredits = creditInput !== '' ? creditInput : String(myOffer.credits);

  const resolveItemInfo = (itemId: string): { name: string; color: string; accent: string } => {
    const inv = inventoryById.get(itemId);
    const cat = inv
      ? catalogById.get(inv.catalogItemId) ?? getCatalogItem(inv.catalogItemId)
      : catalogById.get(itemId) ?? getCatalogItem(itemId);
    if (cat) {
      return { name: cat.name, color: cat.primaryColor, accent: cat.accentColor };
    }
    return { name: `Item #${itemId.slice(0, 6)}`, color: '#475569', accent: '#94a3b8' };
  };

  const handleAddItem = (itemId: string) => {
    if (myOffer.confirmed) return;
    const nextItems = [...myOffer.itemIds, itemId];
    gameSocket.updateTradeOffer(activeTrade.id, nextItems, myOffer.credits);
  };

  const handleRemoveItem = (itemId: string) => {
    if (myOffer.confirmed) return;
    const nextItems = myOffer.itemIds.filter((id) => id !== itemId);
    gameSocket.updateTradeOffer(activeTrade.id, nextItems, myOffer.credits);
  };

  const handleCreditsChange = (raw: string) => {
    const cleaned = raw.replace(/[^0-9]/g, '');
    setCreditInput(cleaned);
    const parsed = Math.min(user.credits, Math.max(0, Number(cleaned || '0')));
    gameSocket.updateTradeOffer(activeTrade.id, myOffer.itemIds, parsed);
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 70,
        background: 'rgba(2, 6, 23, 0.76)',
        backdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        style={{
          width: 'min(920px, 96vw)',
          maxHeight: '90vh',
          background: 'linear-gradient(160deg, rgba(15, 23, 42, 0.98), rgba(30, 41, 59, 0.97))',
          border: '1px solid rgba(251, 191, 36, 0.42)',
          borderRadius: 18,
          boxShadow: '0 24px 64px rgba(0, 0, 0, 0.7)',
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
                background: 'linear-gradient(135deg, #f59e0b, #d97706)',
                color: '#0f172a',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <ArrowLeftRight size={19} />
            </div>
            <div>
              <div style={{ fontSize: 17, fontWeight: 800 }}>
                Live Trade with {partnerOffer.username}
              </div>
              <div style={{ fontSize: 12, color: '#94a3b8' }}>
                Add items or credits, lock your offer, then confirm to swap atomically
              </div>
            </div>
          </div>

          <button
            onClick={() => gameSocket.cancelTrade(activeTrade.id)}
            aria-label="Cancel Trade"
            style={{
              background: 'rgba(239, 68, 68, 0.16)',
              border: '1px solid rgba(239, 68, 68, 0.4)',
              color: '#fca5a5',
              padding: '6px 12px',
              borderRadius: 10,
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
            }}
          >
            <X size={15} /> Cancel Trade
          </button>
        </div>

        {/* Two-sided Trade Panels */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: 18,
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            {/* MY OFFER */}
            <div
              style={{
                borderRadius: 14,
                padding: 14,
                background: 'rgba(15, 23, 42, 0.72)',
                border: myOffer.confirmed
                  ? '1px solid rgba(34, 197, 94, 0.7)'
                  : myOffer.accepted
                  ? '1px solid rgba(251, 191, 36, 0.65)'
                  : '1px solid rgba(148, 163, 184, 0.22)',
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontWeight: 800, fontSize: 14 }}>Your Offer ({user.username})</span>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 800,
                    padding: '3px 9px',
                    borderRadius: 999,
                    background: myOffer.confirmed
                      ? 'rgba(34, 197, 94, 0.2)'
                      : myOffer.accepted
                      ? 'rgba(251, 191, 36, 0.2)'
                      : 'rgba(148, 163, 184, 0.16)',
                    color: myOffer.confirmed
                      ? '#4ade80'
                      : myOffer.accepted
                      ? '#fbbf24'
                      : '#cbd5e1',
                  }}
                >
                  {myOffer.confirmed ? 'Confirmed' : myOffer.accepted ? 'Locked' : 'Editing'}
                </span>
              </div>

              {/* My Offered Items */}
              <div
                style={{
                  minHeight: 110,
                  borderRadius: 10,
                  padding: 8,
                  background: 'rgba(30, 41, 59, 0.55)',
                  border: '1px solid rgba(148, 163, 184, 0.14)',
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 6,
                  alignContent: 'flex-start',
                }}
              >
                {myOffer.itemIds.length === 0 ? (
                  <div style={{ fontSize: 12, color: '#64748b', margin: 'auto' }}>
                    Click items below to add them to your offer
                  </div>
                ) : (
                  myOffer.itemIds.map((itemId) => {
                    const info = resolveItemInfo(itemId);
                    return (
                      <button
                        key={itemId}
                        onClick={() => handleRemoveItem(itemId)}
                        title="Click to remove from offer"
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6,
                          padding: '5px 9px',
                          borderRadius: 8,
                          border: '1px solid rgba(148, 163, 184, 0.3)',
                          background: 'rgba(15, 23, 42, 0.85)',
                          color: '#f8fafc',
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: myOffer.confirmed ? 'default' : 'pointer',
                        }}
                      >
                        <span
                          style={{
                            width: 10,
                            height: 10,
                            borderRadius: 3,
                            background: info.color,
                          }}
                        />
                        {info.name}
                        {!myOffer.confirmed && <X size={12} color="#f87171" />}
                      </button>
                    );
                  })
                )}
              </div>

              {/* Credits Input */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 10,
                  padding: '8px 10px',
                  borderRadius: 10,
                  background: 'rgba(30, 41, 59, 0.65)',
                }}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: '#fbbf24' }}>
                  <Coins size={15} /> Credits Offer
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input
                    type="text"
                    inputMode="numeric"
                    disabled={myOffer.confirmed}
                    value={displayedCredits}
                    onChange={(e) => handleCreditsChange(e.target.value)}
                    style={{
                      width: 90,
                      padding: '5px 8px',
                      borderRadius: 7,
                      border: '1px solid rgba(251, 191, 36, 0.4)',
                      background: 'rgba(15, 23, 42, 0.9)',
                      color: '#fde68a',
                      fontWeight: 800,
                      fontSize: 13,
                      textAlign: 'right',
                      outline: 'none',
                    }}
                  />
                  <span style={{ fontSize: 11, color: '#94a3b8' }}>/ {user.credits}</span>
                </div>
              </div>
            </div>

            {/* PARTNER OFFER */}
            <div
              style={{
                borderRadius: 14,
                padding: 14,
                background: 'rgba(15, 23, 42, 0.72)',
                border: partnerOffer.confirmed
                  ? '1px solid rgba(34, 197, 94, 0.7)'
                  : partnerOffer.accepted
                  ? '1px solid rgba(251, 191, 36, 0.65)'
                  : '1px solid rgba(148, 163, 184, 0.22)',
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontWeight: 800, fontSize: 14 }}>
                  {partnerOffer.username}&apos;s Offer
                </span>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 800,
                    padding: '3px 9px',
                    borderRadius: 999,
                    background: partnerOffer.confirmed
                      ? 'rgba(34, 197, 94, 0.2)'
                      : partnerOffer.accepted
                      ? 'rgba(251, 191, 36, 0.2)'
                      : 'rgba(148, 163, 184, 0.16)',
                    color: partnerOffer.confirmed
                      ? '#4ade80'
                      : partnerOffer.accepted
                      ? '#fbbf24'
                      : '#cbd5e1',
                  }}
                >
                  {partnerOffer.confirmed
                    ? 'Confirmed'
                    : partnerOffer.accepted
                    ? 'Locked'
                    : 'Waiting...'}
                </span>
              </div>

              <div
                style={{
                  minHeight: 110,
                  borderRadius: 10,
                  padding: 8,
                  background: 'rgba(30, 41, 59, 0.55)',
                  border: '1px solid rgba(148, 163, 184, 0.14)',
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 6,
                  alignContent: 'flex-start',
                }}
              >
                {partnerOffer.itemIds.length === 0 ? (
                  <div style={{ fontSize: 12, color: '#64748b', margin: 'auto' }}>
                    No items offered yet
                  </div>
                ) : (
                  partnerOffer.itemIds.map((itemId) => {
                    const info = resolveItemInfo(itemId);
                    return (
                      <div
                        key={itemId}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6,
                          padding: '5px 9px',
                          borderRadius: 8,
                          border: '1px solid rgba(148, 163, 184, 0.3)',
                          background: 'rgba(15, 23, 42, 0.85)',
                          color: '#f8fafc',
                          fontSize: 12,
                          fontWeight: 600,
                        }}
                      >
                        <span
                          style={{
                            width: 10,
                            height: 10,
                            borderRadius: 3,
                            background: info.color,
                          }}
                        />
                        {info.name}
                      </div>
                    );
                  })
                )}
              </div>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 10px',
                  borderRadius: 10,
                  background: 'rgba(30, 41, 59, 0.65)',
                }}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: '#fbbf24' }}>
                  <Coins size={15} /> Credits Offered
                </span>
                <span style={{ fontSize: 15, fontWeight: 800, color: '#fde68a' }}>
                  {partnerOffer.credits.toLocaleString()}
                </span>
              </div>
            </div>
          </div>

          {/* Inventory Picker */}
          <div
            style={{
              borderRadius: 14,
              padding: 12,
              background: 'rgba(15, 23, 42, 0.6)',
              border: '1px solid rgba(148, 163, 184, 0.16)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: '#94a3b8', marginBottom: 8 }}>
              <Package size={14} /> Your Available Inventory ({availableItems.length})
            </div>
            {availableItems.length === 0 ? (
              <div style={{ fontSize: 12, color: '#64748b', padding: 12, textAlign: 'center' }}>
                No unplaced items available to add.
              </div>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 130, overflowY: 'auto' }}>
                {availableItems.map((inv) => {
                  const info = resolveItemInfo(inv.id);
                  return (
                    <button
                      key={inv.id}
                      disabled={myOffer.confirmed}
                      onClick={() => handleAddItem(inv.id)}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '6px 10px',
                        borderRadius: 8,
                        border: '1px solid rgba(148, 163, 184, 0.25)',
                        background: 'rgba(30, 41, 59, 0.85)',
                        color: '#e2e8f0',
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: myOffer.confirmed ? 'not-allowed' : 'pointer',
                      }}
                    >
                      <span style={{ width: 9, height: 9, borderRadius: 3, background: info.color }} />
                      {info.name}
                      <Plus size={12} color="#38bdf8" />
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '14px 20px',
            borderTop: '1px solid rgba(148, 163, 184, 0.16)',
            background: 'rgba(15, 23, 42, 0.85)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#94a3b8' }}>
            <ShieldCheck size={16} color="#38bdf8" />
            {bothAccepted
              ? 'Both players locked offers! Click Confirm Trade to complete.'
              : 'Modifying an offer resets both locks for safety.'}
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={() => gameSocket.acceptTrade(activeTrade.id, !myOffer.accepted)}
              style={{
                padding: '10px 16px',
                borderRadius: 10,
                border: '1px solid rgba(251, 191, 36, 0.5)',
                background: myOffer.accepted
                  ? 'rgba(251, 191, 36, 0.2)'
                  : 'rgba(30, 41, 59, 0.9)',
                color: '#fde68a',
                fontWeight: 800,
                fontSize: 13,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              {myOffer.accepted ? <Unlock size={15} /> : <Lock size={15} />}
              {myOffer.accepted ? 'Unlock Offer' : 'Lock Offer'}
            </button>

            <button
              disabled={!bothAccepted || myOffer.confirmed}
              onClick={() => gameSocket.confirmTrade(activeTrade.id)}
              style={{
                padding: '10px 18px',
                borderRadius: 10,
                border: 'none',
                background:
                  bothAccepted && !myOffer.confirmed
                    ? 'linear-gradient(135deg, #22c55e, #16a34a)'
                    : 'rgba(71, 85, 105, 0.5)',
                color: bothAccepted && !myOffer.confirmed ? '#052e16' : '#94a3b8',
                fontWeight: 800,
                fontSize: 13,
                cursor: bothAccepted && !myOffer.confirmed ? 'pointer' : 'not-allowed',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <CheckCircle2 size={15} />
              {myOffer.confirmed ? 'Confirmed (Waiting)' : 'Confirm Trade'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default TradeModal;
