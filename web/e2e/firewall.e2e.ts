import { expect, test, type Page } from '@playwright/test'
import { canConnect, deleteManaged, eventually } from './cluster'

// The firewall console must change what the cluster actually enforces:
// every test checks real traffic before and after, from inside the pods.
test.describe.configure({ mode: 'serial' })
test.skip(!process.env.KUBECONFIG, 'needs a real cluster (hack/e2e/run.sh)')

async function applyFromRow(page: Page, table: 'Outbound' | 'Inbound', peer: string, action: 'Allow' | 'Block') {
  const card = page.locator('section', { hasText: `${table} —` })
  const row = card.locator(`tr[data-peer="${peer}"]`)
  await row.getByRole('button', { name: action, exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('verified by the simulator')).toBeVisible()
  await dialog.getByRole('button', { name: new RegExp(`^${action} — apply`) }).click()
  await expect(dialog.getByText(/^Applied:/)).toBeVisible()
  await dialog.getByRole('button', { name: 'Done' }).click()
}

test.afterAll(() => {
  deleteManaged('analytics', 'fwui-collector-egress')
  deleteManaged('payments', 'fwui-ledger-db-ingress')
})

test('block then re-allow a workload flow, enforced by the CNI', async ({ page }) => {
  deleteManaged('analytics', 'fwui-collector-egress')
  expect(canConnect('analytics', 'collector', 'analytics', 'dashboard', 3000)).toBe(true)

  await page.goto('/firewall?namespace=analytics&workload=deployment/collector')
  await expect(page.getByText('open — no policy restricts it').last()).toBeVisible()
  await page.screenshot({ path: 'e2e-results/shots/firewall.png', fullPage: true })

  await applyFromRow(page, 'Outbound', 'analytics/deployment/dashboard', 'Block')
  await expect(page.locator('tr[data-peer="analytics/deployment/dashboard"]').first()).toContainText('blocked')
  expect(await eventually(() => canConnect('analytics', 'collector', 'analytics', 'dashboard', 3000), false)).toBe(false)
  // Lockdown kept DNS working.
  await expect(page.locator('section', { hasText: 'Outbound —' }).locator('tr[data-peer="kube-system/deployment/coredns"]')).toContainText('allowed')

  await applyFromRow(page, 'Outbound', 'analytics/deployment/dashboard', 'Allow')
  expect(await eventually(() => canConnect('analytics', 'collector', 'analytics', 'dashboard', 3000), true)).toBe(true)
})

test('fix a flow broken by a label typo with one click', async ({ page }) => {
  deleteManaged('payments', 'fwui-ledger-db-ingress')
  // ledger-db-ingress allows app=payment-api (typo), so this is blocked.
  expect(canConnect('payments', 'payments-api', 'payments', 'ledger-db', 5432)).toBe(false)

  await page.goto('/firewall?namespace=payments&workload=deployment/ledger-db')
  const row = page.locator('section', { hasText: 'Inbound —' }).locator('tr[data-peer="payments/deployment/payments-api"]')
  await expect(row).toContainText('destination ingress denies')
  await row.getByRole('button', { name: 'Allow', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('payments/fwui-ledger-db-ingress')).toBeVisible()
  await expect(dialog.getByText('+       app: payments-api')).toBeVisible()
  await page.screenshot({ path: 'e2e-results/shots/firewall-plan.png', fullPage: true })
  await dialog.getByRole('button', { name: /^Allow — apply/ }).click()
  await expect(dialog.getByText(/^Applied:/)).toBeVisible()
  await dialog.getByRole('button', { name: 'Done' }).click()

  expect(await eventually(() => canConnect('payments', 'payments-api', 'payments', 'ledger-db', 5432), true)).toBe(true)
  await expect(row).toContainText('allowed')
})

test('a pod opens its workload firewall; namespaces aggregate', async ({ page }) => {
  await page.goto('/firewall?namespace=shop')
  await expect(page.getByText('whole namespace')).toBeAttached()
  const inbound = page.locator('section', { hasText: 'Inbound —' })
  await expect(inbound.locator('tr[data-peer="monitoring"]')).toContainText('pairs open')
  await page.getByLabel('pod').selectOption({ index: 1 })
  await expect(page).toHaveURL(/workload=deployment/)
})
