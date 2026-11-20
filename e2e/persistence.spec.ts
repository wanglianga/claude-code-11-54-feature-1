import { test, expect } from '@playwright/test';

test('state persists across reloads and conflicting address decisions require a choice', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByRole('button', { name: /导入随题样例/ }).click();
  await expect(page.getByText(/样例数据已导入/)).toBeVisible({ timeout: 60_000 });

  // reload: batches are restored from IndexedDB (row count is deterministic from the sample generator)
  await page.reload();
  await expect(page.getByText('readings_2026-01.csv')).toBeVisible();
  await expect(page.getByText('19,662').first()).toBeVisible();

  // First decision for the ambiguous address: B03 only
  await page.getByRole('link', { name: '楼栋映射' }).click();
  await page.getByRole('button', { name: '新增地址判断' }).click();
  await page.locator('input[placeholder*="北岸新城8号楼"]').fill('北岸新城8号楼、12号楼附近');
  await page.getByRole('button', { name: /B03/ }).first().click();
  await page.locator('textarea').fill('第一次判断：8号楼 3 单元回访确认');
  await page.getByRole('button', { name: '保存判断' }).click();
  await expect(page.getByText(/地址归属已保存/)).toBeVisible();

  // Second decision for the same address chooses B07 -> conflict UI must appear
  await page.getByRole('button', { name: '新增地址判断' }).click();
  await page.locator('input[placeholder*="北岸新城8号楼"]').fill('北岸新城8号楼、12号楼附近');
  await page.getByRole('button', { name: /B07/ }).first().click();
  await page.locator('textarea').fill('第二次判断：按新窗口应属 12 号楼');
  await page.getByRole('button', { name: '保存判断' }).click();
  await expect(page.getByText(/发现 1 份不同的历史判断/)).toBeVisible();
  await expect(page.getByRole('button', { name: '采用本次' })).toBeVisible();
  await expect(page.getByRole('button', { name: '保留原有' })).toBeVisible();
  await expect(page.getByRole('button', { name: '合并' })).toBeVisible();
  await page.screenshot({ path: 'test-results/15-conflict.png', fullPage: true });

  // Merge, expecting both buildings retained
  await page.getByRole('button', { name: '合并', exact: true }).click();
  await expect(page.getByText(/地址归属冲突已处理/)).toBeVisible();
  await expect(page.getByText(/合并归属/).first()).toBeVisible();

  await page.reload();
  await expect(page.getByText(/合并归属/).first()).toBeVisible();
  expect(errors).toEqual([]);
});
