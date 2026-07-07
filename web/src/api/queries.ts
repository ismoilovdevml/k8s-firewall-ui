import { useQuery } from '@tanstack/react-query'
import { apiGet } from './client'
import type { ClusterInfo, NamespaceInfo, PodInfo, PolicySummary, Topology } from './types'

// Query keys are aligned with SSE invalidation events: the first segment is
// the resource name the backend sends in `{"resource": "..."}`.

export function useClusterInfo() {
  return useQuery({
    queryKey: ['cluster-info'],
    queryFn: () => apiGet<ClusterInfo>('/api/v1/cluster-info'),
    staleTime: Infinity,
  })
}

export function useNamespaces() {
  return useQuery({
    queryKey: ['namespaces'],
    queryFn: () => apiGet<NamespaceInfo[]>('/api/v1/namespaces'),
  })
}

export function useNamespacePods(namespace: string) {
  return useQuery({
    queryKey: ['pods', namespace],
    queryFn: () => apiGet<PodInfo[]>(`/api/v1/namespaces/${namespace}/pods`),
    enabled: namespace !== '',
  })
}

export function usePolicies(namespace?: string) {
  return useQuery({
    queryKey: ['networkpolicies', namespace ?? 'all'],
    queryFn: () =>
      apiGet<PolicySummary[]>(
        namespace ? `/api/v1/networkpolicies?namespace=${namespace}` : '/api/v1/networkpolicies',
      ),
  })
}

export function useTopology(namespaces: string[]) {
  return useQuery({
    // Depends on pods + networkpolicies; invalidated on both (see useSSEInvalidation).
    queryKey: ['topology', namespaces.join(',')],
    queryFn: () => apiGet<Topology>(`/api/v1/topology?namespaces=${namespaces.join(',')}`),
    enabled: namespaces.length > 0,
    retry: false,
  })
}
