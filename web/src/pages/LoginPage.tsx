import { useState } from 'react'
import type { FormEvent } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { errorMessage } from '../api/client'
import { useLogin, useMe } from '../api/queries'
import { Button, Feedback } from '../components/ui'

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
    <div className="flex min-h-screen items-center justify-center bg-sidebar p-4">
      <form onSubmit={submit} className="w-full max-w-lg rounded-2xl bg-surface p-8 shadow-2xl">
        <div className="font-mono text-sm font-bold text-accent-strong">🛡 k8s-firewall-ui</div>
        <h1 className="mt-3 text-xl font-bold text-text">Sign in to the cluster</h1>
        <p className="mt-1 text-sm text-muted">
          Paste a Kubernetes bearer token. Every change you make is sent with this token, so your own
          RBAC permissions apply and the Kubernetes audit log records you as the author.
        </p>

        <label htmlFor="token" className="mt-5 block font-mono text-[11px] uppercase tracking-wide text-quiet">
          bearer token
        </label>
        <textarea
          id="token"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          rows={5}
          autoFocus
          spellCheck={false}
          autoComplete="off"
          placeholder="eyJhbGciOiJSUzI1NiIsImtpZCI6…"
          className="mt-1 w-full resize-none rounded border border-edge bg-base px-3 py-2 font-mono text-xs text-text placeholder:text-quiet focus:border-accent focus:outline-none"
        />

        {login.isError && <Feedback tone="error">{errorMessage(login.error)}</Feedback>}

        <Button type="submit" variant="primary" disabled={token.trim() === '' || login.isPending} className="mt-4 w-full py-2">
          {login.isPending ? 'Verifying…' : 'Sign in'}
        </Button>

        <details className="mt-6 text-xs text-muted">
          <summary className="cursor-pointer font-medium text-text">How do I get a token?</summary>
          <div className="mt-2 space-y-2">
            <p>A short-lived ServiceAccount token:</p>
            <pre className="overflow-x-auto rounded bg-raised p-2 font-mono text-[11px] text-text">
              kubectl -n &lt;namespace&gt; create token &lt;serviceaccount&gt; --duration=8h
            </pre>
            <p>
              Or, on clusters with OIDC sign-in, your <span className="font-mono">id_token</span> (e.g.
              from <span className="font-mono">kubectl oidc-login get-token</span>).
            </p>
            <p>The token is stored only in an encrypted, HttpOnly session cookie.</p>
          </div>
        </details>
      </form>
    </div>
  )
}
