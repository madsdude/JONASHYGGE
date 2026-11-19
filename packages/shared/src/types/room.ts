export type RoomTemplateId =
  | 'studio'
  | 'suite'
  | 'penthouse'
  | 'lounge'
  | 'club'
  | 'pool'
  | 'arena'
  | 'lobby';

export type RoomTheme =
  | 'lobby'
  | 'reception'
  | 'lounge'
  | 'restaurant'
  | 'nightclub'
  | 'pool'
  | 'arcade'
  | 'rooftop'
  | 'corridor'
  | 'race_arena'
  | 'event_hall'
  | 'private';

export type FloorStyle =
  | 'wood_oak'
  | 'wood_dark'
  | 'marble_white'
  | 'marble_gold'
  | 'checkerboard'
  | 'carpet_red'
  | 'carpet_blue'
  | 'tile_pool'
  | 'neon_grid'
  | 'track_asphalt'
  | 'concrete'
  | 'grass';

export type WallStyle =
  | 'cream_plaster'
  | 'royal_blue'
  | 'warm_brick'
  | 'dark_club'
  | 'marble_panel'
  | 'pastel_mint'
  | 'sunset_orange'
  | 'glass_skyline'
  | 'retro_arcade'
  | 'hotel_gold';

export type RoomAccessMode = 'open' | 'locked' | 'friends_only' | 'password';

/** 4-way furniture rotation: 0 = 0deg, 1 = 90deg, 2 = 180deg, 3 = 270deg clockwise */
export type Rotation4 = 0 | 1 | 2 | 3;

/** 8-way avatar facing direction: 0 = N, 1 = NE, 2 = E, 3 = SE, 4 = S, 5 = SW, 6 = W, 7 = NW */
export type Direction8 = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface TileCoord {
  x: number;
  y: number;
  z?: number;
}

export interface RoomPermissions {
  accessMode: RoomAccessMode;
  allowTrading: boolean;
  allowWalkThrough: boolean;
  maxUsers: number;
  bannedUserIds: string[];
  moderatorUserIds: string[];
}

export interface PlacedFurniture {
  id: string;
  roomId: string;
  catalogItemId: string;
  ownerId: string;
  x: number;
  y: number;
  z: number;
  rotation: Rotation4;
  state: Record<string, unknown>;
}

export interface RoomSummary {
  id: string;
  name: string;
  description: string;
  ownerId: string;
  ownerUsername: string;
  isPublic: boolean;
  templateId: RoomTemplateId;
  theme: RoomTheme;
  userCount: number;
  maxUsers: number;
  likes: number;
  accessMode: RoomAccessMode;
  tags: string[];
}

export interface RoomState {
  id: string;
  name: string;
  description: string;
  ownerId: string;
  ownerUsername: string;
  isPublic: boolean;
  templateId: RoomTemplateId;
  theme: RoomTheme;
  width: number;
  height: number;
  spawnX: number;
  spawnY: number;
  floorStyle: FloorStyle;
  wallStyle: WallStyle;
  wallColor: string;
  floorColor: string;
  permissions: RoomPermissions;
  likes: number;
  tags: string[];
  furniture: PlacedFurniture[];
  /** Optional 2D elevation map [y][x] where -1 means hole/void, >= 0 is floor elevation */
  heightMap?: number[][];
}

export interface RoomTemplateSpec {
  id: RoomTemplateId;
  name: string;
  description: string;
  width: number;
  height: number;
  spawnX: number;
  spawnY: number;
  defaultFloorStyle: FloorStyle;
  defaultWallStyle: WallStyle;
  defaultFloorColor: string;
  defaultWallColor: string;
  maxUsers: number;
}

export const ROOM_TEMPLATES: Record<RoomTemplateId, RoomTemplateSpec> = {
  studio: {
    id: 'studio',
    name: 'Cozy Studio',
    description: 'Compact starter room with easy wheelchair-friendly layout.',
    width: 10,
    height: 10,
    spawnX: 2,
    spawnY: 8,
    defaultFloorStyle: 'wood_oak',
    defaultWallStyle: 'cream_plaster',
    defaultFloorColor: '#C89B6E',
    defaultWallColor: '#F5EFE6',
    maxUsers: 15,
  },
  suite: {
    id: 'suite',
    name: 'Deluxe Suite',
    description: 'Spacious hotel suite with room for lounging and parties.',
    width: 14,
    height: 12,
    spawnX: 2,
    spawnY: 10,
    defaultFloorStyle: 'marble_white',
    defaultWallStyle: 'royal_blue',
    defaultFloorColor: '#ECEFF4',
    defaultWallColor: '#2B4C7E',
    maxUsers: 25,
  },
  penthouse: {
    id: 'penthouse',
    name: 'Sky Penthouse',
    description: 'Luxury top-floor penthouse with panoramic skyline walls.',
    width: 16,
    height: 14,
    spawnX: 2,
    spawnY: 12,
    defaultFloorStyle: 'wood_dark',
    defaultWallStyle: 'glass_skyline',
    defaultFloorColor: '#5C4033',
    defaultWallColor: '#1E293B',
    maxUsers: 35,
  },
  lounge: {
    id: 'lounge',
    name: 'Velvet Lounge',
    description: 'Warm social lounge built for trading and chilling.',
    width: 14,
    height: 14,
    spawnX: 3,
    spawnY: 11,
    defaultFloorStyle: 'carpet_red',
    defaultWallStyle: 'warm_brick',
    defaultFloorColor: '#7F1D1D',
    defaultWallColor: '#78350F',
    maxUsers: 30,
  },
  club: {
    id: 'club',
    name: 'Neon Club',
    description: 'High-energy dance floor ready for DJs and dance battles.',
    width: 16,
    height: 14,
    spawnX: 2,
    spawnY: 12,
    defaultFloorStyle: 'neon_grid',
    defaultWallStyle: 'dark_club',
    defaultFloorColor: '#111827',
    defaultWallColor: '#090D16',
    maxUsers: 40,
  },
  pool: {
    id: 'pool',
    name: 'Pool Deck',
    description: 'Sunny rooftop deck with shallow splash zones and ramps.',
    width: 16,
    height: 14,
    spawnX: 2,
    spawnY: 12,
    defaultFloorStyle: 'tile_pool',
    defaultWallStyle: 'pastel_mint',
    defaultFloorColor: '#38BDF8',
    defaultWallColor: '#A7F3D0',
    maxUsers: 35,
  },
  arena: {
    id: 'arena',
    name: 'Turbo Arena',
    description: 'Wide open competition track for races and Hotel Olympics.',
    width: 20,
    height: 16,
    spawnX: 2,
    spawnY: 8,
    defaultFloorStyle: 'track_asphalt',
    defaultWallStyle: 'sunset_orange',
    defaultFloorColor: '#334155',
    defaultWallColor: '#EA580C',
    maxUsers: 50,
  },
  lobby: {
    id: 'lobby',
    name: 'Grand Lobby',
    description: 'Monumental hotel hall for big gatherings and events.',
    width: 18,
    height: 16,
    spawnX: 9,
    spawnY: 14,
    defaultFloorStyle: 'marble_gold',
    defaultWallStyle: 'hotel_gold',
    defaultFloorColor: '#F3E8D2',
    defaultWallColor: '#B45309',
    maxUsers: 60,
  },
};
