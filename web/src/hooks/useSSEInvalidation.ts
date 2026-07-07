import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'

// Resources whose changes affect the topology graph.
const TOPOLOGY_SOURCES = new Set(['pods', 'networkpolicies', 'namespaces'])

/**
 * Opens one EventSource to /api/v1/events and invalidates the matching
 * TanStack Query keys on every `invalidate` event. Reconnection is handled
 * by the browser's native EventSource backoff.
 */
export function useSSEInvalidation() {
  const queryClient = useQueryClient()

  useEffect(() => {
    const source = new EventSource('/api/v1/events')
    source.addEventListener('invalidate', (ev) => {
      try {
        const { resource } = JSON.parse((ev as MessageEvent).data) as { resource: string }
        void queryClient.invalidateQueries({ queryKey: [resource] })
        if (TOPOLOGY_SOURCES.has(resource)) {
          void queryClient.invalidateQueries({ queryKey: ['topology'] })
        }
      } catch {
        // malformed event; ignore
      }
    })
    return () => source.close()
  }, [queryClient])
}
