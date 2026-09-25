import { expect, type Page } from '@playwright/test'

export const editorToken = process.env.FWUI_TOKEN ?? ''
export const viewerToken = process.env.FWUI_VIEWER_TOKEN ?? ''
export const tenantToken = process.env.FWUI_TENANT_TOKEN ?? ''

/** Signs in with a token when the server runs in token mode; no-op otherwise. */
export async function signIn(page: Page, token = editorToken) {
  await page.goto('/')
  const me = await (await page.request.get('/api/v1/auth/me')).json()
  if (me.mode !== 'token' || me.user) return
  await expect(page).toHaveURL(/\/login/)
  await page.getByLabel('bearer token').fill(token)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Security overview' })).toBeVisible()
}

export async function signOut(page: Page) {
  await page.request.post('/api/v1/auth/logout', { headers: { 'X-Requested-With': 'e2e' } })
}

/** Deletes a policy through the API if it exists (test cleanup). */
export async function deletePolicy(page: Page, namespace: string, name: string) {
  await page.request.delete(`/api/v1/namespaces/${namespace}/networkpolicies/${name}`, {
    headers: { 'X-Requested-With': 'e2e' },
  })
}
