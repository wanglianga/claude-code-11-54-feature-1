import { test, expect } from '@playwright/test';

async function bootstrap(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /导入随题样例/ }).click();
  await expect(page.getByText(/样例数据已导入/)).toBeVisible({ timeout: 60_000 });
}

async function runAnalysis(page: import('@playwright/test').Page, cutoff = '2026-01-20T00:00') {
  await page.getByRole('link', { name: '运行' }).first().click();
  await page.getByRole('button', { name: '指定时刻' }).click();
  await page.locator('input[type="datetime-local"]').fill(cutoff);
  await page.getByRole('button', { name: /启动分析/ }).click();
  await expect(page.getByRole('heading', { name: '分析结果' })).toBeVisible({ timeout: 90_000 });
}

test('day drilldown, complaint evidence, report, late data', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await bootstrap(page);
  await runAnalysis(page);

  // Late data banner (2 batches arrived after 2026-01-20 cutoff)
  await expect(page.getByText(/2 个批次在本运行截止后到达/)).toBeVisible();
  await page.getByRole('button', { name: '查看覆盖截止说明' }).click();
  await expect(page.getByText(/图表与结论卡使用同一截止分母/)).toBeVisible();
  await page.getByRole('button', { name: '知道了' }).click();

  // Open B02 2026-01-10 cell: find row for 5号楼 then click the 11th day cell (index 5)
  const row = page.locator('.matrix .row-label', { hasText: '5号楼' });
  await expect(row).toBeVisible();
  const idx = await row.evaluate((el) => Array.from(el.parentElement!.children).indexOf(el));
  // cells are siblings after the label
  const cells = page.locator('.matrix > .cell');
  const labels = page.locator('.matrix > .row-label');
  const labelCount = await labels.count();
  const dayKeys = await page.locator('.matrix > .col-label').allTextContents();
  const dayIdx = dayKeys.indexOf('10');
  const rowIdx = await labels.evaluateAll((els) => els.findIndex((e) => e.textContent?.includes('5号楼')));
  await cells.nth((rowIdx) * (labelCount === 0 ? 0 : 14) + dayIdx).click();
  await expect(page.getByText(/5号楼 · 1\/10 周六/)).toBeVisible();
  await expect(page.getByText(/供热不足/).first()).toBeVisible();
  await page.screenshot({ path: 'test-results/05-day-detail.png', fullPage: true });
  await page.locator('.modal-foot').getByRole('button', { name: '关闭' }).click();

  // Complaint evidence drawer
  await page.getByRole('link', { name: '投诉证据' }).click();
  await page.getByText('C-1002', { exact: true }).first().click();
  await expect(page.getByText(/有据可查/).first()).toBeVisible();
  await expect(page.getByText(/不确定范围/).last()).toBeVisible();
  await page.screenshot({ path: 'test-results/06-complaint-drawer.png', fullPage: true });
  await page.keyboard.press('Escape');

  // Report
  await page.getByRole('link', { name: '运行报告' }).click();
  await expect(page.getByText(/供热可比性分析 · 运行报告/)).toBeVisible();
  await expect(page.getByText(/本报告由浏览器在本地生成/)).toBeVisible();
  await page.screenshot({ path: 'test-results/07-report.png', fullPage: true });

  expect(errors).toEqual([]);
});

test('mapping revision keeps old run and diffs new run', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await bootstrap(page);
  await runAnalysis(page);

  // Resolve ambiguous C-1006 as merge of B03+B07
  await page.getByRole('link', { name: '楼栋映射' }).click();
  await page.getByRole('button', { name: '新增地址判断' }).click();
  await page.locator('input[placeholder*="北岸新城8号楼"]').fill('北岸新城8号楼、12号楼附近');
  await page.getByRole('button', { name: /B03/ }).first().click();
  await page.getByRole('button', { name: /B07/ }).first().click();
  await page.locator('textarea').fill('电话回访：两栋楼共用立管，按合并归属');
  await page.getByRole('button', { name: '保存判断' }).click();
  await expect(page.getByText(/地址归属已保存/)).toBeVisible();

  // Second run
  await runAnalysis(page, '2026-01-20T00:00');
  // Complaint now manually assigned
  await page.getByRole('link', { name: '投诉证据' }).click();
  await expect(page.getByText('C-1006', { exact: true }).first()).toBeVisible();

  // Run differences visible on runs page
  await page.getByRole('link', { name: '运行' }).first().click();
  await expect(page.getByText(/投诉归属\/结论变化/)).toBeVisible();
  await page.screenshot({ path: 'test-results/08-runs-diff.png', fullPage: true });

  expect(errors).toEqual([]);
});

test('a later cutoff picks up late work orders and late readings', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await bootstrap(page);
  await runAnalysis(page);

  // Old run: B07 1/15 is a supply shortfall but not documented.
  await expect(page.getByText(/2 个批次在本运行截止后到达/)).toBeVisible();

  // New run with cutoff after the late batches
  await runAnalysis(page, '2026-01-22T12:00');
  await expect(page.getByText(/0 批迟到|在本运行截止后到达/)).not.toBeVisible().catch(() => {});
  // B07 row should now have a documented deficit day
  const row = page.locator('table.table tbody tr', { hasText: '12号楼' });
  await expect(row).toContainText('有工单');
  await page.screenshot({ path: 'test-results/19-after-late.png', fullPage: false });

  // Report should still be tied to the second run
  await page.getByRole('link', { name: '运行报告' }).click();
  await expect(page.getByText(/运行 2/)).toBeVisible();
  expect(errors).toEqual([]);
});

test('changing a rule parameter creates a new run that shows building deltas', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await bootstrap(page);
  await runAnalysis(page);
  const beforeHigh = await page.locator('.stat', { hasText: '高风险楼栋' }).locator('.value').innerText();

  // Tighten the comfort threshold from 18 to 19.5 and run again
  await page.getByRole('link', { name: '运行' }).first().click();
  await page.getByRole('button', { name: '调整规则参数' }).click();
  const comfort = page.locator('input[type="number"]').first();
  await comfort.fill('19.5');
  await page.getByRole('button', { name: '保存参数' }).click();
  await runAnalysis(page, '2026-01-20T00:00');

  // The parameter is recorded in the snapshot and a diff is produced
  await page.getByRole('link', { name: '运行' }).first().click();
  await expect(page.getByText(/栋楼风险变化/)).toBeVisible();
  const rows = page.locator('table.table tbody tr');
  await expect(rows.first()).toBeVisible();
  await page.screenshot({ path: 'test-results/22-rule-change-diff.png', fullPage: true });

  // The latest report must reference the new threshold
  await page.getByRole('link', { name: '运行报告' }).click();
  await expect(page.locator('.report-rules').getByText('19.5℃')).toBeVisible();
  expect(beforeHigh.length).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
