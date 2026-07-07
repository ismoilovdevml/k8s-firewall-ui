import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiSend, apiSendYaml } from './client'
import type { ClusterInfo, NamespaceInfo, PodInfo, PolicySummary, Topology } from './types'
import type { K8sNetworkPolicy } from '../policy/model'

export interface PolicyDetail {
  policy: K8sNetworkPolicy
  yaml: string
  affectedPods: PodInfo[]
}

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

export function usePolicyDetail(namespace: string, name: string) {
  return useQuery({
    queryKey: ['networkpolicies', namespace, name],
    queryFn: () => apiGet<PolicyDetail>(`/api/v1/namespaces/${namespace}/networkpolicies/${name}`),
  })
}

/** Payload for create/update: either a policy object or a raw YAML document. */
export type PolicyPayload = { json: K8sNetworkPolicy } | { yaml: string }

function sendPolicy(
  method: 'POST' | 'PUT',
  path: string,
  payload: PolicyPayload,
  dryRun: boolean,
): Promise<K8sNetworkPolicy> {
  const url = dryRun ? `${path}?dryRun=true` : path
  return 'yaml' in payload
    ? apiSendYaml<K8sNetworkPolicy>(method, url, payload.yaml)
    : apiSend<K8sNetworkPolicy>(method, url, payload.json)
}

export function useCreatePolicy() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ namespace, payload, dryRun = false }: {
      namespace: string
      payload: PolicyPayload
      dryRun?: boolean
    }) => sendPolicy('POST', `/api/v1/namespaces/${namespace}/networkpolicies`, payload, dryRun),
    onSuccess: (_, { dryRun }) => {
      if (!dryRun) void qc.invalidateQueries({ queryKey: ['networkpolicies'] })
    },
  })
}

export function useUpdatePolicy() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ namespace, name, payload, dryRun = false }: {
      namespace: string
      name: string
      payload: PolicyPayload
      dryRun?: boolean
    }) =>
      sendPolicy('PUT', `/api/v1/namespaces/${namespace}/networkpolicies/${name}`, payload, dryRun),
    onSuccess: (_, { dryRun }) => {
      if (!dryRun) void qc.invalidateQueries({ queryKey: ['networkpolicies'] })
    },
  })
}

export function useDeletePolicy() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ namespace, name }: { namespace: string; name: string }) =>
      apiSend<{ status: string }>('DELETE', `/api/v1/namespaces/${namespace}/networkpolicies/${name}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['networkpolicies'] }),
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
