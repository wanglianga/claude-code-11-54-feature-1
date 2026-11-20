import { test, expect } from '@playwright/test';

test('full acceptance walkthrough', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: '来源登记' })).toBeVisible();

  await page.getByRole('button', { name: /导入随题样例/ }).click();
  await expect(page.getByText(/样例数据已导入/)).toBeVisible({ timeout: 60_000 });
  await page.screenshot({ path: 'test-results/01-sources.png', fullPage: true });

  await page.getByRole('link', { name: '覆盖对齐' }).click();
  await expect(page.getByText(/无探头楼栋/)).toBeVisible();
  await page.screenshot({ path: 'test-results/02-coverage.png', fullPage: true });

  await page.getByRole('link', { name: '运行' }).first().click();
  await expect(page.getByRole('heading', { name: '分析运行' })).toBeVisible();
  await page.getByRole('button', { name: '指定时刻' }).click();
  await page.locator('input[type="datetime-local"]').fill('2026-01-20T00:00');
  await page.getByRole('button', { name: /启动分析/ }).click();
  await expect(page.getByRole('heading', { name: '分析结果' })).toBeVisible({ timeout: 60_000 });
  await page.screenshot({ path: 'test-results/03-results.png', fullPage: true });

  await expect(page.getByText(/高风险楼栋/)).toBeVisible();
  await page.getByRole('link', { name: '投诉证据' }).click();
  await expect(page.getByText(/C-1002/)).toBeVisible();
  await page.screenshot({ path: 'test-results/04-complaints.png', fullPage: true });

  expect(errors).toEqual([]);
});
