import { lazy } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom'
import { ApiError } from './api/client'
import AuthGate from './components/AuthGate'
import Layout from './components/Layout'
import OverviewPage from './pages/OverviewPage'
import LoginPage from './pages/LoginPage'
import { EmptyState } from './components/ui'
import { buttonClass } from './components/styles'
import { IconSearch } from './components/icons'

// Heavy pages (React Flow, CodeMirror) load on demand.
const TopologyPage = lazy(() => import('./pages/TopologyPage'))
const PoliciesPage = lazy(() => import('./pages/PoliciesPage'))
const PolicyDetailPage = lazy(() => import('./pages/PolicyDetailPage'))
const PolicyNewPage = lazy(() => import('./pages/PolicyNewPage'))
const SimulatorPage = lazy(() => import('./pages/SimulatorPage'))
const BuilderPage = lazy(() => import('./pages/BuilderPage'))
const AuditPage = lazy(() => import('./pages/AuditPage'))
const FirewallPage = lazy(() => import('./pages/FirewallPage'))

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5_000,
      refetchOnWindowFocus: false,
      // Client errors (401/403/404/422) will not heal on retry.
      retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
    },
  },
})

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="login" element={<LoginPage />} />
          <Route
            element={
              <AuthGate>
                <Layout />
              </AuthGate>
            }
          >
            <Route index element={<OverviewPage />} />
            <Route path="firewall" element={<FirewallPage />} />
            <Route path="topology" element={<TopologyPage />} />
            <Route path="policies" element={<PoliciesPage />} />
            <Route path="policies/new" element={<PolicyNewPage />} />
            <Route path="policies/:namespace/:name" element={<PolicyDetailPage />} />
            <Route path="simulator" element={<SimulatorPage />} />
            <Route path="builder" element={<BuilderPage />} />
            <Route path="audit" element={<AuditPage />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}

function NotFound() {
  return (
    <EmptyState
      className="h-full"
      icon={<IconSearch size={22} />}
      title="This page does not exist"
      action={
        <Link to="/" className={buttonClass('primary')}>
          Back to overview
        </Link>
      }
    >
      Check the address, or use the search (Ctrl+K) to jump anywhere.
    </EmptyState>
  )
}
