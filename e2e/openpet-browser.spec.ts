import { expect, test } from '@playwright/test';

test.describe('OpenPet browser preview', () => {
  test('settings expose the main configuration tabs', async ({ page }) => {
    await page.goto('/');

    await expect(
      page.getByRole('heading', { name: 'Settings, imports, and tiny companion behavior.' }),
    ).toBeVisible();
    await expect(
      page.getByText('Browser preview only. Open the Tauri desktop app to control the pet.'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'General' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await page.getByRole('button', { name: 'Bubble' }).click();
    await expect(page.getByRole('heading', { name: 'Speech bubble' })).toBeVisible();
    const bubbleText = page.getByRole('textbox', { name: 'Bubble text', exact: true });
    await bubbleText.fill('Hello from browser e2e.');
    await expect(bubbleText).toHaveValue('Hello from browser e2e.');

    await page.getByRole('button', { name: 'API / Agent' }).click();
    await expect(page.getByRole('heading', { name: 'Endpoint and agent integrations' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'HTTP API endpoint' })).toBeVisible();
    await expect(page.getByText('http://127.0.0.1:17321').first()).toBeVisible();
  });

  test('pet route supports click and context-menu interactions', async ({ page }) => {
    await page.goto('/?window=pet');

    await expect(
      page.getByRole('button', { name: 'OpenPet desktop pet window' }),
    ).toBeVisible();

    const hitTarget = page.getByTestId('pet-hit-target');
    await expect(hitTarget).toBeVisible();
    await hitTarget.click();
    await hitTarget.click({ button: 'right' });

    await expect(page.getByRole('menu', { name: 'Pet actions' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Open settings' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Wave' })).toBeVisible();

    await page.getByRole('menuitem', { name: 'Let me roam' }).click();
    await expect(page.getByRole('menu', { name: 'Pet actions' })).toBeHidden();

    await hitTarget.click({ button: 'right' });
    await expect(page.getByRole('menuitem', { name: 'Pause walking' })).toBeVisible();
  });
});
