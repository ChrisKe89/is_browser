import { expect, test } from '@playwright/test';

test.use({
  ignoreHTTPSErrors: true,
  storageState: 'state/auth-state.json'
});

const BASE_URL = process.env.PRINTER_BASE_URL ?? 'https://192.168.0.107';
const SCREENSHOT_PREFIX = 'tools/recordings/manual-reboot';
const ADMIN_USER = process.env.PRINTER_ADMIN_USER;
const ADMIN_PASSWORD = process.env.PRINTER_ADMIN_PASSWORD;

async function closeWarnings(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded');

  for (let i = 0; i < 5; i += 1) {
    const closeButton = page
      .locator('[role="alertdialog"], [role="dialog"]')
      .getByRole('button', { name: 'Close' })
      .first();

    const hasButton = (await closeButton.count().catch(() => 0)) > 0;
    if (!hasButton || !(await closeButton.isVisible().catch(() => false))) {
      break;
    }

    await closeButton.click({ timeout: 1_500 }).catch(() => null);
    await page.waitForTimeout(250);
  }
}

async function loginIfNeeded(page: import('@playwright/test').Page): Promise<void> {
  await page.goto(`${BASE_URL}/home/index.html#hashHome`);

  const logInButton = page.getByRole('button', { name: 'Log In' });
  const needsLogin = await logInButton.first().isVisible().catch(() => false);
  if (!needsLogin) {
    await closeWarnings(page);
    return;
  }

  if (!ADMIN_USER || !ADMIN_PASSWORD) {
    throw new Error(
      'Session is not authenticated. Set PRINTER_ADMIN_USER and PRINTER_ADMIN_PASSWORD to continue.'
    );
  }

  await logInButton.first().click();
  await page.getByRole('textbox', { name: 'User ID' }).fill(ADMIN_USER);
  await page.getByRole('textbox', { name: 'Password' }).fill(ADMIN_PASSWORD);
  await page.getByLabel('Log In').getByRole('button', { name: 'Log In' }).click();
  await closeWarnings(page);
}

test('manual_reboot', async ({ page }) => {
  test.setTimeout(120_000);

  await loginIfNeeded(page);
  await page.goto(`${BASE_URL}/connectivity/index.html#hashProtocol/hashConnectivity`);
  await closeWarnings(page);

  await expect(page.locator('#wsd')).toBeVisible({ timeout: 15_000 });
  await page.locator('#wsd').click();
  const wsdDialog = page.getByRole('dialog', { name: 'WSD' });
  await expect(wsdDialog).toBeVisible({ timeout: 10_000 });

  await page.screenshot({ path: `${SCREENSHOT_PREFIX}-01-wsd-open.png`, fullPage: true });

  const toggleTarget = await wsdDialog.evaluate(() => {
    const labels = Array.from(document.querySelectorAll('label[for]'));
    for (const label of labels) {
      const inputId = label.getAttribute('for');
      if (!inputId) {
        continue;
      }

      const input = document.getElementById(inputId) as HTMLInputElement | null;
      if (!input || input.type !== 'checkbox' || input.disabled) {
        continue;
      }

      if (input.checked) {
        const labelText = input.getAttribute('aria-labelledby')
          ? document.getElementById(input.getAttribute('aria-labelledby') ?? '')?.textContent?.trim() ?? inputId
          : inputId;
        return { inputId, labelText };
      }
    }

    return null;
  });

  if (!toggleTarget) {
    throw new Error('No enabled checked checkbox found in the WSD modal.');
  }

  await page.locator(`label[for="${toggleTarget.inputId}"]`).click();
  await page.screenshot({
    path: `${SCREENSHOT_PREFIX}-02-toggled-${toggleTarget.inputId}.png`,
    fullPage: true
  });

  await wsdDialog.getByRole('button', { name: 'Save' }).click();

  const restartLater = page.getByRole('button', { name: 'Restart Later' }).first();
  const restartDialogAppeared = await restartLater
    .waitFor({ state: 'visible', timeout: 10_000 })
    .then(() => true)
    .catch(() => false);

  if (!restartDialogAppeared) {
    await page.screenshot({ path: `${SCREENSHOT_PREFIX}-03-no-restart-dialog.png`, fullPage: true });
    throw new Error('Restart dialog did not appear after saving WSD changes.');
  }

  await page.screenshot({ path: `${SCREENSHOT_PREFIX}-03-restart-dialog.png`, fullPage: true });
  await restartLater.click();

  for (let i = 1; i <= 10; i += 1) {
    await page.screenshot({
      path: `${SCREENSHOT_PREFIX}-after-later-${String(i).padStart(2, '0')}.png`,
      fullPage: true
    });
    if (i < 10) {
      await page.waitForTimeout(1000);
    }
  }
});

