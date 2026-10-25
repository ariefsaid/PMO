/** Capture all content in the app's inner main scrollport without changing its responsive width. */
export async function screenshotMainContent(page, file) {
  const main = page.locator('main').first();
  const shell = page.locator('[data-app-shell="root"]').first();
  const originalMainStyle = await main.getAttribute('style');
  const originalShellStyle = await shell.getAttribute('style');
  const dimensions = await main.evaluate((element) => {
    const mainHeight = element.scrollHeight;
    const shell = element.closest('[data-app-shell="root"]');
    const header = shell?.querySelector('header');
    const headerHeight = header ? Math.ceil(header.getBoundingClientRect().height) : 0;
    return { mainHeight, headerHeight };
  });

  await shell.evaluate((element, { mainHeight, headerHeight }) => {
    element.style.setProperty('height', 'auto', 'important');
    element.style.setProperty('min-height', '0', 'important');
    element.style.setProperty('overflow', 'visible', 'important');
    element.style.setProperty('grid-template-rows', `${headerHeight}px ${mainHeight}px`, 'important');
  }, dimensions);
  await main.evaluate((element, { mainHeight }) => {
    element.style.setProperty('height', `${mainHeight}px`, 'important');
    element.style.setProperty('max-height', 'none', 'important');
    element.style.setProperty('min-height', '0', 'important');
    element.style.setProperty('overflow-y', 'visible', 'important');
    element.style.setProperty('flex', 'none', 'important');
  }, dimensions);

  try {
    await main.screenshot({ path: file });
  } finally {
    if (originalMainStyle === null) await main.evaluate((element) => element.removeAttribute('style'));
    else await main.evaluate((element, style) => element.setAttribute('style', style), originalMainStyle);
    if (originalShellStyle === null) await shell.evaluate((element) => element.removeAttribute('style'));
    else await shell.evaluate((element, style) => element.setAttribute('style', style), originalShellStyle);
  }
  return dimensions;
}
