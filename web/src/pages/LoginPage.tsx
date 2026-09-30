import { useState } from 'react'
import type { FormEvent } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { errorMessage } from '../api/client'
import { useLogin, useMe } from '../api/queries'
import { Button, Feedback, Textarea } from '../components/ui'
import { IconCheck, IconLock, IconShieldCheck } from '../components/icons'

// Only same-origin relative paths are accepted as redirect targets.
function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/'
}

export default function LoginPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { data: me } = useMe()
  const login = useLogin()
  const [token, setToken] = useState('')
  const next = safeNext(params.get('next'))

  if (me?.user) return <Navigate to={next} replace />
  if (me && me.mode !== 'token') return <Navigate to="/" replace />

  const submit = (e: FormEvent) => {
    e.preventDefault()
    login.mutate(token, { onSuccess: () => navigate(next, { replace: true }) })
  }

  return (
    <div className="flex min-h-screen bg-base">
      <div className="relative hidden w-[44%] flex-col justify-between overflow-hidden bg-brand-deep p-10 text-brand-ink lg:flex">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-teal text-white">
            <IconShieldCheck size={20} />
          </div>
          <span className="text-lg font-semibold text-white">Firewall UI</span>
        </div>
        <div className="max-w-md">
          <h2 className="text-3xl font-semibold leading-tight text-white">
            See and control every connection in your cluster.
          </h2>
          <ul className="mt-8 space-y-4 text-sm">
            {[
              ['Live topology', 'Which workloads can reach which, under the policies you have today.'],
              ['One-click firewall', 'Allow or block any flow — planned, simulated and diffed before it is applied.'],
              ['Safe by default', 'Every change is a server-side dry-run first and lands in the audit log.'],
            ].map(([t, d]) => (
              <li key={t} className="flex gap-3">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-teal/30 text-brand-mint">
                  <IconCheck size={12} />
                </span>
                <span>
                  <span className="font-semibold text-white">{t}.</span> {d}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-brand-ink/60">Kubernetes NetworkPolicy management · open source</p>
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-brand-teal/20 blur-3xl" />
      </div>

      <div className="flex flex-1 items-center justify-center p-4 sm:p-8">
        <form onSubmit={submit} className="w-full max-w-md">
          <div className="flex items-center gap-2 lg:hidden">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-on-accent">
              <IconShieldCheck size={18} />
            </div>
            <span className="font-semibold text-text">Firewall UI</span>
          </div>
          <h1 className="mt-6 text-2xl font-semibold tracking-tight text-text lg:mt-0">Sign in to the cluster</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Paste a Kubernetes bearer token. Every change you make is sent with this token, so your own RBAC permissions
            apply and the Kubernetes audit log records you as the author.
          </p>

          <label htmlFor="token" className="mt-6 block text-sm font-medium text-text">
            Bearer token
          </label>
          <Textarea
            id="token"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            rows={5}
            autoFocus
            spellCheck={false}
            autoComplete="off"
            placeholder="eyJhbGciOiJSUzI1NiIsImtpZCI6…"
            className="mt-1.5 w-full resize-none"
          />

          {login.isError && <Feedback tone="error">{errorMessage(login.error)}</Feedback>}

          <Button
            type="submit"
            variant="primary"
            disabled={token.trim() === '' || login.isPending}
            className="mt-4 h-10 w-full"
          >
            {login.isPending ? 'Verifying…' : 'Sign in'}
          </Button>

          <details className="mt-6 rounded-xl border border-edge bg-surface p-4 text-sm text-muted">
            <summary className="cursor-pointer font-medium text-text">How do I get a token?</summary>
            <div className="mt-3 space-y-2">
              <p>A short-lived ServiceAccount token:</p>
              <pre className="overflow-x-auto rounded-lg bg-sunken p-2.5 font-mono text-[11px] text-text">
                kubectl -n &lt;namespace&gt; create token &lt;serviceaccount&gt; --duration=8h
              </pre>
              <p>
                Or, on clusters with OIDC sign-in, your <span className="font-mono">id_token</span> (e.g. from{' '}
                <span className="font-mono">kubectl oidc-login get-token</span>).
              </p>
              <p className="flex items-center gap-1.5 text-xs text-quiet">
                <IconLock size={12} /> The token is stored only in an encrypted, HttpOnly session cookie.
              </p>
            </div>
          </details>
        </form>
      </div>
    </div>
  )
}
