const PET_HIT_TARGET = '[data-testid="pet-hit-target"]';

describe('OpenPet Tauri desktop window', () => {
  it('boots the native pet window and opens its context menu', async () => {
    await switchToPetWindow();

    const route = await browser.execute(() => new URLSearchParams(window.location.search).get('window'));
    expect(route).toBe('pet');

    const hitTarget = await $(PET_HIT_TARGET);
    await expect(hitTarget).toBeDisplayed();

    await hitTarget.click();
    await openContextMenu(hitTarget);

    const menu = await $('[role="menu"]');
    await expect(menu).toBeDisplayed();

    const menuText = await menu.getText();
    expect(menuText).toMatch(/Open settings|打开设置/);
  });
});

async function switchToPetWindow() {
  await browser.waitUntil(
    async () => {
      const handles = await browser.getWindowHandles();

      for (const handle of handles) {
        await browser.switchToWindow(handle);

        const hitTarget = await $(PET_HIT_TARGET);
        if (await hitTarget.isExisting()) {
          return true;
        }
      }

      return false;
    },
    {
      timeout: 20_000,
      interval: 500,
      timeoutMsg: 'Expected the OpenPet pet window to be available to WebDriver.',
    },
  );
}

async function openContextMenu(hitTarget) {
  await hitTarget.click({ button: 'right' });

  const menu = await $('[role="menu"]');
  if (await menu.isDisplayed().catch(() => false)) {
    return;
  }

  // WebKitGTK under Xvfb can miss WebDriver's synthesized secondary-button
  // click even though the native Tauri webview booted successfully. Keep the
  // native WebDriver session, but fall back to dispatching the same DOM
  // contextmenu event so the test remains focused on OpenPet's menu behavior.
  await browser.execute((selector) => {
    const target = document.querySelector(selector);
    if (!target) throw new Error(`Unable to find ${selector}`);
    const rect = target.getBoundingClientRect();
    target.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        button: 2,
        buttons: 2,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        view: window,
      }),
    );
  }, PET_HIT_TARGET);
}
