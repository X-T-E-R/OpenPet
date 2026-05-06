const PET_HIT_TARGET = '[data-testid="pet-hit-target"]';

describe('OpenPet Tauri desktop window', () => {
  it('boots the native pet window and opens its context menu', async () => {
    await switchToPetWindow();

    const route = await browser.execute(() => new URLSearchParams(window.location.search).get('window'));
    expect(route).toBe('pet');

    const hitTarget = await $(PET_HIT_TARGET);
    await expect(hitTarget).toBeDisplayed();

    await hitTarget.click();
    await hitTarget.click({ button: 'right' });

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
