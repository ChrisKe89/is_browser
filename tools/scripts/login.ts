import { test, expect } from '@playwright/test';

test.use({
    ignoreHTTPSErrors: true
});

test('test', async ({ page }) => {
    await page.goto('https://192.168.0.107/home/index.html#hashHome');
    await page.getByRole('button', { name: 'Log In' }).click();
    await page.getByRole('textbox', { name: 'User ID' }).fill('11111');
    await page.getByRole('textbox', { name: 'User ID' }).press('Tab');
    await page.getByRole('textbox', { name: 'Password' }).fill('x-admin');
    await page.getByLabel('Log In').getByRole('button', { name: 'Log In' }).click();
    await page.getByRole('button', { name: 'Close' }).click();
    await page.getByRole('button', { name: 'Close' }).click();
});