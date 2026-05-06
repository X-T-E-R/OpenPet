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

  test('mocked Tauri pet drag starts only after movement threshold', async ({ page }) => {
    await page.addInitScript(() => {
      const calls: Array<{ cmd: string; args?: unknown }> = [];
      let nextCallbackId = 1;

      Object.defineProperty(window, '__openPetTauriCalls', {
        configurable: true,
        value: calls,
      });

      Object.defineProperty(window, '__TAURI_EVENT_PLUGIN_INTERNALS__', {
        configurable: true,
        value: {
          unregisterListener: () => {},
        },
      });

      Object.defineProperty(window, '__TAURI_INTERNALS__', {
        configurable: true,
        value: {
          callbacks: {},
          convertFileSrc: (filePath: string) => filePath,
          invoke: async (cmd: string, args?: unknown) => {
            calls.push({ cmd, args });

            if (cmd === 'plugin:event|listen') return nextCallbackId++;
            if (cmd === 'plugin:event|unlisten') return null;
            if (cmd === 'plugin:window|available_monitors') return [];
            if (cmd === 'plugin:window|current_monitor') return null;
            if (cmd === 'plugin:window|primary_monitor') return null;
            if (cmd === 'plugin:window|cursor_position') return { x: 0, y: 0 };
            if (cmd === 'plugin:window|inner_position') return { x: 0, y: 0 };
            if (cmd === 'plugin:window|scale_factor') return 1;
            if (cmd === 'plugin:window|set_ignore_cursor_events') return null;
            if (cmd === 'plugin:window|set_position') return null;
            if (cmd === 'plugin:window|set_size') return null;
            if (cmd === 'plugin:window|start_dragging') return null;

            throw new Error(`Unhandled mocked Tauri command: ${cmd}`);
          },
          metadata: {
            currentWebview: { label: 'pet' },
            currentWindow: { label: 'pet' },
          },
          transformCallback: () => nextCallbackId++,
          unregisterCallback: () => {},
        },
      });
    });
    await page.goto('/?window=pet');

    const hitTarget = page.getByTestId('pet-hit-target');
    await expect(hitTarget).toBeVisible();

    await hitTarget.click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as typeof window & { __openPetTauriCalls: Array<{ cmd: string }> })
              .__openPetTauriCalls.filter((call) => call.cmd === 'plugin:window|start_dragging')
              .length,
        ),
      )
      .toBe(0);

    const box = await hitTarget.boundingBox();
    expect(box).not.toBeNull();
    const x = box!.x + box!.width / 2;
    const y = box!.y + box!.height / 2;

    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 12, y);
    await page.mouse.up();

    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as typeof window & { __openPetTauriCalls: Array<{ cmd: string }> })
              .__openPetTauriCalls.filter((call) => call.cmd === 'plugin:window|start_dragging')
              .length,
        ),
      )
      .toBeGreaterThan(0);
  });
});
