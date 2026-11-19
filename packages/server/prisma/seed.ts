import { PrismaClient, type Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';
import {
  AVATAR_PRESETS,
  DEFAULT_AVATAR_CONFIG,
  PUBLIC_ROOMS,
} from '@handihotel/shared';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  console.log('[Seed] Seeding HandiHotel PostgreSQL database...');

  const passwordHash = await bcrypt.hash('demo1234', 10);

  const conciergeAvatar =
    AVATAR_PRESETS.find((p) => p.name === 'Hotel Concierge')?.config ??
    DEFAULT_AVATAR_CONFIG;
  const racerAvatar =
    AVATAR_PRESETS.find((p) => p.name === 'Turbo Racer')?.config ??
    DEFAULT_AVATAR_CONFIG;

  const hotelhost = await prisma.user.upsert({
    where: { username: 'hotelhost' },
    update: {},
    create: {
      username: 'hotelhost',
      email: 'hotelhost@handihotel.local',
      passwordHash,
      motto: 'Welcome to HandiHotel! Ring the concierge bell anytime.',
      credits: 5000,
      stars: 250,
      role: 'ADMIN',
      avatarConfig: conciergeAvatar as unknown as Prisma.InputJsonValue,
    },
  });

  const turboWheelie = await prisma.user.upsert({
    where: { username: 'turbo_wheelie' },
    update: {},
    create: {
      username: 'turbo_wheelie',
      email: 'turbo@handihotel.local',
      passwordHash,
      motto: 'Catch me in the Turbo Wheelchair Race Arena!',
      credits: 2500,
      stars: 120,
      role: 'VIP',
      avatarConfig: racerAvatar as unknown as Prisma.InputJsonValue,
    },
  });

  // Starter inventory for demo users
  for (const item of [
    { userId: hotelhost.id, catalogItemId: 'velvet_sofa' },
    { userId: hotelhost.id, catalogItemId: 'coffee_table_oak' },
    { userId: hotelhost.id, catalogItemId: 'disco_ball' },
    { userId: turboWheelie.id, catalogItemId: 'club_sofa_teal' },
    { userId: turboWheelie.id, catalogItemId: 'arcade_cabinet' },
    { userId: turboWheelie.id, catalogItemId: 'accessibility_ramp' },
  ]) {
    await prisma.inventoryItem.upsert({
      where: {
        userId_catalogItemId: {
          userId: item.userId,
          catalogItemId: item.catalogItemId,
        },
      },
      update: {},
      create: {
        userId: item.userId,
        catalogItemId: item.catalogItemId,
        quantity: 1,
      },
    });
  }

  // Seed all 11 official PUBLIC_ROOMS
  for (const room of PUBLIC_ROOMS) {
    const existing = await prisma.room.findUnique({ where: { id: room.id } });
    if (!existing) {
      await prisma.room.create({
        data: {
          id: room.id,
          name: room.name,
          description: room.description,
          isPublic: true,
          isOfficial: true,
          theme: room.theme,
          templateId: room.templateId,
          width: room.width,
          height: room.height,
          floorStyle: room.floorStyle,
          wallStyle: room.wallStyle,
          maxUsers: room.permissions.maxUsers,
          allowVisitorBuild: false,
          furniture: {
            create: room.furniture.map((f) => ({
              id: f.id,
              catalogItemId: f.catalogItemId,
              x: f.x,
              y: f.y,
              z: f.z,
              rotation: f.rotation,
              state: JSON.stringify(f.state ?? {}),
            })),
          },
        },
      });
    }
  }

  // Seed 3 active/upcoming HotelEvents
  const now = Date.now();
  const hour = 60 * 60 * 1000;

  const events = [
    {
      id: 'event-turbo-gp',
      title: 'Turbo Wheelchair Grand Prix',
      description:
        'High-speed 3-lap championship in the Turbo Wheelchair Race Arena! Hit the boost pads and claim the golden trophy.',
      gameType: 'wheelchair_racing',
      roomId: 'public-race-arena',
      rewardCredits: 350,
      startsAt: new Date(now - hour),
      endsAt: new Date(now + 12 * hour),
      status: 'ACTIVE',
    },
    {
      id: 'event-neon-dance',
      title: 'Neon Nightclub Dance Battle',
      description:
        'Show off your rhythm on the glowing dance floor! Hit combos to win credits and VIP stars.',
      gameType: 'dance_battle',
      roomId: 'public-nightclub',
      rewardCredits: 250,
      startsAt: new Date(now - 30 * 60 * 1000),
      endsAt: new Date(now + 8 * hour),
      status: 'ACTIVE',
    },
    {
      id: 'event-hotel-olympics',
      title: 'Grand Ballroom Hotel Olympics',
      description:
        'Sprint, slalom, and target toss in the Grand Event Ballroom! Open to all hotel guests.',
      gameType: 'hotel_olympics',
      roomId: 'public-event-hall',
      rewardCredits: 500,
      startsAt: new Date(now + 2 * hour),
      endsAt: new Date(now + 24 * hour),
      status: 'SCHEDULED',
    },
  ];

  for (const ev of events) {
    await prisma.hotelEvent.upsert({
      where: { id: ev.id },
      update: {
        startsAt: ev.startsAt,
        endsAt: ev.endsAt,
        status: ev.status,
      },
      create: ev,
    });
  }

  console.log(
    `[Seed] Done! Seeded 2 demo users, ${PUBLIC_ROOMS.length} public rooms, and ${events.length} hotel events.`
  );
}

main()
  .catch((err) => {
    console.error('[Seed] Error:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
