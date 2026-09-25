import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Navigate, useLocation } from 'react-router-dom'
import { UNAUTHORIZED_EVENT } from '../api/client'
import { useMe } from '../api/queries'
import { Spinner } from './ui'

/**
 * Blocks the app until the user is known. Token mode redirects to /login;
 * proxy mode without identity headers explains the misconfiguration (the
 * proxy, not this app, owns sign-in).
 */
export default function AuthGate({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const location = useLocation()
  const { data: me, isLoading, error } = useMe()

  useEffect(() => {
    const onUnauthorized = () => void qc.invalidateQueries({ queryKey: ['auth', 'me'] })
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
  }, [qc])

  if (isLoading) return <Spinner label="Connecting…" />
  if (error || !me) {
    return (
      <div className="flex h-screen items-center justify-center p-6 text-sm text-block">
        Cannot reach the k8s-firewall-ui server. Check that it is running and reload.
      </div>
    )
  }
  if (me.user) return <>{children}</>
  if (me.mode === 'token') {
    const next = location.pathname + location.search
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />
  }
  return (
    <div className="flex h-screen items-center justify-center p-6">
      <div className="max-w-md rounded-xl border border-edge bg-surface p-6 text-sm text-muted shadow-sm">
        <h1 className="text-base font-bold text-text">Not signed in</h1>
        <p className="mt-2">
          This instance expects an authenticating proxy (for example oauth2-proxy) in front of it, but
          the request arrived without an identity header. Open the UI through the proxy URL, or ask
          your administrator to check the proxy configuration.
        </p>
      </div>
    </div>
  )
}
