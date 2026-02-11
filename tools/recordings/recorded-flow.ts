import { test, expect } from '@playwright/test';

test.use({
  ignoreHTTPSErrors: true,
  storageState: 'state/auth-state.json'
});

test('test', async ({ page }) => {
});