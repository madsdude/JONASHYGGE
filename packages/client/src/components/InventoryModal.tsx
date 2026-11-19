import React, { useEffect, useMemo, useState } from 'react';
import {
  getCatalogItem,
  type AvatarConfig,
  type CatalogItem,
  type InventoryItem,
  type ItemRarity,
} from '@handihotel/shared';
import {
  Armchair,
  Backpack,
  Check,
  Hammer,
  Package,
  Search,
  ShoppingBag,
  Sparkles,
  X,
} from 'lucide-react';
import { audioManager } from '../audio/AudioManager';
import { api } from '../network/api';
import { gameSocket } from '../network/socket';
import { useGameStore } from '../state/useGameStore';

type InventoryTab = 'furniture' | 'cosmetics';

interface GroupedInventoryEntry {
  catalogItem: CatalogItem;
  unplacedItems: InventoryItem[];
  placedCount: number;
  totalCount: number;
}

const RARITY_COLOR: Record<ItemRarity, string> = {
  common: '#94a3b8',
  uncommon: '#4ade80',
  rare: '#38bdf8',
  epic: '#c084fc',
  legendary: '#fbbf24',
};

export function InventoryModal() {
  const activeModal = useGameStore((s) => s.activeModal);
  const setActiveModal = useGameStore((s) => s.setActiveModal);
  const user = useGameStore((s) => s.user);
  const updateUser = useGameStore((s) => s.updateUser);
  const inventory = useGameStore((s) => s.inventory);
  const setInventory = useGameStore((s) => s.setInventory);
  const catalog = useGameStore((s) => s.catalog);
  const setPlacingItem = useGameStore((s) => s.setPlacingItem);
  const currentRoom = useGameStore((s) => s.currentRoom);
  const addNotification = useGameStore((s) => s.addNotification);

  const [tab, setTab] = useState<InventoryTab>('furniture');
  const [search, setSearch] = useState('');
  const [equippingId, setEquippingId] = useState<string | null>(null);

  useEffect(() => {
    if (activeModal !== 'inventory') return;
    api
      .getInventory()
      .then((items) => setInventory(items))
      .catch(() => {
        // Keep existing store inventory if offline
      });
  }, [activeModal, setInventory]);

  const catalogById = useMemo(() => {
    const map = new Map<string, CatalogItem>();
    for (const item of catalog) map.set(item.id, item);
    return map;
  }, [catalog]);

  const grouped = useMemo(() => {
    const groups = new Map<string, GroupedInventoryEntry>();
    for (const inv of inventory) {
      const cat = catalogById.get(inv.catalogItemId) ?? getCatalogItem(inv.catalogItemId);
      if (!cat) continue;
      let entry = groups.get(cat.id);
      if (!entry) {
        entry = {
          catalogItem: cat,
          unplacedItems: [],
          placedCount: 0,
          totalCount: 0,
        };
        groups.set(cat.id, entry);
      }
      entry.totalCount += 1;
      if (inv.placedInRoomId) {
        entry.placedCount += 1;
      } else {
        entry.unplacedItems.push(inv);
      }
    }

    const q = search.trim().toLowerCase();
    return Array.from(groups.values()).filter((entry) => {
      const isCosmetic = entry.catalogItem.category === 'cosmetic';
      if (tab === 'cosmetics' && !isCosmetic) return false;
      if (tab === 'furniture' && isCosmetic) return false;
      if (q) {
        const hay = `${entry.catalogItem.name} ${entry.catalogItem.category} ${entry.catalogItem.rarity}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [inventory, catalogById, tab, search]);

  if (activeModal !== 'inventory') return null;

  const handlePlaceInRoom = (entry: GroupedInventoryEntry) => {
    const firstUnplaced = entry.unplacedItems[0];
    if (!firstUnplaced) {
      addNotification({
        type: 'info',
        title: 'All Copies Placed',
        message: `All copies of ${entry.catalogItem.name} are already placed in rooms.`,
      });
      return;
    }
    if (!currentRoom) {
      addNotification({
        type: 'warning',
        title: 'Enter a Room First',
        message: 'Join your room to place furniture.',
      });
      return;
    }
    setPlacingItem(entry.catalogItem.id, firstUnplaced.id);
    setActiveModal(null);
    audioManager.playFurnitureRotate();
  };

  const isCosmeticEquipped = (item: CatalogItem): boolean => {
    if (!user?.avatar || !item.cosmeticSlot || !item.cosmeticValue) return false;
    return user.avatar[item.cosmeticSlot] === item.cosmeticValue;
  };

  const handleEquipCosmetic = async (item: CatalogItem) => {
    if (!user || !item.cosmeticSlot || !item.cosmeticValue || equippingId) return;
    setEquippingId(item.id);
    try {
      const nextAvatar: AvatarConfig = {
        ...user.avatar,
        [item.cosmeticSlot]: item.cosmeticValue,
      };
      if (item.cosmeticSlot === 'mobilityAid') {
        nextAvatar.mobilityAidColor = item.primaryColor;
      } else if (item.cosmeticSlot === 'accessory') {
        nextAvatar.accessoryColor = item.accentColor || item.primaryColor;
      }
      const res = await api.updateAvatar(nextAvatar);
      const updatedAvatar = res.user?.avatar ?? nextAvatar;
      updateUser({ avatar: updatedAvatar });
      gameSocket.broadcastAvatarUpdate(updatedAvatar, user.motto);
      audioManager.playCoin();
      addNotification({
        type: 'success',
        title: 'Cosmetic Equipped!',
        message: `You are now wearing ${item.name}.`,
      });
    } catch (err) {
      addNotification({
        type: 'error',
        title: 'Equip Failed',
        message: err instanceof Error ? err.message : 'Could not equip cosmetic.',
      });
    } finally {
      setEquippingId(null);
    }
  };

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
          width: 'min(900px, 95vw)',
          height: 'min(640px, 88vh)',
          background: 'linear-gradient(160deg, rgba(15, 23, 42, 0.98), rgba(30, 41, 59, 0.97))',
          border: '1px solid rgba(56, 189, 248, 0.32)',
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
            background: 'rgba(15, 23, 42, 0.75)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 10,
                background: 'linear-gradient(135deg, #38bdf8, #2563eb)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#0f172a',
              }}
            >
              <Backpack size={20} />
            </div>
            <div>
              <div style={{ fontSize: 18, fontWeight: 800 }}>My Inventory</div>
              <div style={{ fontSize: 12, color: '#94a3b8' }}>
                {inventory.length} total item{inventory.length === 1 ? '' : 's'} owned
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              onClick={() => setActiveModal('shop')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '7px 12px',
                borderRadius: 10,
                border: '1px solid rgba(251, 191, 36, 0.4)',
                background: 'rgba(251, 191, 36, 0.14)',
                color: '#fde68a',
                fontWeight: 700,
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              <ShoppingBag size={14} /> Open Shop
            </button>
            <button
              onClick={() => setActiveModal(null)}
              aria-label="Close Inventory"
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
        </div>

        {/* Tabs + Search */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '12px 20px',
            borderBottom: '1px solid rgba(148, 163, 184, 0.12)',
          }}
        >
          <div style={{ display: 'flex', gap: 8 }}>
            {(
              [
                { id: 'furniture', label: 'Furniture', icon: <Armchair size={15} /> },
                { id: 'cosmetics', label: 'Cosmetics', icon: <Sparkles size={15} /> },
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
                    gap: 7,
                    padding: '8px 16px',
                    borderRadius: 10,
                    fontSize: 13,
                    fontWeight: 700,
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
                </button>
              );
            })}
          </div>

          <div style={{ position: 'relative', width: 240, maxWidth: '100%' }}>
            <Search
              size={15}
              style={{
                position: 'absolute',
                left: 11,
                top: '50%',
                transform: 'translateY(-50%)',
                color: '#94a3b8',
              }}
            />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search inventory..."
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '8px 12px 8px 34px',
                borderRadius: 10,
                border: '1px solid rgba(148, 163, 184, 0.25)',
                background: 'rgba(15, 23, 42, 0.75)',
                color: '#f8fafc',
                fontSize: 13,
                outline: 'none',
              }}
            />
          </div>
        </div>

        {/* Grid */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: 18,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            gap: 14,
            alignContent: 'start',
          }}
        >
          {grouped.length === 0 ? (
            <div
              style={{
                gridColumn: '1 / -1',
                textAlign: 'center',
                padding: 56,
                color: '#94a3b8',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 12,
              }}
            >
              <Package size={36} style={{ opacity: 0.5 }} />
              <div style={{ fontSize: 15, fontWeight: 700, color: '#cbd5e1' }}>
                No {tab} in your inventory yet
              </div>
              <button
                onClick={() => setActiveModal('shop')}
                style={{
                  padding: '9px 16px',
                  borderRadius: 10,
                  border: 'none',
                  background: 'linear-gradient(135deg, #f59e0b, #d97706)',
                  color: '#0f172a',
                  fontWeight: 800,
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                Browse Catalog Shop
              </button>
            </div>
          ) : (
            grouped.map((entry) => {
              const { catalogItem, unplacedItems, placedCount, totalCount } = entry;
              const equipped = isCosmeticEquipped(catalogItem);
              const rarityColor = RARITY_COLOR[catalogItem.rarity];

              return (
                <div
                  key={catalogItem.id}
                  style={{
                    borderRadius: 14,
                    background: 'rgba(15, 23, 42, 0.72)',
                    border: `1px solid ${rarityColor}55`,
                    padding: 12,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                  }}
                >
                  <div
                    style={{
                      height: 84,
                      borderRadius: 10,
                      background: `linear-gradient(135deg, ${catalogItem.primaryColor}cc, ${catalogItem.accentColor}99)`,
                      position: 'relative',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#fff',
                    }}
                  >
                    {catalogItem.category === 'cosmetic' ? (
                      <Sparkles size={26} />
                    ) : (
                      <Armchair size={26} />
                    )}
                    <span
                      style={{
                        position: 'absolute',
                        top: 6,
                        right: 6,
                        padding: '2px 8px',
                        borderRadius: 999,
                        fontSize: 11,
                        fontWeight: 800,
                        background: 'rgba(15, 23, 42, 0.88)',
                        color: '#f8fafc',
                        border: '1px solid rgba(148, 163, 184, 0.35)',
                      }}
                    >
                      ×{tab === 'furniture' ? unplacedItems.length : totalCount}
                    </span>
                    <span
                      style={{
                        position: 'absolute',
                        bottom: 6,
                        left: 6,
                        padding: '2px 7px',
                        borderRadius: 999,
                        fontSize: 10,
                        fontWeight: 800,
                        textTransform: 'uppercase',
                        background: 'rgba(15, 23, 42, 0.85)',
                        color: rarityColor,
                      }}
                    >
                      {catalogItem.rarity}
                    </span>
                  </div>

                  <div>
                    <div
                      style={{
                        fontSize: 14,
                        fontWeight: 700,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {catalogItem.name}
                    </div>
                    <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
                      {tab === 'furniture'
                        ? `${unplacedItems.length} available${
                            placedCount > 0 ? ` • ${placedCount} placed` : ''
                          }`
                        : `Slot: ${catalogItem.cosmeticSlot ?? 'cosmetic'}`}
                    </div>
                  </div>

                  {tab === 'furniture' ? (
                    <button
                      disabled={unplacedItems.length === 0}
                      onClick={() => handlePlaceInRoom(entry)}
                      style={{
                        marginTop: 'auto',
                        width: '100%',
                        padding: '9px 12px',
                        borderRadius: 10,
                        border: 'none',
                        fontWeight: 700,
                        fontSize: 12,
                        cursor: unplacedItems.length > 0 ? 'pointer' : 'not-allowed',
                        background:
                          unplacedItems.length > 0
                            ? 'linear-gradient(135deg, #38bdf8, #2563eb)'
                            : 'rgba(71, 85, 105, 0.4)',
                        color: unplacedItems.length > 0 ? '#0f172a' : '#94a3b8',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 6,
                      }}
                    >
                      <Hammer size={14} />
                      {unplacedItems.length > 0 ? 'Place in Room' : 'All Placed'}
                    </button>
                  ) : (
                    <button
                      disabled={equipped || equippingId === catalogItem.id}
                      onClick={() => handleEquipCosmetic(catalogItem)}
                      style={{
                        marginTop: 'auto',
                        width: '100%',
                        padding: '9px 12px',
                        borderRadius: 10,
                        border: 'none',
                        fontWeight: 700,
                        fontSize: 12,
                        cursor: equipped ? 'default' : 'pointer',
                        background: equipped
                          ? 'rgba(34, 197, 94, 0.2)'
                          : 'linear-gradient(135deg, #a855f7, #7c3aed)',
                        color: equipped ? '#4ade80' : '#ffffff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 6,
                      }}
                    >
                      {equipped ? (
                        <>
                          <Check size={14} /> Equipped
                        </>
                      ) : equippingId === catalogItem.id ? (
                        'Equipping...'
                      ) : (
                        <>
                          <Sparkles size={14} /> Equip
                        </>
                      )}
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

export default InventoryModal;
