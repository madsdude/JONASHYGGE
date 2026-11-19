import React, { useEffect, useMemo, useState } from 'react';
import {
  CATALOG_ITEMS,
  type CatalogItem,
  type ItemCategory,
  type ItemRarity,
} from '@handihotel/shared';
import {
  Accessibility,
  Armchair,
  Check,
  Coins,
  Gamepad2,
  Lamp,
  Layers,
  Package,
  Search,
  ShoppingBag,
  Sparkles,
  Star,
  Waves,
  X,
} from 'lucide-react';
import { audioManager } from '../audio/AudioManager';
import { api } from '../network/api';
import { useGameStore } from '../state/useGameStore';

type ShopTab = 'furniture' | 'cosmetics';

const RARITY_STYLES: Record<
  ItemRarity,
  { label: string; bg: string; border: string; text: string; glow?: string }
> = {
  common: {
    label: 'Common',
    bg: 'rgba(148, 163, 184, 0.16)',
    border: 'rgba(148, 163, 184, 0.4)',
    text: '#cbd5e1',
  },
  uncommon: {
    label: 'Uncommon',
    bg: 'rgba(34, 197, 94, 0.16)',
    border: 'rgba(34, 197, 94, 0.45)',
    text: '#4ade80',
  },
  rare: {
    label: 'Rare',
    bg: 'rgba(56, 189, 248, 0.18)',
    border: 'rgba(56, 189, 248, 0.5)',
    text: '#38bdf8',
  },
  epic: {
    label: 'Epic',
    bg: 'rgba(168, 85, 247, 0.2)',
    border: 'rgba(168, 85, 247, 0.55)',
    text: '#c084fc',
  },
  legendary: {
    label: 'Legendary',
    bg: 'rgba(245, 158, 11, 0.22)',
    border: 'rgba(251, 191, 36, 0.7)',
    text: '#fbbf24',
    glow: '0 0 14px rgba(251, 191, 36, 0.28)',
  },
};

const FURNITURE_CATEGORIES: { id: 'all' | Exclude<ItemCategory, 'cosmetic'>; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'seating', label: 'Seating' },
  { id: 'tables', label: 'Tables' },
  { id: 'lighting', label: 'Lighting' },
  { id: 'decor', label: 'Decor' },
  { id: 'entertainment', label: 'Entertainment' },
  { id: 'hotel', label: 'Hotel' },
  { id: 'pool', label: 'Pool' },
  { id: 'accessibility', label: 'Accessibility' },
  { id: 'floor_rug', label: 'Floor & Rugs' },
];

const COSMETIC_SLOTS: { id: string; label: string }[] = [
  { id: 'all', label: 'All Cosmetics' },
  { id: 'mobilityAid', label: 'Mobility Aids' },
  { id: 'accessory', label: 'Accessories' },
  { id: 'hairStyle', label: 'Hair' },
  { id: 'shirtStyle', label: 'Outfits' },
  { id: 'expression', label: 'Expressions' },
];

function getCategoryIcon(category: ItemCategory) {
  switch (category) {
    case 'seating':
      return <Armchair size={26} />;
    case 'lighting':
      return <Lamp size={26} />;
    case 'entertainment':
      return <Gamepad2 size={26} />;
    case 'pool':
      return <Waves size={26} />;
    case 'accessibility':
      return <Accessibility size={26} />;
    case 'cosmetic':
      return <Sparkles size={26} />;
    case 'floor_rug':
      return <Layers size={26} />;
    default:
      return <Package size={26} />;
  }
}

export function ShopModal() {
  const activeModal = useGameStore((s) => s.activeModal);
  const setActiveModal = useGameStore((s) => s.setActiveModal);
  const user = useGameStore((s) => s.user);
  const catalog = useGameStore((s) => s.catalog);
  const setCatalog = useGameStore((s) => s.setCatalog);
  const inventory = useGameStore((s) => s.inventory);
  const addInventoryItem = useGameStore((s) => s.addInventoryItem);
  const updateBalance = useGameStore((s) => s.updateBalance);
  const addNotification = useGameStore((s) => s.addNotification);

  const [tab, setTab] = useState<ShopTab>('furniture');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [purchasingId, setPurchasingId] = useState<string | null>(null);
  const [justBoughtId, setJustBoughtId] = useState<string | null>(null);

  useEffect(() => {
    if (activeModal !== 'shop') return;
    if (catalog.length === 0) {
      api
        .getCatalog()
        .then((items) => {
          if (items.length > 0) setCatalog(items);
        })
        .catch(() => {
          // Fallback to shared catalog items
        });
    }
  }, [activeModal, catalog.length, setCatalog]);

  const itemsSource = useMemo<readonly CatalogItem[]>(
    () => (catalog.length > 0 ? catalog : CATALOG_ITEMS),
    [catalog]
  );

  const ownedCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const inv of inventory) {
      map.set(inv.catalogItemId, (map.get(inv.catalogItemId) ?? 0) + 1);
    }
    return map;
  }, [inventory]);

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return itemsSource.filter((item) => {
      const isCosmetic = item.category === 'cosmetic';
      if (tab === 'cosmetics' && !isCosmetic) return false;
      if (tab === 'furniture' && isCosmetic) return false;

      if (categoryFilter !== 'all') {
        if (tab === 'furniture' && item.category !== categoryFilter) return false;
        if (tab === 'cosmetics' && item.cosmeticSlot !== categoryFilter) return false;
      }

      if (q) {
        const hay = `${item.name} ${item.description} ${item.category} ${item.rarity}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [itemsSource, tab, categoryFilter, search]);

  const selectedItem = useMemo(() => {
    if (selectedItemId) {
      const found = filteredItems.find((i) => i.id === selectedItemId);
      if (found) return found;
    }
    return filteredItems[0] ?? null;
  }, [filteredItems, selectedItemId]);

  if (activeModal !== 'shop') return null;

  const credits = user?.credits ?? 0;
  const stars = user?.stars ?? 0;

  const handlePurchase = async (item: CatalogItem) => {
    if (!user || purchasingId) return;
    if (credits < item.priceCredits || stars < item.priceStars) {
      addNotification({
        type: 'warning',
        title: 'Not Enough Funds',
        message: `You need ${item.priceCredits} Credits${
          item.priceStars > 0 ? ` and ${item.priceStars} Stars` : ''
        } to buy ${item.name}.`,
      });
      return;
    }

    setPurchasingId(item.id);
    try {
      const res = await api.purchaseItem(item.id, 1);
      updateBalance(res.credits, res.stars);
      if (res.item) {
        addInventoryItem(res.item);
      }
      audioManager.playCoin();
      setJustBoughtId(item.id);
      setTimeout(() => setJustBoughtId((cur) => (cur === item.id ? null : cur)), 1400);
      addNotification({
        type: 'success',
        title: 'Item Purchased!',
        message: `${item.name} was added to your inventory.`,
      });
    } catch (err) {
      addNotification({
        type: 'error',
        title: 'Purchase Failed',
        message: err instanceof Error ? err.message : 'Could not complete purchase.',
      });
    } finally {
      setPurchasingId(null);
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
          width: 'min(1040px, 96vw)',
          height: 'min(700px, 90vh)',
          background: 'linear-gradient(160deg, rgba(15, 23, 42, 0.98), rgba(30, 41, 59, 0.97))',
          border: '1px solid rgba(251, 191, 36, 0.32)',
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
                background: 'linear-gradient(135deg, #f59e0b, #d97706)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#0f172a',
              }}
            >
              <ShoppingBag size={20} />
            </div>
            <div>
              <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: 0.2 }}>
                HandiHotel Catalog Shop
              </div>
              <div style={{ fontSize: 12, color: '#94a3b8' }}>
                Furnish your rooms and unlock stylish mobility aids &amp; cosmetics
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 12px',
                borderRadius: 999,
                background: 'rgba(251, 191, 36, 0.14)',
                border: '1px solid rgba(251, 191, 36, 0.35)',
                color: '#fbbf24',
                fontWeight: 700,
                fontSize: 13,
              }}
            >
              <Coins size={15} />
              <span>{credits.toLocaleString()}</span>
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 12px',
                borderRadius: 999,
                background: 'rgba(56, 189, 248, 0.14)',
                border: '1px solid rgba(56, 189, 248, 0.35)',
                color: '#38bdf8',
                fontWeight: 700,
                fontSize: 13,
              }}
            >
              <Star size={15} />
              <span>{stars.toLocaleString()}</span>
            </div>
            <button
              onClick={() => setActiveModal(null)}
              aria-label="Close Shop"
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

        {/* Tabs & Search */}
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
                { id: 'furniture', label: 'Furniture Shop', icon: <Armchair size={15} /> },
                { id: 'cosmetics', label: 'Cosmetics Shop', icon: <Sparkles size={15} /> },
              ] as const
            ).map((t) => {
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => {
                    setTab(t.id);
                    setCategoryFilter('all');
                    setSelectedItemId(null);
                  }}
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
                      ? '1px solid rgba(251, 191, 36, 0.65)'
                      : '1px solid rgba(148, 163, 184, 0.2)',
                    background: active
                      ? 'linear-gradient(135deg, rgba(245, 158, 11, 0.25), rgba(217, 119, 6, 0.18))'
                      : 'rgba(15, 23, 42, 0.5)',
                    color: active ? '#fde68a' : '#cbd5e1',
                  }}
                >
                  {t.icon}
                  {t.label}
                </button>
              );
            })}
          </div>

          <div
            style={{
              position: 'relative',
              width: 260,
              maxWidth: '100%',
            }}
          >
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
              placeholder="Search items..."
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

        {/* Category Filter Pills */}
        <div
          style={{
            display: 'flex',
            gap: 6,
            padding: '10px 20px',
            overflowX: 'auto',
            borderBottom: '1px solid rgba(148, 163, 184, 0.1)',
          }}
        >
          {(tab === 'furniture' ? FURNITURE_CATEGORIES : COSMETIC_SLOTS).map((cat) => {
            const active = categoryFilter === cat.id;
            return (
              <button
                key={cat.id}
                onClick={() => setCategoryFilter(cat.id)}
                style={{
                  padding: '5px 12px',
                  borderRadius: 999,
                  fontSize: 12,
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                  cursor: 'pointer',
                  border: active
                    ? '1px solid rgba(56, 189, 248, 0.7)'
                    : '1px solid rgba(148, 163, 184, 0.2)',
                  background: active ? 'rgba(56, 189, 248, 0.2)' : 'rgba(15, 23, 42, 0.5)',
                  color: active ? '#7dd3fc' : '#94a3b8',
                }}
              >
                {cat.label}
              </button>
            );
          })}
        </div>

        {/* Body: Grid + Preview Panel */}
        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          {/* Catalog Grid */}
          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: 16,
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(175px, 1fr))',
              gap: 12,
              alignContent: 'start',
            }}
          >
            {filteredItems.length === 0 ? (
              <div
                style={{
                  gridColumn: '1 / -1',
                  textAlign: 'center',
                  padding: 48,
                  color: '#94a3b8',
                  fontSize: 14,
                }}
              >
                No items match your filter. Try clearing the search box.
              </div>
            ) : (
              filteredItems.map((item) => {
                const rarity = RARITY_STYLES[item.rarity];
                const isSelected = selectedItem?.id === item.id;
                const owned = ownedCounts.get(item.id) ?? 0;

                return (
                  <button
                    key={item.id}
                    onClick={() => setSelectedItemId(item.id)}
                    style={{
                      textAlign: 'left',
                      padding: 12,
                      borderRadius: 12,
                      cursor: 'pointer',
                      background: isSelected
                        ? 'rgba(56, 189, 248, 0.14)'
                        : 'rgba(15, 23, 42, 0.65)',
                      border: isSelected
                        ? '1px solid rgba(56, 189, 248, 0.75)'
                        : `1px solid ${rarity.border}`,
                      boxShadow: rarity.glow,
                      color: '#f8fafc',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                    }}
                  >
                    {/* Visual Swatch */}
                    <div
                      style={{
                        height: 76,
                        borderRadius: 10,
                        background: `linear-gradient(135deg, ${item.primaryColor}cc, ${item.accentColor}99)`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        position: 'relative',
                        color: '#ffffff',
                        textShadow: '0 2px 6px rgba(0,0,0,0.5)',
                      }}
                    >
                      {getCategoryIcon(item.category)}
                      <span
                        style={{
                          position: 'absolute',
                          top: 6,
                          left: 6,
                          fontSize: 10,
                          fontWeight: 800,
                          textTransform: 'uppercase',
                          padding: '2px 7px',
                          borderRadius: 999,
                          background: 'rgba(15, 23, 42, 0.84)',
                          border: `1px solid ${rarity.border}`,
                          color: rarity.text,
                        }}
                      >
                        {rarity.label}
                      </span>
                      {owned > 0 && (
                        <span
                          style={{
                            position: 'absolute',
                            top: 6,
                            right: 6,
                            fontSize: 10,
                            fontWeight: 800,
                            padding: '2px 6px',
                            borderRadius: 999,
                            background: 'rgba(34, 197, 94, 0.85)',
                            color: '#052e16',
                          }}
                        >
                          ×{owned}
                        </span>
                      )}
                    </div>

                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 700,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {item.name}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 'auto' }}>
                      {item.priceCredits > 0 && (
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            fontSize: 12,
                            fontWeight: 700,
                            color: '#fbbf24',
                          }}
                        >
                          <Coins size={12} />
                          {item.priceCredits}
                        </span>
                      )}
                      {item.priceStars > 0 && (
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            fontSize: 12,
                            fontWeight: 700,
                            color: '#38bdf8',
                          }}
                        >
                          <Star size={12} />
                          {item.priceStars}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {/* Item Preview Sidebar */}
          <div
            style={{
              width: 310,
              borderLeft: '1px solid rgba(148, 163, 184, 0.16)',
              background: 'rgba(15, 23, 42, 0.72)',
              padding: 18,
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
              overflowY: 'auto',
            }}
          >
            {selectedItem ? (
              <>
                <div
                  style={{
                    height: 150,
                    borderRadius: 14,
                    background: `radial-gradient(circle at 30% 25%, ${selectedItem.accentColor}dd, ${selectedItem.primaryColor}ee)`,
                    border: `1px solid ${RARITY_STYLES[selectedItem.rarity].border}`,
                    boxShadow: RARITY_STYLES[selectedItem.rarity].glow,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 10,
                    color: '#ffffff',
                  }}
                >
                  <div
                    style={{
                      width: 58,
                      height: 58,
                      borderRadius: 16,
                      background: 'rgba(15, 23, 42, 0.45)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {getCategoryIcon(selectedItem.category)}
                  </div>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 800,
                      textTransform: 'uppercase',
                      letterSpacing: 0.7,
                      padding: '3px 10px',
                      borderRadius: 999,
                      background: 'rgba(15, 23, 42, 0.8)',
                      color: RARITY_STYLES[selectedItem.rarity].text,
                    }}
                  >
                    {RARITY_STYLES[selectedItem.rarity].label} • {selectedItem.category.replace('_', ' ')}
                  </span>
                </div>

                <div>
                  <div style={{ fontSize: 18, fontWeight: 800 }}>{selectedItem.name}</div>
                  <p style={{ fontSize: 13, color: '#cbd5e1', lineHeight: 1.45, margin: '6px 0 0' }}>
                    {selectedItem.description}
                  </p>
                </div>

                {/* Specs & Tags */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: 8,
                    padding: 10,
                    borderRadius: 10,
                    background: 'rgba(30, 41, 59, 0.65)',
                    border: '1px solid rgba(148, 163, 184, 0.14)',
                    fontSize: 12,
                  }}
                >
                  <div>
                    <div style={{ color: '#94a3b8', fontSize: 11 }}>Dimensions</div>
                    <div style={{ fontWeight: 700 }}>
                      {selectedItem.width}×{selectedItem.depth} tiles ({selectedItem.height}m)
                    </div>
                  </div>
                  <div>
                    <div style={{ color: '#94a3b8', fontSize: 11 }}>In Inventory</div>
                    <div style={{ fontWeight: 700, color: '#4ade80' }}>
                      {ownedCounts.get(selectedItem.id) ?? 0} owned
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {selectedItem.sittable && (
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        padding: '4px 9px',
                        borderRadius: 999,
                        background: 'rgba(34, 197, 94, 0.16)',
                        color: '#4ade80',
                        border: '1px solid rgba(34, 197, 94, 0.35)',
                      }}
                    >
                      Sittable
                    </span>
                  )}
                  {selectedItem.stackable && (
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        padding: '4px 9px',
                        borderRadius: 999,
                        background: 'rgba(56, 189, 248, 0.16)',
                        color: '#38bdf8',
                        border: '1px solid rgba(56, 189, 248, 0.35)',
                      }}
                    >
                      Stackable
                    </span>
                  )}
                  {selectedItem.walkable && (
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        padding: '4px 9px',
                        borderRadius: 999,
                        background: 'rgba(148, 163, 184, 0.16)',
                        color: '#cbd5e1',
                        border: '1px solid rgba(148, 163, 184, 0.35)',
                      }}
                    >
                      Walkable
                    </span>
                  )}
                  {selectedItem.interactable && (
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        padding: '4px 9px',
                        borderRadius: 999,
                        background: 'rgba(168, 85, 247, 0.18)',
                        color: '#c084fc',
                        border: '1px solid rgba(168, 85, 247, 0.4)',
                      }}
                    >
                      Interactable ({selectedItem.interactionType.replace('_', ' ')})
                    </span>
                  )}
                  {selectedItem.cosmeticSlot && (
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        padding: '4px 9px',
                        borderRadius: 999,
                        background: 'rgba(251, 191, 36, 0.16)',
                        color: '#fbbf24',
                        border: '1px solid rgba(251, 191, 36, 0.4)',
                      }}
                    >
                      Slot: {selectedItem.cosmeticSlot}
                    </span>
                  )}
                </div>

                {/* Price & Purchase Button */}
                <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '10px 12px',
                      borderRadius: 10,
                      background: 'rgba(30, 41, 59, 0.8)',
                    }}
                  >
                    <span style={{ fontSize: 12, color: '#94a3b8', fontWeight: 600 }}>Price</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      {selectedItem.priceCredits > 0 && (
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            fontSize: 15,
                            fontWeight: 800,
                            color: credits >= selectedItem.priceCredits ? '#fbbf24' : '#f87171',
                          }}
                        >
                          <Coins size={15} />
                          {selectedItem.priceCredits}
                        </span>
                      )}
                      {selectedItem.priceStars > 0 && (
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            fontSize: 15,
                            fontWeight: 800,
                            color: stars >= selectedItem.priceStars ? '#38bdf8' : '#f87171',
                          }}
                        >
                          <Star size={15} />
                          {selectedItem.priceStars}
                        </span>
                      )}
                    </div>
                  </div>

                  {(() => {
                    const canAfford =
                      credits >= selectedItem.priceCredits && stars >= selectedItem.priceStars;
                    const isBuying = purchasingId === selectedItem.id;
                    const bought = justBoughtId === selectedItem.id;

                    return (
                      <button
                        disabled={!canAfford || isBuying}
                        onClick={() => handlePurchase(selectedItem)}
                        style={{
                          width: '100%',
                          padding: '12px 16px',
                          borderRadius: 12,
                          border: 'none',
                          fontWeight: 800,
                          fontSize: 14,
                          cursor: canAfford && !isBuying ? 'pointer' : 'not-allowed',
                          background: bought
                            ? 'linear-gradient(135deg, #22c55e, #16a34a)'
                            : canAfford
                            ? 'linear-gradient(135deg, #f59e0b, #d97706)'
                            : 'rgba(71, 85, 105, 0.5)',
                          color: bought || canAfford ? '#0f172a' : '#94a3b8',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 8,
                        }}
                      >
                        {bought ? (
                          <>
                            <Check size={17} /> Purchased!
                          </>
                        ) : isBuying ? (
                          'Purchasing...'
                        ) : canAfford ? (
                          <>
                            <ShoppingBag size={16} /> Purchase Now
                          </>
                        ) : (
                          'Insufficient Funds'
                        )}
                      </button>
                    );
                  })()}
                </div>
              </>
            ) : (
              <div style={{ color: '#94a3b8', fontSize: 13, margin: 'auto' }}>
                Select an item to preview its details.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default ShopModal;
