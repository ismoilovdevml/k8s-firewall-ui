import { expect, test, type Page } from '@playwright/test'
import { deletePolicy, editorToken, signOut } from './helpers'

// Product walkthrough recorded as a video for the README
// (docs/media/walkthrough.*). Runs only with WALKTHROUGH=1 because it is
// deliberately slow. Regenerate: WALKTHROUGH=1 hack/e2e/run.sh walkthrough
test.skip(!process.env.WALKTHROUGH, 'set WALKTHROUGH=1 to record the walkthrough')
test.use({ video: { mode: 'on', size: { width: 1440, height: 900 } }, launchOptions: { slowMo: 60 } })
test.setTimeout(240_000)

/** Shows a caption bar at the bottom of the page (survives until next navigation). */
async function caption(page: Page, text: string, hold = 2200) {
  await page.evaluate((t) => {
    let el = document.getElementById('__caption')
    if (!el) {
      el = document.createElement('div')
      el.id = '__caption'
      Object.assign(el.style, {
        position: 'fixed', left: '50%', bottom: '24px', transform: 'translateX(-50%)', zIndex: '9999',
        background: 'rgba(6,55,58,0.94)', color: '#fff', padding: '12px 22px', borderRadius: '12px',
        font: '600 18px Inter, system-ui, sans-serif', boxShadow: '0 8px 30px rgba(0,0,0,.25)', maxWidth: '80%',
        textAlign: 'center',
      })
      document.body.appendChild(el)
    }
    el.textContent = t
  }, text)
  await page.waitForTimeout(hold)
}

async function pickPod(page: Page, side: string, ns: string, prefix: string) {
  await page.getByLabel(`${side} namespace`).selectOption(ns)
  const pod = page.getByLabel(`${side} pod`)
  await expect(pod.locator('option', { hasText: prefix }).first()).toBeAttached()
  await pod.selectOption((await pod.locator('option', { hasText: prefix }).first().getAttribute('value'))!)
}

test('walkthrough', async ({ page }) => {
  await signOut(page)
  await deletePolicy(page, 'analytics', 'default-deny-all')

  // 1. Sign in
  await page.goto('/')
  await caption(page, 'Sign in with your own Kubernetes token — your RBAC decides what you can change')
  await page.getByLabel('bearer token').pressSequentially(editorToken.slice(0, 40), { delay: 8 })
  await page.getByLabel('bearer token').fill(editorToken)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Security overview' })).toBeVisible()

  // 2. Overview
  await caption(page, 'Security overview: posture score, isolation coverage, and what to fix first', 3000)
  await caption(page, 'Critical: payments-api is egress-isolated without a DNS rule — its DNS lookups fail', 3000)
  await page.getByRole('button', { name: /shop/ }).click()
  await caption(page, 'Drill into a namespace to see which policies isolate every pod', 3000)

  // 3. Policy with a typo
  await page.getByRole('link', { name: 'Policies' }).click()
  await caption(page, 'Every policy with its directions, matched pods and detected issues', 2500)
  await page.getByRole('link', { name: 'ledger-db-ingress' }).click()
  await caption(page, 'A label typo (payment-api vs payments-api) — caught automatically', 3200)

  // 4. Topology
  await page.getByRole('link', { name: /Topology/ }).click()
  await expect(page.locator('.react-flow__node').first()).toBeVisible()
  await caption(page, 'Namespace view: how every team can reach every other — scales to large clusters', 3500)
  await page.locator('.react-flow__node', { hasText: 'shop' }).click()
  await page.getByRole('button', { name: /^payments\s*\d+$/ }).click()
  await page.waitForTimeout(800)
  await caption(page, 'Live topology: green = allowed by policy, red = blocked, dotted = no policy', 3500)
  await page.getByRole('button', { name: /^blocked/ }).click()
  await caption(page, 'Hide blocked edges to see only what can actually talk', 3000)

  // 5. Simulator
  await page.getByRole('link', { name: /Simulator/ }).click()
  await pickPod(page, 'source', 'shop', 'frontend-')
  await pickPod(page, 'destination', 'shop', 'cart-')
  await page.getByLabel('port').fill('8080')
  await page.getByRole('button', { name: 'Simulate' }).click()
  await caption(page, 'Can frontend reach cart on 8080? Yes — and here is the exact rule on each side', 3200)
  await pickPod(page, 'destination', 'shop', 'redis-')
  await page.getByLabel('port').fill('6379')
  await page.getByRole('button', { name: 'Simulate' }).click()
  await caption(page, 'frontend → redis:6379 is blocked: frontend may only egress to the API tier', 3000)

  // 6. Template + impact preview + create
  await page.goto('/policies/new?namespace=analytics')
  await caption(page, 'Start from a proven template…', 1500)
  await page.getByRole('button', { name: /Default deny all \(keeps DNS\)/ }).click()
  await page.getByRole('button', { name: 'Preview impact' }).click()
  await expect(page.getByText(/become blocked/)).toBeVisible()
  await caption(page, '…and preview exactly which connections change before you apply', 3200)
  await page.getByRole('button', { name: 'Validate (dry-run)' }).click()
  await caption(page, 'Server-side dry-run validation', 1800)
  await page.getByRole('button', { name: 'Create policy' }).click()
  await expect(page).toHaveURL(/default-deny-all$/)
  await caption(page, 'Applied with the signed-in user’s own credentials', 2200)

  // 7. Audit
  await page.getByRole('link', { name: /Audit log/ }).click()
  await page.getByRole('button', { name: 'Details' }).first().click()
  await caption(page, 'Audit log: who changed what, from where, with a YAML diff', 3200)

  // 8. Delete with reverse impact
  await page.goto('/policies/analytics/default-deny-all')
  await page.getByRole('button', { name: 'Delete' }).click()
  await expect(page.getByText(/become allowed/)).toBeVisible()
  await caption(page, 'Deleting shows the reverse impact first', 2600)
  await page.getByRole('button', { name: 'Delete policy' }).click()
  await expect(page).toHaveURL(/\/policies$/)
  await caption(page, 'k8s-firewall-ui — a firewall UI for Kubernetes NetworkPolicies', 2500)
})
