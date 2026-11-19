export type ItemRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

export type ItemCategory =
  | 'seating'
  | 'tables'
  | 'lighting'
  | 'decor'
  | 'entertainment'
  | 'hotel'
  | 'pool'
  | 'accessibility'
  | 'floor_rug'
  | 'cosmetic';

export type InteractionType =
  | 'none'
  | 'sit'
  | 'toggle'
  | 'music'
  | 'vending'
  | 'arcade'
  | 'teleport'
  | 'dice'
  | 'disco'
  | 'jacuzzi'
  | 'elevator'
  | 'jukebox'
  | 'claw_machine'
  | 'boost_pad';

export type CosmeticSlot =
  | 'mobilityAid'
  | 'accessory'
  | 'hairStyle'
  | 'shirtStyle'
  | 'expression';

export interface CatalogItem {
  id: string;
  name: string;
  description: string;
  category: ItemCategory;
  rarity: ItemRarity;
  priceCredits: number;
  priceStars: number;
  width: number;
  depth: number;
  height: number;
  stackable: boolean;
  sittable: boolean;
  walkable: boolean;
  interactable: boolean;
  interactionType: InteractionType;
  modelType: string;
  primaryColor: string;
  accentColor: string;
  cosmeticSlot?: CosmeticSlot;
  cosmeticValue?: string;
}

export interface InventoryItem {
  id: string;
  userId: string;
  catalogItemId: string;
  acquiredAt: string;
  placedInRoomId: string | null;
}

export interface TradeOffer {
  userId: string;
  username: string;
  itemIds: string[];
  credits: number;
  accepted: boolean;
  confirmed: boolean;
}

export type TradeStatus = 'pending' | 'active' | 'confirming' | 'completed' | 'cancelled';

export interface TradeState {
  id: string;
  roomId: string;
  status: TradeStatus;
  initiator: TradeOffer;
  recipient: TradeOffer;
  createdAt: string;
}

export type TransactionType =
  | 'purchase'
  | 'sale'
  | 'trade'
  | 'daily_reward'
  | 'minigame_reward'
  | 'event_reward'
  | 'admin_grant';

export interface TransactionRecord {
  id: string;
  userId: string;
  type: TransactionType;
  creditsDelta: number;
  starsDelta: number;
  description: string;
  createdAt: string;
}

export interface DailyRewardStatus {
  canClaim: boolean;
  currentStreak: number;
  nextRewardCredits: number;
  nextRewardStars: number;
  lastClaimedAt: string | null;
  nextClaimAvailableAt: string | null;
}
