import { request, type FullConfig } from '@playwright/test'

// Signs in once and stores the session cookie for every test, so the suite
// stays well under the server's per-IP sign-in rate limit.
export const STORAGE_STATE = 'e2e-auth/editor.json'

export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0].use.baseURL!
  const ctx = await request.newContext({ baseURL })
  const me = await (await ctx.get('/api/v1/auth/me')).json()
  if (me.mode === 'token') {
    const res = await ctx.post('/api/v1/auth/login', {
      headers: { 'X-Requested-With': 'e2e' },
      data: { token: process.env.FWUI_TOKEN ?? '' },
    })
    if (!res.ok()) throw new Error(`sign-in failed: ${res.status()} ${await res.text()}`)
  }
  await ctx.storageState({ path: STORAGE_STATE })
  await ctx.dispose()
}
