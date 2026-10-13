import { type APIRequestContext, type Page, expect, request } from '@playwright/test';
import { E2E_OWNER_PASSWORD } from '../playwright.config';

export const uid = (p: string) => `${p}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;

export async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Username').fill('owner');
  await page.getByLabel('Password').fill(E2E_OWNER_PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible();
}

/** API client (owner) for reading values the UI shows elsewhere (roll / bundle numbers). */
export async function apiClient(): Promise<APIRequestContext & { token: string }> {
  const ctx = await request.newContext({ baseURL: 'http://localhost:4100' });
  const r = await ctx.post('/api/v1/auth/login', { data: { username: 'owner', password: E2E_OWNER_PASSWORD } });
  const token = (await r.json()).data.accessToken as string;
  const authed = await request.newContext({ baseURL: 'http://localhost:4100', extraHTTPHeaders: { authorization: `Bearer ${token}` } });
  return Object.assign(authed, { token });
}

/** Open a search picker inside the labelled field and choose the first match. */
export async function pick(page: Page, label: string | RegExp, search: string) {
  const field = page.locator('label').filter({ hasText: label }).first();
  await field.getByRole('button').first().click();
  await choose(page, search);
}

/** Picker inside a LineGrid cell (data-cell="row:col"). */
export async function gridPick(page: Page, cell: string, search: string) {
  await page.locator(`[data-cell="${cell}"]`).click();
  await choose(page, search);
}

async function choose(page: Page, search: string) {
  const input = page.getByPlaceholder('Search by code or name…');
  await input.fill(search);
  const first = page.locator('[cmdk-item]').first();
  await expect(first).toBeVisible();
  await expect(first).toContainText(new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  await page.keyboard.press('Enter');
  await expect(input).toBeHidden();
}

export async function cell(page: Page, at: string, value: string) {
  const c = page.locator(`[data-cell="${at}"]`);
  await c.fill(value);
}

export async function field(page: Page, label: string | RegExp) {
  return page.locator('label').filter({ hasText: label }).first().locator('input, select').first();
}

/** Save draft (Ctrl+S) and wait for the saved document URL. */
export async function saveDraft(page: Page) {
  await page.getByRole('button', { name: /Save (draft|changes)/ }).click();
  await expect(page.getByText(/^Saved$/).first()).toBeVisible();
  await expect(page).toHaveURL(/\/[0-9a-f-]{36}$/);
}

/** Primary state action (Post / Confirm / Approve) with its confirmation dialog. */
export async function primary(page: Page, label = 'Post') {
  await page.getByRole('button', { name: new RegExp(`^${label}`) }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: label, exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });
}

export async function withReason(page: Page, button: string | RegExp, confirm: string, reason: string) {
  await page.getByRole('button', { name: button }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox').fill(reason);
  await dialog.getByRole('button', { name: confirm, exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });
}

export async function expectStatus(page: Page, status: string) {
  await expect(page.locator('main').getByText(status, { exact: true }).first()).toBeVisible();
}

export async function docNo(page: Page, prefix: string): Promise<string> {
  const el = page.locator('h1 .font-mono');
  await expect(el).toHaveText(new RegExp(`^${prefix}/\\d{2}-\\d{2}/\\d{4}$`));
  return (await el.textContent())!.trim();
}

export function idFromUrl(page: Page): string {
  return page.url().split('/').pop()!;
}
