import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { signInAs, switchTenant } from '../fixtures/session';

// Real frontend and real backend (APP_ENV=test, see playwright.config.ts); nothing is mocked.
const backend = `http://127.0.0.1:${process.env.PORT || 3001}`;

test.beforeEach(async ({ request }) => {
  const res = await request.post(`${backend}/api/__test__/reset`);
  expect(res.status()).toBe(204);
});

async function openAs(page: Page, adminName: string): Promise<void> {
  await page.goto('/');
  await signInAs(page, adminName);
  await expect(page).toHaveURL(/\/t\/\d+\/certificates$/);
}

/** Clicks the export link and reads the downloaded file: its name, header line and data rows. */
async function downloadCsv(page: Page, exportLabel: string) {
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: exportLabel }).click();
  const download = await downloadPromise;

  const raw = readFileSync(await download.path(), 'utf8');
  expect(raw.charCodeAt(0)).toBe(0xfeff); // UTF-8 BOM
  const lines = raw.replace(/^﻿/, '').split('\r\n').filter((line) => line !== '');
  return { fileName: download.suggestedFilename(), header: lines[0]!, rows: lines.slice(1) };
}

test('alice exports all 45 HHT certificates as a Sydney-dated CSV', async ({ page }) => {
  await openAs(page, 'Alice Nguyen');

  const csv = await downloadCsv(page, 'Export 45 rows');

  expect(csv.fileName).toMatch(/^certificates-HHT-\d{4}-\d{2}-\d{2}\.csv$/);
  expect(csv.header).toBe('Learner Name,Course Title,Serial Number,Issue Date (Australia/Sydney),Status');
  expect(csv.rows).toHaveLength(45);
  expect(csv.rows.filter((row) => row.endsWith(',Revoked'))).toHaveLength(3);
  expect(csv.rows.filter((row) => row.endsWith(',Valid'))).toHaveLength(42);
});

test('the export follows the Revoked status filter and downloads only the 3 revoked rows', async ({ page }) => {
  await openAs(page, 'Alice Nguyen');

  await page.getByRole('combobox', { name: 'Status' }).click();
  await page.getByTitle('Revoked', { exact: true }).click();
  await expect(page.getByRole('link', { name: 'Export 3 rows' })).toBeVisible();

  const csv = await downloadCsv(page, 'Export 3 rows');

  expect(csv.rows).toHaveLength(3);
  for (const row of csv.rows) expect(row).toMatch(/^[^,]*,[^,]*,HHT-\d{4}-\d{6},\d{4}-\d{2}-\d{2},Revoked$/);
});

test('the SRA export is named for SRA, dated in Perth and has one row per listed certificate', async ({ page }) => {
  await openAs(page, 'Alice Nguyen');

  await switchTenant(page, 'Swan River Academy');
  // Wait for SRA's own list: until it renders, the header still shows HHT's total.
  await expect(page.getByText('15 certificates')).toBeVisible();

  const csv = await downloadCsv(page, 'Export 15 rows');

  expect(csv.fileName).toMatch(/^certificates-SRA-\d{4}-\d{2}-\d{2}\.csv$/);
  expect(csv.header).toMatch(/\(Australia\/Perth\),Status$/);
  expect(csv.rows).toHaveLength(15);
});

test('a certificate revoked in the UI is exported as Revoked', async ({ page }) => {
  await openAs(page, 'Carol Smith');
  await page.goto('/t/1/certificates/1');
  const serial = (await page.getByRole('heading', { level: 2 }).innerText()).trim();
  await page.getByRole('button', { name: 'Revoke certificate' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: 'Reason' }).fill('Duplicate record');
  await dialog.getByRole('button', { name: 'Revoke', exact: true }).click();
  await expect(page.getByTestId('status-tag').first()).toHaveText('Revoked');
  await page.getByRole('link', { name: '← Certificates' }).click();

  const csv = await downloadCsv(page, 'Export 45 rows');

  expect(csv.rows.find((row) => row.includes(`,${serial},`))).toMatch(/,Revoked$/);
  expect(csv.rows.filter((row) => row.endsWith(',Revoked'))).toHaveLength(4);
  expect(csv.rows.filter((row) => row.endsWith(',Valid'))).toHaveLength(41);
});
