import { expect, test } from '@playwright/test';

test.describe('HandiHotel End-to-End Multiplayer & UI Flows', () => {
  test('full player journey: register, 3D lobby, avatar editor, navigator, chat, shop/builder, minigame, social & settings', async ({
    page,
  }) => {
    const uniqueSuffix = Date.now().toString().slice(-6);
    const username = `e2e_${uniqueSuffix}`;
    const email = `${username}@handihotel.test`;
    const consoleErrors: string[] = [];

    page.on('pageerror', (err) => {
      consoleErrors.push(err.message);
    });

    // 1. Load HandiHotel & Register a fresh account
    await page.goto('/');
    await expect(page.getByText('HandiHotel', { exact: false }).first()).toBeVisible();

    // Switch to Register tab or click Quick Play / Register
    const registerTab = page.getByRole('button', { name: /register|create account|sign up/i }).first();
    if (await registerTab.isVisible()) {
      await registerTab.click();
    }

    const usernameInput = page.locator('input[placeholder*="username" i], input[name="username"]').first();
    const emailInput = page.locator('input[type="email"], input[placeholder*="email" i]').first();
    const passwordInput = page.locator('input[type="password"]').first();

    if (await emailInput.isVisible()) {
      await usernameInput.fill(username);
      await emailInput.fill(email);
      await passwordInput.fill('Secret123!');
      await page.getByRole('button', { name: /create account|enter handihotel|register/i }).last().click();
    } else {
      await page.getByRole('button', { name: /quick play demo account/i }).click();
    }

    // Verify we landed in Main Lobby with TopBar, BottomDock, and Three.js canvas
    await expect(page.getByText('Main Lobby').first()).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15_000 });

    // 2. Avatar Editor: switch mobility aid to Racing Wheelchair & Save
    await page.getByRole('button', { name: /avatar/i }).first().click();
    await expect(page.getByText('Avatar & Mobility Studio')).toBeVisible();
    await page.getByRole('button', { name: /racing wheelchair/i }).first().click();
    await page.getByRole('button', { name: /save avatar/i }).click();
    await expect(page.getByText(/avatar saved/i).first()).toBeVisible({ timeout: 10_000 });

    // Close Avatar Editor if still open
    const closeBtnAfterAvatar = page.locator('button[aria-label="Close"], button[title="Close"]').first();
    if (await closeBtnAfterAvatar.isVisible().catch(() => false)) {
      await closeBtnAfterAvatar.click();
    } else if (await page.getByText('Avatar & Mobility Studio').isVisible().catch(() => false)) {
      await page.keyboard.press('Escape');
    }

    // 3. Hotel Navigator: switch to Neon Nightclub without page reload, then create a private room
    await page.getByRole('button', { name: /^rooms$/i }).first().click();
    await expect(page.getByText(/public spaces/i).first()).toBeVisible();

    const nightclubEnter = page
      .locator('div')
      .filter({ hasText: 'Neon Nightclub' })
      .filter({ has: page.getByRole('button', { name: 'Enter Room' }) })
      .last()
      .getByRole('button', { name: 'Enter Room' });
    await expect(nightclubEnter).toBeVisible();
    await nightclubEnter.click();
    await expect(page.getByText('Neon Nightclub').first()).toBeVisible({ timeout: 10_000 });

    // Re-open Navigator and create a private room
    await page.getByRole('button', { name: /^rooms$/i }).first().click();
    await page.getByRole('button', { name: /create room/i }).first().click();

    const roomNameInput = page.getByRole('textbox', { name: 'Room Name' });
    const privateRoomName = `Suite ${uniqueSuffix}`;
    await roomNameInput.fill(privateRoomName);
    await page.getByRole('button', { name: /create & enter room/i }).click();
    await expect(page.getByText(privateRoomName).first()).toBeVisible({ timeout: 15_000 });

    // 4. Chat sending & chat bubble / history appearing
    const chatInput = page.getByRole('textbox', { name: /click to chat/i });
    await expect(chatInput).toBeVisible();
    const chatMsg = `Hello HandiHotel ${uniqueSuffix}!`;
    await chatInput.fill(chatMsg);
    await chatInput.press('Enter');
    await expect(page.getByText(chatMsg).first()).toBeVisible({ timeout: 10_000 });

    // 5. Shop purchase & Inventory -> Room Builder furniture placement
    await page.getByRole('button', { name: /^shop$/i }).first().click();
    await expect(page.getByText(/purchase now/i).first()).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: /purchase now/i }).first().click();
    await expect(page.getByText(/purchased/i).first()).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Close Shop' }).click();

    // Open Inventory (Bag) -> Place in Room
    await page.getByRole('button', { name: /^bag$/i }).first().click();
    const placeBtn = page.getByRole('button', { name: /place in room/i }).first();
    await expect(placeBtn).toBeVisible({ timeout: 10_000 });
    await placeBtn.click();

    // Room Builder should now be open
    await expect(page.getByText(/room builder/i).first()).toBeVisible({ timeout: 10_000 });
    // Close Room Builder toggle
    await page.getByRole('button', { name: /build/i }).first().click();

    // 6. Minigames Hub & starting Wheelchair Racing
    await page.getByRole('button', { name: /^games$/i }).first().click();
    await expect(page.getByText('Wheelchair Racing').first()).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: /play now \/ join match/i }).first().click();
    await expect(page.getByRole('button', { name: /start now/i })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: /start now/i }).click();
    await expect(page.getByText(/starting in|lap|turbo|race/i).first()).toBeVisible({
      timeout: 10_000,
    });

    // Leave minigame so UI is clean
    const leaveMgBtn = page.getByRole('button', { name: /leave/i }).first();
    if (await leaveMgBtn.isVisible().catch(() => false)) {
      await leaveMgBtn.click();
    }

    // 7. Friends/Social Modal & Settings Modal
    await page.getByRole('button', { name: /^friends$/i }).first().click();
    await expect(page.getByText(/friends|requests|find players/i).first()).toBeVisible({
      timeout: 10_000,
    });
    await page.getByRole('button', { name: 'Close Social' }).click();

    // Open Settings Modal from TopBar
    await page.locator('button[title="Settings"]').click();
    await expect(page.getByText(/graphics|audio|master/i).first()).toBeVisible({
      timeout: 10_000,
    });

    expect(consoleErrors, `Uncaught page errors: ${consoleErrors.join('; ')}`).toEqual([]);
  });
});
