import 'dotenv/config';
import { chromium, type Page } from 'playwright';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const baseUrl = process.env.PRINTER_URL ?? 'https://192.168.0.107';
const username = process.env.PRINTER_USER ?? '11111';
const password = process.env.PRINTER_PASS ?? 'x-admin';

function nowStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function closeDialogs(page: Page): Promise<void> {
  for (let i = 0; i < 6; i += 1) {
    const closeButton = page
      .locator('[role="dialog"], [role="alertdialog"]')
      .getByRole('button', { name: 'Close' })
      .first();
    if (!(await closeButton.isVisible().catch(() => false))) {
      break;
    }
    await closeButton.click({ timeout: 1500 }).catch(() => null);
    await page.waitForTimeout(250);
  }
}

async function loginIfNeeded(page: Page): Promise<void> {
  await page.goto(`${baseUrl}/home/index.html#hashHome`, { waitUntil: 'domcontentloaded' });
  await closeDialogs(page);

  const loginTrigger = page.getByRole('button', { name: 'Log In' }).first();
  if (!(await loginTrigger.isVisible().catch(() => false))) {
    return;
  }

  await loginTrigger.click();
  await page.getByRole('textbox', { name: 'User ID' }).fill(username);
  await page.getByRole('textbox', { name: 'Password' }).fill(password);
  await page.getByLabel('Log In').getByRole('button', { name: 'Log In' }).click();
  await closeDialogs(page);
}

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  const rl = readline.createInterface({ input, output });

  try {
    await loginIfNeeded(page);
    await page.goto(`${baseUrl}/connectivity/index.html#hashProtocol/hashConnectivity`, {
      waitUntil: 'domcontentloaded'
    });
    await closeDialogs(page);

    output.write('\nManual flow:\n');
    output.write('1) In the browser, open the target protocol modal (for example WSD).\n');
    output.write('2) Change a setting and click Save.\n');
    output.write('3) If restart confirmation appears, leave it open.\n');
    await rl.question('\nPress ENTER to start waiting for the restart dialog...\n');

    const restartLater = page.getByRole('button', { name: 'Restart Later' }).first();
    await restartLater.waitFor({ state: 'visible', timeout: 10 * 60 * 1000 });

    const runId = nowStamp();
    await page.screenshot({ path: `tools/recordings/manual-reboot-${runId}-00-dialog.png`, fullPage: true });

    for (let i = 1; i <= 10; i += 1) {
      await page.screenshot({
        path: `tools/recordings/manual-reboot-${runId}-${String(i).padStart(2, '0')}.png`,
        fullPage: true
      });
      if (i < 10) {
        await page.waitForTimeout(1000);
      }
    }

    output.write(`\nCaptured 11 screenshots with prefix: tools/recordings/manual-reboot-${runId}-*.png\n`);
    await rl.question('Press ENTER to click "Restart Later"...\n');
    await restartLater.click();
    output.write('Clicked Restart Later.\n');
    await rl.question('Press ENTER to exit.\n');
  } finally {
    rl.close();
    await context.close();
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

