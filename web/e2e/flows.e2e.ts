import { expect, test, type APIRequestContext } from '@playwright/test'
import { canConnect, deleteManaged, eventually } from './cluster'

// Observed traffic comes from the node agent reading conntrack. These tests
// generate real connections, wait for the agent to report them, then build
// a least-privilege policy from what was observed and verify it against
// real traffic.
test.describe.configure({ mode: 'serial' })
test.skip(!process.env.KUBECONFIG, 'needs a real cluster (hack/e2e/run.sh)')

const FLOWS = '/api/v1/flows?namespace=analytics&workload=deployment/collector'

interface Row {
  peer: { kind: string; namespace?: string; workload?: string; cidr?: string }
  ports: { port: number; allowedNow: boolean }[]
}

async function observedOutbound(request: APIRequestContext): Promise<Row[]> {
  const res = await request.get(FLOWS)
  return (await res.json()).outbound as Row[]
}

test.afterAll(() => deleteManaged('analytics', 'fwui-collector-egress'))

test('the agent reports real connections with their current verdict', async ({ page }) => {
  deleteManaged('analytics', 'fwui-collector-egress')
  for (let i = 0; i < 3; i++) expect(canConnect('analytics', 'collector', 'analytics', 'dashboard', 3000)).toBe(true)

  await expect
    .poll(async () => (await observedOutbound(page.request)).some((r) => r.peer.workload === 'deployment/dashboard'), {
      timeout: 30_000,
    })
    .toBe(true)

  await page.goto('/firewall?namespace=analytics&workload=deployment/collector')
  const row = page.locator('[data-observed="outbound"] tr[data-observed-peer="analytics/deployment/dashboard"]')
  await expect(row).toContainText('✓ 3000/TCP')
  await expect(page.getByText(/node agents? reporting/)).toBeVisible()
  await page.screenshot({ path: 'e2e-results/shots/observed.png', fullPage: true })
})

test('learn: allow only observed traffic, verified by real connections', async ({ page }) => {
  const observed = await observedOutbound(page.request)
  const observedIDs = new Set(observed.filter((r) => r.peer.kind === 'workload').map((r) => `${r.peer.namespace}/${r.peer.workload}`))

  // A peer that is reachable today but was never observed: it must be closed
  // by the learned policy.
  const access = await (await page.request.get('/api/v1/access?namespace=analytics&workload=deployment/collector')).json()
  const candidate = (access.outbound as { peer: Row['peer']; verdict: string; ports?: { port: number }[] }[]).find(
    (r) =>
      r.peer.kind === 'workload' &&
      r.verdict !== 'blocked' &&
      r.peer.namespace !== 'kube-system' &&
      !observedIDs.has(`${r.peer.namespace}/${r.peer.workload}`) &&
      (r.ports?.length ?? 0) > 0,
  )

  await page.goto('/firewall?namespace=analytics&workload=deployment/collector')
  await page.getByRole('button', { name: 'Allow only observed outbound' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('verified by the simulator')).toBeVisible()
  await expect(dialog.getByText('analytics/fwui-collector-egress')).toBeVisible()
  await expect(dialog.getByText('+           k8s-app: kube-dns')).toBeVisible()
  await page.screenshot({ path: 'e2e-results/shots/learn-plan.png', fullPage: true })
  await dialog.getByRole('button', { name: /^Restrict — apply/ }).click()
  await expect(dialog.getByText(/^Applied:/)).toBeVisible()
  await dialog.getByRole('button', { name: 'Done' }).click()

  // Observed traffic keeps working…
  expect(await eventually(() => canConnect('analytics', 'collector', 'analytics', 'dashboard', 3000), true)).toBe(true)
  // …and an unobserved peer that was open is now closed.
  if (candidate) {
    const app = candidate.peer.workload!.split('/')[1]
    const port = candidate.ports![0].port
    expect(
      await eventually(() => canConnect('analytics', 'collector', candidate.peer.namespace!, app, port), false),
      `${candidate.peer.namespace}/${app}:${port} should be blocked`,
    ).toBe(false)
  }
})
