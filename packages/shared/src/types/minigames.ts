import type { AvatarConfig } from './avatar.js';

export type MinigameType =
  | 'wheelchair_racing'
  | 'hotel_olympics'
  | 'dance_battle'
  | 'furniture_chaos';

export type MinigameStatus = 'lobby' | 'countdown' | 'playing' | 'finished';

export interface RaceTrackCheckpoint {
  index: number;
  x: number;
  y: number;
  radius: number;
  isBoostPad?: boolean;
}

export interface DancePrompt {
  id: string;
  stepIndex: number;
  key: 'up' | 'down' | 'left' | 'right' | 'space';
  targetTimeMs: number;
  windowMs: number;
}

export interface ChaosHazard {
  id: string;
  kind: 'falling_sofa' | 'rolling_luggage' | 'slippery_spill' | 'flying_duck' | 'golden_star';
  x: number;
  y: number;
  radius: number;
  expiresAt: number;
  points?: number;
}

export interface MinigamePlayerState {
  userId: string;
  username: string;
  avatar: AvatarConfig;
  score: number;
  ready: boolean;
  finished: boolean;
  eliminated: boolean;
  rank: number;
  lap?: number;
  checkpointIndex?: number;
  combo?: number;
  speedBoostUntil?: number;
  x?: number;
  y?: number;
}

export interface MinigameSessionState {
  id: string;
  type: MinigameType;
  roomId: string;
  status: MinigameStatus;
  hostUserId: string;
  players: MinigamePlayerState[];
  startedAt: number | null;
  endsAt: number | null;
  countdownSeconds: number;
  totalLaps?: number;
  checkpoints?: RaceTrackCheckpoint[];
  currentPrompt?: DancePrompt | null;
  activeHazards?: ChaosHazard[];
  olympicsRound?: 'sprint' | 'slalom' | 'target_toss';
  winnerUserId?: string | null;
  rewardCredits: number;
  rewardStars: number;
}

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  username: string;
  avatar: AvatarConfig;
  score: number;
  wins: number;
  gamesPlayed: number;
  minigameType: MinigameType;
}

export interface HotelEventInfo {
  id: string;
  title: string;
  description: string;
  roomId: string;
  roomName: string;
  hostUsername: string;
  startsAt: string;
  endsAt: string;
  active: boolean;
  rewardCredits: number;
  rewardStars: number;
  minigameType?: MinigameType;
}
