import { v4 as uuidv4 } from 'uuid';
import {
  AVATAR_PRESETS,
  type ChaosHazard,
  type DancePrompt,
  type EmoteType,
  type MinigameActionPayload,
  type MinigamePlayerState,
  type MinigameSessionState,
  type MinigameType,
  type RaceTrackCheckpoint,
} from '@handihotel/shared';
import type { IDataStore } from '../db/store.js';
import type { RoomManager } from './roomManager.js';
import { getSocketUser, type GameIO, type GameSocket, type SocialManager } from './socialManager.js';

interface ActiveMinigameRuntime {
  state: MinigameSessionState;
  tickTimer: NodeJS.Timeout | null;
  countdownTimer: NodeJS.Timeout | null;
  promptIndex: number;
  lastPromptAt: number;
  lastHazardAt: number;
  olympicsStageIndex: number;
  playerHits: Map<string, number>;
  answeredPromptUsers: Set<string>;
}

const DANCE_KEYS: readonly DancePrompt['key'][] = ['up', 'down', 'left', 'right', 'space'];
const DANCE_EMOTE_BY_KEY: Record<DancePrompt['key'], EmoteType> = {
  up: 'cheer',
  down: 'dance',
  left: 'wave',
  right: 'clap',
  space: 'wheelie',
};

const OLYMPICS_ROUNDS: readonly ('sprint' | 'slalom' | 'target_toss')[] = [
  'sprint',
  'slalom',
  'target_toss',
];

const RACE_CHECKPOINTS: RaceTrackCheckpoint[] = [
  { index: 0, x: 5, y: 4, radius: 2, isBoostPad: false },
  { index: 1, x: 10, y: 3, radius: 2, isBoostPad: true },
  { index: 2, x: 15, y: 5, radius: 2, isBoostPad: false },
  { index: 3, x: 15, y: 11, radius: 2, isBoostPad: false },
  { index: 4, x: 10, y: 12, radius: 2, isBoostPad: true },
  { index: 5, x: 4, y: 10, radius: 2, isBoostPad: false },
];

const GAME_CONFIG: Record<
  MinigameType,
  { durationMs: number; rewardCredits: number; rewardStars: number; label: string }
> = {
  wheelchair_racing: {
    durationMs: 75_000,
    rewardCredits: 200,
    rewardStars: 10,
    label: 'Turbo Wheelchair Racing',
  },
  hotel_olympics: {
    durationMs: 60_000,
    rewardCredits: 180,
    rewardStars: 9,
    label: 'Hotel Olympics',
  },
  dance_battle: {
    durationMs: 55_000,
    rewardCredits: 160,
    rewardStars: 8,
    label: 'Neon Dance Battle',
  },
  furniture_chaos: {
    durationMs: 60_000,
    rewardCredits: 175,
    rewardStars: 8,
    label: 'Furniture Chaos',
  },
};

function isBot(userId: string): boolean {
  return userId.startsWith('bot-');
}

function createBotPlayers(type: MinigameType): MinigamePlayerState[] {
  const botNames =
    type === 'wheelchair_racing'
      ? ['Turbo Tina [BOT]', 'Wheelie Pete [BOT]']
      : type === 'dance_battle'
        ? ['DJ Pixel [BOT]', 'Groove Bot [BOT]']
        : ['Bellhop Bot [BOT]', 'Concierge Bot [BOT]'];

  return botNames.map((username, idx) => ({
    userId: `bot-${type}-${idx + 1}`,
    username,
    avatar: AVATAR_PRESETS[idx % AVATAR_PRESETS.length].config,
    score: 0,
    ready: true,
    finished: false,
    eliminated: false,
    rank: idx + 2,
    lap: type === 'wheelchair_racing' ? 1 : undefined,
    checkpointIndex: type === 'wheelchair_racing' ? 0 : undefined,
    combo: 0,
    x: 4 + idx * 2,
    y: 8,
  }));
}

export class MinigameManager {
  private readonly sessions = new Map<string, ActiveMinigameRuntime>();
  private readonly userToSession = new Map<string, string>();
  private eventBroadcastTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly io: GameIO,
    private readonly store: IDataStore,
    private readonly roomManager: RoomManager,
    private readonly social: SocialManager
  ) {
    this.eventBroadcastTimer = setInterval(() => {
      void this.broadcastHotelEvents();
    }, 5 * 60_000);
  }

  dispose(): void {
    if (this.eventBroadcastTimer) clearInterval(this.eventBroadcastTimer);
    for (const runtime of this.sessions.values()) {
      if (runtime.tickTimer) clearInterval(runtime.tickTimer);
      if (runtime.countdownTimer) clearInterval(runtime.countdownTimer);
    }
    this.sessions.clear();
  }

  async broadcastHotelEvents(): Promise<void> {
    try {
      const events = await this.store.getActiveEvents();
      this.io.emit('event:updated', events);
    } catch (err) {
      console.error('[MinigameManager] broadcastHotelEvents error:', err);
    }
  }

  private emitState(runtime: ActiveMinigameRuntime): void {
    this.sortRankings(runtime.state);
    this.io.to(`room:${runtime.state.roomId}`).emit('minigame:state', runtime.state);
  }

  private sortRankings(state: MinigameSessionState): void {
    const sorted = [...state.players].sort((a, b) => {
      if (a.eliminated !== b.eliminated) return a.eliminated ? 1 : -1;
      if (state.type === 'wheelchair_racing') {
        const aProg = (a.lap ?? 1) * 100 + (a.checkpointIndex ?? 0) * 10 + a.score * 0.01;
        const bProg = (b.lap ?? 1) * 100 + (b.checkpointIndex ?? 0) * 10 + b.score * 0.01;
        return bProg - aProg;
      }
      return b.score - a.score;
    });

    sorted.forEach((p, idx) => {
      p.rank = idx + 1;
    });
  }

  async handleJoin(
    socket: GameSocket,
    payload: { roomId: string; type: MinigameType }
  ): Promise<void> {
    const user = getSocketUser(socket);
    if (!user) return;

    const gameConfig = GAME_CONFIG[payload?.type];
    if (!gameConfig) {
      socket.emit('error', { code: 'INVALID_MINIGAME', message: 'Unknown minigame type' });
      return;
    }

    const roomId = payload.roomId || user.currentRoomId || 'public-race-arena';

    // Leave any existing minigame session first
    const prevSessionId = this.userToSession.get(user.userId);
    if (prevSessionId) {
      this.removePlayerFromSession(user.userId, prevSessionId);
    }

    // Find open lobby in this room for this game type
    let runtime = Array.from(this.sessions.values()).find(
      (s) => s.state.roomId === roomId && s.state.type === payload.type && s.state.status === 'lobby'
    );

    const storedUser = await this.store.findUserById(user.userId);
    if (!storedUser) return;

    const playerState: MinigamePlayerState = {
      userId: storedUser.id,
      username: storedUser.username,
      avatar: storedUser.avatar,
      score: 0,
      ready: false,
      finished: false,
      eliminated: false,
      rank: 1,
      lap: payload.type === 'wheelchair_racing' ? 1 : undefined,
      checkpointIndex: payload.type === 'wheelchair_racing' ? 0 : undefined,
      combo: 0,
      x: 4,
      y: 8,
    };

    if (!runtime) {
      const sessionState: MinigameSessionState = {
        id: uuidv4(),
        type: payload.type,
        roomId,
        status: 'lobby',
        hostUserId: storedUser.id,
        players: [playerState],
        startedAt: null,
        endsAt: null,
        countdownSeconds: 3,
        totalLaps: payload.type === 'wheelchair_racing' ? 3 : undefined,
        checkpoints: payload.type === 'wheelchair_racing' ? RACE_CHECKPOINTS : undefined,
        currentPrompt: null,
        activeHazards: payload.type === 'furniture_chaos' ? [] : undefined,
        olympicsRound: payload.type === 'hotel_olympics' ? 'sprint' : undefined,
        winnerUserId: null,
        rewardCredits: gameConfig.rewardCredits,
        rewardStars: gameConfig.rewardStars,
      };

      runtime = {
        state: sessionState,
        tickTimer: null,
        countdownTimer: null,
        promptIndex: 0,
        lastPromptAt: 0,
        lastHazardAt: 0,
        olympicsStageIndex: 0,
        playerHits: new Map(),
        answeredPromptUsers: new Set(),
      };
      this.sessions.set(sessionState.id, runtime);
    } else {
      const existing = runtime.state.players.find((p) => p.userId === storedUser.id);
      if (!existing) {
        runtime.state.players.push(playerState);
      }
    }

    this.userToSession.set(storedUser.id, runtime.state.id);
    this.emitState(runtime);
    this.roomManager.broadcastSystemChat(
      roomId,
      `🏆 ${storedUser.username} joined the ${gameConfig.label} lobby!`
    );
  }

  handleLeave(socket: GameSocket, payload: { sessionId: string }): void {
    const user = getSocketUser(socket);
    if (!user) return;
    const sessionId = payload?.sessionId ?? this.userToSession.get(user.userId);
    if (!sessionId) return;
    this.removePlayerFromSession(user.userId, sessionId);
  }

  handleDisconnect(userId: string): void {
    const sessionId = this.userToSession.get(userId);
    if (sessionId) {
      this.removePlayerFromSession(userId, sessionId);
    }
  }

  private removePlayerFromSession(userId: string, sessionId: string): void {
    const runtime = this.sessions.get(sessionId);
    this.userToSession.delete(userId);
    if (!runtime) return;

    runtime.state.players = runtime.state.players.filter((p) => p.userId !== userId);
    const humanPlayers = runtime.state.players.filter((p) => !isBot(p.userId));

    if (humanPlayers.length === 0) {
      if (runtime.tickTimer) clearInterval(runtime.tickTimer);
      if (runtime.countdownTimer) clearInterval(runtime.countdownTimer);
      this.sessions.delete(sessionId);
      return;
    }

    if (runtime.state.hostUserId === userId) {
      runtime.state.hostUserId = humanPlayers[0].userId;
    }
    this.emitState(runtime);
  }

  handleReady(socket: GameSocket, payload: { sessionId: string; ready: boolean }): void {
    const user = getSocketUser(socket);
    if (!user) return;

    const runtime = this.sessions.get(payload?.sessionId);
    if (!runtime || runtime.state.status !== 'lobby') return;

    const player = runtime.state.players.find((p) => p.userId === user.userId);
    if (!player) return;

    player.ready = Boolean(payload.ready);
    this.emitState(runtime);

    const humans = runtime.state.players.filter((p) => !isBot(p.userId));
    if (humans.length >= 1 && humans.every((p) => p.ready)) {
      this.beginCountdown(runtime);
    }
  }

  handleStart(socket: GameSocket, payload: { sessionId: string }): void {
    const user = getSocketUser(socket);
    if (!user) return;

    const runtime = this.sessions.get(payload?.sessionId);
    if (!runtime || runtime.state.status !== 'lobby') return;
    if (runtime.state.hostUserId !== user.userId && user.role !== 'admin') return;

    this.beginCountdown(runtime);
  }

  private beginCountdown(runtime: ActiveMinigameRuntime): void {
    if (runtime.state.status !== 'lobby') return;

    // Add hotel bot competitors if playing solo so races & games are always exciting!
    const humanPlayers = runtime.state.players.filter((p) => !isBot(p.userId));
    if (humanPlayers.length === 1) {
      const bots = createBotPlayers(runtime.state.type);
      for (const bot of bots) {
        if (!runtime.state.players.some((p) => p.userId === bot.userId)) {
          runtime.state.players.push(bot);
        }
      }
    }

    runtime.state.status = 'countdown';
    runtime.state.countdownSeconds = 3;
    this.emitState(runtime);

    runtime.countdownTimer = setInterval(() => {
      runtime.state.countdownSeconds -= 1;
      if (runtime.state.countdownSeconds <= 0) {
        if (runtime.countdownTimer) clearInterval(runtime.countdownTimer);
        runtime.countdownTimer = null;
        this.startMatch(runtime);
      } else {
        this.emitState(runtime);
      }
    }, 1000);
  }

  private startMatch(runtime: ActiveMinigameRuntime): void {
    const cfg = GAME_CONFIG[runtime.state.type];
    const now = Date.now();

    runtime.state.status = 'playing';
    runtime.state.startedAt = now;
    runtime.state.endsAt = now + cfg.durationMs;
    runtime.state.countdownSeconds = 0;
    runtime.lastPromptAt = 0;
    runtime.lastHazardAt = 0;
    runtime.promptIndex = 0;
    runtime.olympicsStageIndex = 0;

    if (runtime.state.type === 'dance_battle') {
      this.spawnNextDancePrompt(runtime, now);
    }

    this.roomManager.broadcastSystemChat(
      runtime.state.roomId,
      `🚀 ${cfg.label} has begun! Good luck everyone!`
    );
    this.emitState(runtime);

    runtime.tickTimer = setInterval(() => {
      this.tickMatch(runtime);
    }, 500);
  }

  private spawnNextDancePrompt(runtime: ActiveMinigameRuntime, now: number): void {
    runtime.promptIndex += 1;
    runtime.lastPromptAt = now;
    runtime.answeredPromptUsers.clear();

    const key = DANCE_KEYS[Math.floor(Math.random() * DANCE_KEYS.length)];
    runtime.state.currentPrompt = {
      id: `prompt-${runtime.promptIndex}`,
      stepIndex: runtime.promptIndex,
      key,
      targetTimeMs: now + 900,
      windowMs: 1600,
    };
  }

  private tickMatch(runtime: ActiveMinigameRuntime): void {
    if (runtime.state.status !== 'playing') return;

    const now = Date.now();
    const { state } = runtime;

    // Time up check
    if (state.endsAt && now >= state.endsAt) {
      void this.finishMatch(runtime);
      return;
    }

    // Per-game simulation
    switch (state.type) {
      case 'wheelchair_racing': {
        this.tickWheelchairRacing(runtime, now);
        break;
      }
      case 'hotel_olympics': {
        this.tickHotelOlympics(runtime, now);
        break;
      }
      case 'dance_battle': {
        this.tickDanceBattle(runtime, now);
        break;
      }
      case 'furniture_chaos': {
        this.tickFurnitureChaos(runtime, now);
        break;
      }
    }

    this.emitState(runtime);
  }

  private tickWheelchairRacing(runtime: ActiveMinigameRuntime, now: number): void {
    const { state } = runtime;
    const totalLaps = state.totalLaps ?? 3;
    const checkpointCount = state.checkpoints?.length ?? RACE_CHECKPOINTS.length;

    // Simulate bot progress
    for (const player of state.players) {
      if (!isBot(player.userId) || player.finished) continue;
      if (Math.random() < 0.28) {
        const nextCp = (player.checkpointIndex ?? 0) + 1;
        if (nextCp >= checkpointCount) {
          player.checkpointIndex = 0;
          player.lap = (player.lap ?? 1) + 1;
          player.score += 100;
          if (player.lap > totalLaps) {
            player.lap = totalLaps;
            player.finished = true;
            player.score += 250;
          }
        } else {
          player.checkpointIndex = nextCp;
          player.score += 25;
        }
        const cp = RACE_CHECKPOINTS[player.checkpointIndex];
        if (cp) {
          player.x = cp.x;
          player.y = cp.y;
        }
      }
    }

    // Check if all human players finished
    const humans = state.players.filter((p) => !isBot(p.userId));
    if (humans.length > 0 && humans.every((p) => p.finished)) {
      void this.finishMatch(runtime);
    }

    // Clear expired speed boosts
    for (const p of state.players) {
      if (p.speedBoostUntil && now > p.speedBoostUntil) {
        p.speedBoostUntil = undefined;
      }
    }
  }

  private tickHotelOlympics(runtime: ActiveMinigameRuntime, now: number): void {
    const { state } = runtime;
    if (!state.startedAt || !state.endsAt) return;

    const elapsed = now - state.startedAt;
    const total = state.endsAt - state.startedAt;
    const stageIdx = Math.min(
      OLYMPICS_ROUNDS.length - 1,
      Math.floor((elapsed / total) * OLYMPICS_ROUNDS.length)
    );

    if (stageIdx !== runtime.olympicsStageIndex) {
      runtime.olympicsStageIndex = stageIdx;
      state.olympicsRound = OLYMPICS_ROUNDS[stageIdx];
      this.roomManager.broadcastSystemChat(
        state.roomId,
        `🏅 Hotel Olympics Round ${stageIdx + 1}: ${state.olympicsRound.toUpperCase().replace('_', ' ')}!`
      );
    }

    // Bot scoring
    for (const p of state.players) {
      if (isBot(p.userId) && Math.random() < 0.35) {
        p.score += Math.floor(Math.random() * 25) + 10;
      }
    }
  }

  private tickDanceBattle(runtime: ActiveMinigameRuntime, now: number): void {
    if (now - runtime.lastPromptAt >= 2400) {
      this.spawnNextDancePrompt(runtime, now);
    }

    // Bot dance hits
    for (const p of runtime.state.players) {
      if (isBot(p.userId) && !runtime.answeredPromptUsers.has(p.userId) && Math.random() < 0.35) {
        runtime.answeredPromptUsers.add(p.userId);
        const hit = Math.random() < 0.72;
        if (hit) {
          p.combo = (p.combo ?? 0) + 1;
          p.score += 35 + Math.min(p.combo, 5) * 10;
        } else {
          p.combo = 0;
        }
      }
    }
  }

  private tickFurnitureChaos(runtime: ActiveMinigameRuntime, now: number): void {
    const { state } = runtime;
    const hazards = (state.activeHazards ?? []).filter((h) => h.expiresAt > now);

    if (now - runtime.lastHazardAt >= 1800 && hazards.length < 8) {
      runtime.lastHazardAt = now;
      const kinds: ChaosHazard['kind'][] = [
        'falling_sofa',
        'rolling_luggage',
        'slippery_spill',
        'flying_duck',
        'golden_star',
        'golden_star',
      ];
      const kind = kinds[Math.floor(Math.random() * kinds.length)];
      hazards.push({
        id: uuidv4(),
        kind,
        x: Math.floor(Math.random() * 12) + 2,
        y: Math.floor(Math.random() * 10) + 2,
        radius: kind === 'golden_star' ? 1.5 : 2,
        expiresAt: now + 5500,
        points: kind === 'golden_star' ? 50 : -25,
      });
    }

    state.activeHazards = hazards;

    // Survival tick points + bot simulation
    for (const p of state.players) {
      if (p.eliminated) continue;
      p.score += 5;
      if (isBot(p.userId) && Math.random() < 0.15) {
        p.score += 30;
      }
    }

    const aliveHumans = state.players.filter((p) => !isBot(p.userId) && !p.eliminated);
    if (aliveHumans.length === 0) {
      void this.finishMatch(runtime);
    }
  }

  handleAction(socket: GameSocket, payload: MinigameActionPayload): void {
    const user = getSocketUser(socket);
    if (!user) return;

    const runtime = this.sessions.get(payload?.sessionId);
    if (!runtime || runtime.state.status !== 'playing') return;

    const player = runtime.state.players.find((p) => p.userId === user.userId);
    if (!player || player.eliminated || player.finished) return;

    const now = Date.now();
    const { state } = runtime;

    switch (payload.action) {
      case 'boost': {
        player.speedBoostUntil = now + 2500;
        player.score += 20;
        this.roomManager.setPlayerSpeedBoost(state.roomId, user.userId, 1.8, 2500);
        this.roomManager.setPlayerEmote(state.roomId, user.userId, 'wheelie');

        // In wheelchair racing, boost also helps advance checkpoint progress if triggered from HUD
        if (state.type === 'wheelchair_racing') {
          this.advanceRaceCheckpoint(runtime, player);
        }
        break;
      }

      case 'checkpoint': {
        if (state.type !== 'wheelchair_racing') return;
        this.advanceRaceCheckpoint(runtime, player);
        break;
      }

      case 'dance_hit': {
        if (state.type !== 'dance_battle' || !state.currentPrompt) return;
        if (runtime.answeredPromptUsers.has(user.userId)) return;

        runtime.answeredPromptUsers.add(user.userId);
        const prompt = state.currentPrompt;
        const keyMatches = !payload.key || payload.key === prompt.key;
        const deltaMs = Math.abs(now - prompt.targetTimeMs);

        if (keyMatches && deltaMs <= prompt.windowMs) {
          player.combo = (player.combo ?? 0) + 1;
          const accuracyBonus = deltaMs < 350 ? 60 : deltaMs < 750 ? 40 : 25;
          const comboBonus = Math.min(player.combo, 8) * 10;
          player.score += accuracyBonus + comboBonus;
          this.roomManager.setPlayerEmote(
            state.roomId,
            user.userId,
            DANCE_EMOTE_BY_KEY[prompt.key]
          );
        } else {
          player.combo = 0;
          this.roomManager.setPlayerEmote(state.roomId, user.userId, 'facepalm');
        }
        break;
      }

      case 'olympics_score': {
        if (state.type !== 'hotel_olympics') return;
        const delta = Math.max(5, Math.min(80, Math.round(Number(payload.value) || 25)));
        player.combo = (player.combo ?? 0) + 1;
        player.score += delta + Math.min(player.combo, 5) * 5;
        this.roomManager.setPlayerEmote(state.roomId, user.userId, 'cheer');
        break;
      }

      case 'collect_star': {
        if (payload.hazardId && state.activeHazards) {
          const idx = state.activeHazards.findIndex((h) => h.id === payload.hazardId);
          if (idx !== -1) {
            state.activeHazards.splice(idx, 1);
          }
        }
        player.score += 50;
        this.roomManager.setPlayerEmote(state.roomId, user.userId, 'cheer');
        break;
      }

      case 'hit_hazard': {
        const hits = (runtime.playerHits.get(user.userId) ?? 0) + 1;
        runtime.playerHits.set(user.userId, hits);
        player.score = Math.max(0, player.score - 25);
        this.roomManager.setPlayerEmote(state.roomId, user.userId, 'facepalm');
        if (hits >= 3) {
          player.eliminated = true;
          this.roomManager.broadcastSystemChat(
            state.roomId,
            `💥 ${player.username} was knocked out by flying hotel furniture!`
          );
        }
        break;
      }
    }

    if (typeof payload.x === 'number') player.x = payload.x;
    if (typeof payload.y === 'number') player.y = payload.y;

    this.emitState(runtime);
  }

  private advanceRaceCheckpoint(
    runtime: ActiveMinigameRuntime,
    player: MinigamePlayerState
  ): void {
    const totalLaps = runtime.state.totalLaps ?? 3;
    const checkpoints = runtime.state.checkpoints ?? RACE_CHECKPOINTS;
    const nextCp = (player.checkpointIndex ?? 0) + 1;

    if (nextCp >= checkpoints.length) {
      player.checkpointIndex = 0;
      player.lap = (player.lap ?? 1) + 1;
      player.score += 120;

      if (player.lap > totalLaps) {
        player.lap = totalLaps;
        player.finished = true;
        const finishBonus = Math.max(100, 350 - runtime.state.players.filter((p) => p.finished).length * 75);
        player.score += finishBonus;
        this.roomManager.broadcastSystemChat(
          runtime.state.roomId,
          `🏁 ${player.username} crossed the finish line!`
        );
      } else {
        this.roomManager.broadcastSystemChat(
          runtime.state.roomId,
          `⚡ ${player.username} started Lap ${player.lap}/${totalLaps}!`
        );
      }
    } else {
      player.checkpointIndex = nextCp;
      const cp = checkpoints[nextCp];
      player.score += cp?.isBoostPad ? 45 : 30;
      if (cp) {
        player.x = cp.x;
        player.y = cp.y;
      }
    }

    const humans = runtime.state.players.filter((p) => !isBot(p.userId));
    if (humans.length > 0 && humans.every((p) => p.finished)) {
      void this.finishMatch(runtime);
    }
  }

  private async finishMatch(runtime: ActiveMinigameRuntime): Promise<void> {
    if (runtime.state.status === 'finished') return;

    runtime.state.status = 'finished';
    if (runtime.tickTimer) {
      clearInterval(runtime.tickTimer);
      runtime.tickTimer = null;
    }
    if (runtime.countdownTimer) {
      clearInterval(runtime.countdownTimer);
      runtime.countdownTimer = null;
    }

    this.sortRankings(runtime.state);
    const winner = runtime.state.players[0] ?? null;
    runtime.state.winnerUserId = winner?.userId ?? null;

    const rewards: Record<string, { credits: number; stars: number }> = {};
    const elapsedMs = runtime.state.startedAt ? Date.now() - runtime.state.startedAt : undefined;
    const cfg = GAME_CONFIG[runtime.state.type];

    const podiumCredits = [cfg.rewardCredits, Math.round(cfg.rewardCredits * 0.6), Math.round(cfg.rewardCredits * 0.375), 40];
    const podiumStars = [cfg.rewardStars, Math.max(1, Math.round(cfg.rewardStars * 0.6)), Math.max(1, Math.round(cfg.rewardStars * 0.4)), 2];

    for (const player of runtime.state.players) {
      const tier = Math.min(player.rank - 1, 3);
      const credits = podiumCredits[tier];
      const stars = podiumStars[tier];
      rewards[player.userId] = { credits, stars };

      if (isBot(player.userId)) continue;

      try {
        const balance = await this.store.updateBalance(
          player.userId,
          credits,
          stars,
          'minigame_reward',
          `${cfg.label} (#${player.rank} place)`
        );
        await this.store.recordMinigameScore({
          userId: player.userId,
          gameType: runtime.state.type,
          score: player.score,
          won: player.rank === 1,
          timeMs: elapsedMs,
          metadata: { rank: player.rank, sessionId: runtime.state.id },
        });
        await this.social.emitToUser(player.userId, 'economy:updated', {
          credits: balance.credits,
          stars: balance.stars,
          reason: `${cfg.label} reward (+${credits}c, +${stars}★)`,
        });
      } catch (err) {
        console.error('[MinigameManager] reward persistence error:', err);
      }

      this.userToSession.delete(player.userId);
    }

    this.io.to(`room:${runtime.state.roomId}`).emit('minigame:ended', {
      session: runtime.state,
      winnerUsername: winner?.username ?? null,
      rewards,
    });

    if (winner) {
      this.roomManager.broadcastSystemChat(
        runtime.state.roomId,
        `🏆 ${winner.username} won ${cfg.label} with ${winner.score} pts!`
      );
    }

    // Keep finished state briefly then clean up
    setTimeout(() => {
      this.sessions.delete(runtime.state.id);
    }, 10_000);
  }
}
