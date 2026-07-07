import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import TopologyPage from './pages/TopologyPage'
import PoliciesPage from './pages/PoliciesPage'
import SimulatorPage from './pages/SimulatorPage'
import BuilderPage from './pages/BuilderPage'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 5_000, refetchOnWindowFocus: false },
  },
})

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<TopologyPage />} />
            <Route path="policies" element={<PoliciesPage />} />
            <Route path="simulator" element={<SimulatorPage />} />
            <Route path="builder" element={<BuilderPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
