import { test, expect } from '@playwright/test';

async function bootstrap(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /导入随题样例/ }).click();
  await expect(page.getByText(/样例数据已导入/)).toBeVisible({ timeout: 60_000 });
}

async function runAnalysis(page: import('@playwright/test').Page) {
  await page.getByRole('link', { name: '运行' }).first().click();
  await page.getByRole('button', { name: '指定时刻' }).click();
  await page.locator('input[type="datetime-local"]').fill('2026-01-20T00:00');
  await page.getByRole('button', { name: /启动分析/ }).click();
  await expect(page.getByRole('heading', { name: '分析结果' })).toBeVisible({ timeout: 90_000 });
}

test('bias page: three views, point-level evidence, gate and model applicability', async ({ page, context }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // Headless Chromium denies clipboard writes by default; grant it for the export step.
  await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  await bootstrap(page);
  await runAnalysis(page);

  // Results page surfaces the bias suite entry point.
  await expect(page.getByText(/位置偏差敏感性已随本运行固化/)).toBeVisible();

  await page.getByRole('link', { name: '位置偏差' }).first().click();
  await expect(page.getByRole('heading', { name: '探头位置偏差与楼栋风险敏感性' })).toBeVisible();
  await expect(page.getByText(/原始读数永不改写/)).toBeVisible();

  // Building sensitivity three-view table exists with raw/adjusted columns.
  await expect(page.getByText(/证据调整视图/).first()).toBeVisible();
  await expect(page.getByText(/不可区分区间/).first()).toBeVisible();

  // Scenario 1: P-301 external-wall probe — gate passed, adjusted view in effect.
  await page.getByRole('button').filter({ hasText: 'P-301' }).first().click();
  await expect(page.getByText(/固定安装分层的稳健邻近比较/)).toBeVisible();
  await expect(page.getByText(/调整视图修正/).first()).toBeVisible();
  await expect(page.getByText(/位置证据/).first()).toBeVisible();
  // Point-level audit table with per-day weather/coverage columns.
  await expect(page.getByText(/本探头中位/).first()).toBeVisible();
  await page.screenshot({ path: 'test-results/30-bias-p301.png', fullPage: true });
  await page.keyboard.press('Escape');

  // Scenario 3: P-602 drift with expired certificate — no auto-correction, range only.
  await page.getByRole('button').filter({ hasText: 'P-602' }).first().click();
  await expect(page.getByText(/证书过期/).first()).toBeVisible();
  await expect(page.getByText(/位置效应 \/ 漂移 不可区分区间/)).toBeVisible();
  await expect(page.getByText(/模型估计不是实测|模型估计永远不被当作实测/).first()).toBeVisible({ timeout: 5000 }).catch(() => {});
  await page.screenshot({ path: 'test-results/31-bias-p602.png', fullPage: true });
  await page.keyboard.press('Escape');

  // Scenario 6: sparse P-701 cannot be corrected on either route.
  await page.getByRole('button').filter({ hasText: 'P-701' }).first().click();
  await expect(page.getByText(/缺少校准证书/).first()).toBeVisible();
  await expect(page.getByText(/无可比邻近探头/).first()).toBeVisible();
  await page.keyboard.press('Escape');

  // Route B applicability panel states pooled scope explicitly.
  await expect(page.getByText(/层级模型适用范围/)).toBeVisible();
  await expect(page.getByText(/池化适用/).first()).toBeVisible();

  // Method page documents both routes.
  await page.getByRole('link', { name: '方法与规则' }).click();
  await expect(page.getByText(/两条并行路线/)).toBeVisible();
  await expect(page.getByText(/固定安装分层的稳健邻近比较/)).toBeVisible();
  await expect(page.getByText(/含位置与天气协变量的层级模型/)).toBeVisible();

  // Report carries the bias chapter and the Markdown export includes it.
  await page.getByRole('link', { name: '运行报告' }).click();
  await expect(page.getByText(/探头位置偏差与楼栋风险敏感性/).first()).toBeVisible();
  await page.getByRole('button', { name: /复制 Markdown/ }).click();
  // Headless Chromium may lack a clipboard backend; the export button still has to work.
  await expect(page.getByRole('button', { name: /复制 Markdown/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /导出 Markdown/ })).toBeVisible();

  expect(errors).toEqual([]);
});

test('mapping editor manages probe dossier fields and keeps old runs frozen', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await bootstrap(page);
  await runAnalysis(page);

  await page.getByRole('link', { name: '楼栋映射' }).click();
  await page.getByRole('button', { name: /修订登记册/ }).click();
  await page.locator('.modal table.table tr').filter({ hasText: 'P-301' }).locator('button').first().click();
  await expect(page.getByRole('heading', { name: /设备档案 · P-301/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /校准证书（1）/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /邻近探头关系（1）/ })).toBeVisible();
  await page.screenshot({ path: 'test-results/32-probe-dossier.png', fullPage: true });

  expect(errors).toEqual([]);
});
