import { expect, test } from '@playwright/test'
import { deletePolicy, editorToken, signIn, signOut, tenantToken, viewerToken } from './helpers'

test.describe.configure({ mode: 'serial' })

test.describe('sign-in', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

test('rejects an invalid token and signs in with a valid one', async ({ page }) => {
  const me = await (await page.request.get('/api/v1/auth/me')).json()
  test.skip(me.mode !== 'token', 'server is not in token auth mode')
  await page.goto('/policies')
  await expect(page).toHaveURL(/\/login\?next=%2Fpolicies/)
  await page.getByLabel('bearer token').fill('not-a-real-token')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('alert')).toContainText('rejected this token')

  await page.getByLabel('bearer token').fill(editorToken)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/policies$/)
  await expect(page.getByText('signed in as')).toBeVisible()
  await page.screenshot({ path: 'e2e-results/shots/policies.png', fullPage: true })
})
})

test('overview reports posture and the planted mistakes', async ({ page }) => {
  await signIn(page)
  await expect(page.getByText('posture score')).toBeVisible()
  // payments-api is egress-isolated without a DNS rule.
  await expect(page.getByText('DNS_EGRESS_BLOCKED')).toBeVisible()
  // ledger-db-ingress allows app=payment-api (typo for payments-api).
  await page.getByLabel('Filter findings by severity').selectOption('warning')
  await expect(page.getByText('PEER_MATCHES_NOTHING')).toBeVisible()
  await page.getByLabel('Filter findings by severity').selectOption('all')

  // The compliance report downloads as Markdown.
  const dl = page.waitForEvent('download')
  await page.getByRole('link', { name: 'Markdown' }).click()
  expect((await dl).suggestedFilename()).toMatch(/^networkpolicy-posture-\d{8}-\d{4}\.md$/)

  // Drill into a namespace: every shop pod is isolated by named policies.
  await page.getByRole('button', { name: /shop/ }).click()
  await expect(page.getByRole('link', { name: 'default-deny-all' }).first()).toBeVisible()
  await page.screenshot({ path: 'e2e-results/shots/overview.png', fullPage: true })
})

test('policy detail surfaces the label typo', async ({ page }) => {
  await signIn(page)
  await page.goto('/policies')
  await page.getByRole('link', { name: 'ledger-db-ingress' }).click()
  await expect(page.getByText('issues detected (1)')).toBeVisible()
  await expect(page.getByText(/app=payment-api.*currently matches no pod/)).toBeVisible()
  await page.screenshot({ path: 'e2e-results/shots/policy-detail.png', fullPage: true })
})

test('topology maps workloads and filters edges by verdict', async ({ page }) => {
  await signIn(page)
  await page.goto('/topology')
  // Namespace level first: one node per application namespace.
  await expect(page.locator('.react-flow__node')).toHaveCount(5)
  await expect(page.getByRole('button', { name: /^partial/ })).toBeVisible()
  await page.screenshot({ path: 'e2e-results/shots/topology-namespaces.png' })
  // Drill into shop.
  await page.locator('.react-flow__node', { hasText: 'shop' }).click()
  await expect(page.getByRole('button', { name: 'Workloads' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.react-flow__node')).toHaveCount(4) // frontend, cart, catalog, redis
  const blocked = page.getByRole('button', { name: /^blocked/ })
  const before = await page.locator('.react-flow__edge').count()
  await blocked.click()
  await expect(blocked).toHaveAttribute('aria-pressed', 'false')
  await expect.poll(() => page.locator('.react-flow__edge').count()).toBeLessThan(before)
  await page.screenshot({ path: 'e2e-results/shots/topology.png' })
})

async function pickPod(page: import('@playwright/test').Page, side: string, ns: string, prefix: string) {
  await page.getByLabel(`${side} namespace`).selectOption(ns)
  const pod = page.getByLabel(`${side} pod`)
  await expect(pod.locator('option', { hasText: prefix }).first()).toBeAttached()
  const value = await pod.locator('option', { hasText: prefix }).first().getAttribute('value')
  await pod.selectOption(value!)
}

test('simulator explains allowed and blocked connections', async ({ page }) => {
  await signIn(page)
  await page.goto('/simulator')
  // frontend -> cart:8080 is allowed on both sides (verified against the
  // real cluster by test/e2e).
  await pickPod(page, 'source', 'shop', 'frontend-')
  await pickPod(page, 'destination', 'shop', 'cart-')
  await page.getByLabel('port').fill('8080')
  await page.getByRole('button', { name: 'Simulate' }).click()
  await expect(page.getByText('Connection allowed')).toBeVisible()
  await expect(page.getByText(/frontend-egress egress rule #1 allows/)).toBeVisible()
  await page.screenshot({ path: 'e2e-results/shots/simulator-allowed.png', fullPage: true })

  // frontend -> redis:6379 is blocked: frontend may only egress to tier=api.
  await pickPod(page, 'destination', 'shop', 'redis-')
  await page.getByLabel('port').fill('6379')
  await page.getByRole('button', { name: 'Simulate' }).click()
  await expect(page.getByText('Connection blocked')).toBeVisible()
  await page.screenshot({ path: 'e2e-results/shots/simulator-blocked.png', fullPage: true })
})

test('create a default-deny policy from a template with impact preview, then delete it', async ({ page }) => {
  await signIn(page)
  await deletePolicy(page, 'analytics', 'default-deny-ingress')
  await page.goto('/policies/new?template=default-deny-ingress&namespace=analytics')
  await page.getByRole('button', { name: 'Preview impact' }).click()
  await expect(page.getByText(/connection\(s\) become blocked/)).toBeVisible()
  await expect(page.getByText('analytics/deployment/dashboard').first()).toBeVisible()
  await page.getByRole('button', { name: 'Validate (dry-run)' }).click()
  await expect(page.getByText('Valid — the API server accepts this policy.')).toBeVisible()
  await page.screenshot({ path: 'e2e-results/shots/new-policy.png', fullPage: true })

  await page.getByRole('button', { name: 'Create policy' }).click()
  await expect(page).toHaveURL(/\/policies\/analytics\/default-deny-ingress$/)
  await expect(page.getByText('Affected pods (2)')).toBeVisible()

  // The audit log attributes the change to the signed-in user.
  await page.goto('/audit')
  const row = page.getByRole('row', { name: /analytics\/default-deny-ingress/ }).first()
  await expect(row).toContainText('create')
  await expect(row).toContainText('success')
  await row.getByRole('button', { name: 'Details' }).click()
  await expect(page.getByText('+ kind: NetworkPolicy')).toBeVisible()
  await page.screenshot({ path: 'e2e-results/shots/audit.png', fullPage: true })

  // Delete shows the reverse impact before confirming.
  await page.goto('/policies/analytics/default-deny-ingress')
  await page.getByRole('button', { name: 'Delete' }).click()
  await expect(page.getByText(/become allowed/)).toBeVisible()
  await page.getByRole('button', { name: 'Delete policy' }).click()
  await expect(page).toHaveURL(/\/policies$/)
  await expect(page.getByRole('link', { name: 'default-deny-ingress' })).toHaveCount(0)
})

test('export produces re-appliable YAML', async ({ page }) => {
  await signIn(page)
  await page.goto('/policies')
  const download = page.waitForEvent('download')
  await page.getByRole('link', { name: 'Export YAML' }).click()
  const file = await download
  const text = await (await file.createReadStream()).toArray()
  const yaml = Buffer.concat(text as Buffer[]).toString()
  expect(yaml).toContain('kind: NetworkPolicy')
  expect(yaml).toContain('name: ledger-db-ingress')
  expect(yaml).not.toContain('resourceVersion')
})

test('import validates first, then applies', async ({ page }) => {
  await signIn(page)
  await deletePolicy(page, 'analytics', 'e2e-imported')
  await page.goto('/policies')
  await page.getByRole('button', { name: 'Import' }).click()
  await page.getByRole('dialog').locator('textarea').fill(
    'apiVersion: networking.k8s.io/v1\nkind: NetworkPolicy\nmetadata:\n  name: e2e-imported\n  namespace: analytics\nspec:\n  podSelector: {matchLabels: {app: dashboard}}\n  policyTypes: [Ingress]\n  ingress:\n    - from: [{podSelector: {matchLabels: {app: collector}}}]\n',
  )
  const importBtn = page.getByRole('dialog').getByRole('button', { name: 'Import', exact: true })
  await expect(importBtn).toBeDisabled()
  await page.getByRole('button', { name: 'Validate (dry-run)' }).click()
  await expect(page.getByText('Dry-run: 1 created')).toBeVisible()
  await importBtn.click()
  await expect(page.getByText('Applied: 1 created')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('link', { name: 'e2e-imported' })).toBeVisible()
  await deletePolicy(page, 'analytics', 'e2e-imported')
})

test('a read-only user cannot change policies', async ({ page }) => {
  test.skip(!viewerToken, 'FWUI_VIEWER_TOKEN not set')
  await signOut(page)
  await signIn(page, viewerToken)
  await page.goto('/policies/shop/default-deny-all')
  await expect(page.getByRole('button', { name: 'Delete' })).toBeDisabled()
  await page.goto('/policies/new?namespace=shop')
  await expect(page.getByText(/not allowed to create NetworkPolicies/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Create policy' })).toBeDisabled()
  await signOut(page)
})

test('editing shows a review diff and impact before applying', async ({ page }) => {
  await page.goto('/policies/shop/cart-to-redis')
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  const port = page.locator('input[value="6379"]').first()
  await port.fill('6380')
  await expect(page.getByText('review changes')).toBeVisible()
  await expect(page.locator('pre').getByText(/^- +port: 6379$/)).toBeVisible()
  await expect(page.locator('pre').getByText(/^\+ +port: 6380$/)).toBeVisible()
  await page.getByRole('button', { name: 'Preview impact' }).click()
  await expect(page.getByText(/Affects 1 workload/)).toBeVisible()
  await page.screenshot({ path: 'e2e-results/shots/edit-review.png', fullPage: true })
  // Leave the cluster untouched: validate only.
  await page.getByRole('button', { name: 'Validate (dry-run)' }).click()
  await expect(page.getByText('Valid — the API server accepts this policy.')).toBeVisible()
})

test('builder previews impact while drawing', async ({ page }) => {
  await page.goto('/builder')
  await expect(page.getByText('impact preview')).toBeVisible()
})

test('a tenant sees only their own namespace', async ({ page }) => {
  test.skip(!tenantToken, 'FWUI_TENANT_TOKEN not set')
  await signOut(page)
  await signIn(page, tenantToken)
  await expect(page.getByText('scoped to your namespaces')).toBeVisible()
  // Overview lists only shop.
  await expect(page.getByRole('button', { name: /shop/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /payments/ })).toHaveCount(0)
  await expect(page.getByText('DNS_EGRESS_BLOCKED')).toHaveCount(0) // a payments finding
  // Policies from other tenants are hidden and answer 404.
  await page.goto('/policies')
  await expect(page.getByRole('link', { name: 'default-deny-all' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'ledger-db-ingress' })).toHaveCount(0)
  const res = await page.request.get('/api/v1/namespaces/payments/networkpolicies/ledger-db-ingress')
  expect(res.status()).toBe(404)
  // The tenant may edit in shop.
  await page.goto('/policies/shop/cart-to-redis')
  await expect(page.getByRole('button', { name: 'Delete' })).toBeEnabled()
  await page.screenshot({ path: 'e2e-results/shots/tenant.png', fullPage: true })
  await signOut(page)
})
