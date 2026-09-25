import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiSend, apiSendYaml } from './client'
import type {
  AccessPlan,
  AccessReport,
  ApplyResponse,
  AuditEntry,
  AuthMe,
  ClusterInfo,
  ImpactResult,
  ImportResponse,
  NamespaceInfo,
  NamespaceTopology,
  PlanRequest,
  Permissions,
  PodInfo,
  PodIsolation,
  PolicySummary,
  PostureReport,
  Topology,
} from './types'
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
    enabled: namespace !== '' && name !== '',
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

// ---- auth ----

export function useMe() {
  return useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => apiGet<AuthMe>('/api/v1/auth/me'),
    staleTime: 60_000,
    retry: false,
  })
}

export function useLogin() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (token: string) => apiSend<AuthMe>('POST', '/api/v1/auth/login', { token }),
    onSuccess: (me) => {
      qc.setQueryData(['auth', 'me'], me)
      void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'auth' })
    },
  })
}

export function useLogout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => apiSend<{ status: string }>('POST', '/api/v1/auth/logout'),
    onSuccess: () => {
      qc.clear()
      void qc.invalidateQueries({ queryKey: ['auth'] })
    },
  })
}

/** Whether the current user may change NetworkPolicies in namespace (RBAC). */
export function usePermissions(namespace: string) {
  return useQuery({
    queryKey: ['auth', 'permissions', namespace],
    queryFn: () => apiGet<Permissions>(`/api/v1/auth/permissions?namespace=${encodeURIComponent(namespace)}`),
    enabled: namespace !== '',
    staleTime: 60_000,
  })
}

// ---- insights ----

export function usePosture() {
  return useQuery({
    // Derived from pods + policies + namespaces; invalidated on all three.
    queryKey: ['posture'],
    queryFn: () => apiGet<PostureReport>('/api/v1/posture'),
  })
}

export function useNamespaceIsolation(namespace: string) {
  return useQuery({
    queryKey: ['isolation', namespace],
    queryFn: () => apiGet<PodIsolation[]>(`/api/v1/namespaces/${namespace}/isolation`),
    enabled: namespace !== '',
  })
}

export type ImpactRequest =
  | { operation: 'apply'; namespace: string; policy?: K8sNetworkPolicy; yaml?: string }
  | { operation: 'delete'; namespace: string; name: string }

export function useImpact() {
  return useMutation({
    mutationFn: (req: ImpactRequest) => apiSend<ImpactResult>('POST', '/api/v1/impact', req),
  })
}

export interface AuditFilter {
  namespace?: string
  action?: string
  q?: string
}

export function useAudit(filter: AuditFilter) {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(filter)) if (v) params.set(k, v)
  return useQuery({
    // Refreshed whenever a policy changes.
    queryKey: ['networkpolicies', 'audit', params.toString()],
    queryFn: () => apiGet<AuditEntry[]>(`/api/v1/audit?${params}`),
  })
}

export function useImportPolicies() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ yaml, namespace, dryRun }: { yaml: string; namespace?: string; dryRun: boolean }) => {
      const params = new URLSearchParams()
      if (namespace) params.set('namespace', namespace)
      if (dryRun) params.set('dryRun', 'true')
      return apiSendYaml<ImportResponse>('POST', `/api/v1/networkpolicies/import?${params}`, yaml)
    },
    onSuccess: (_, { dryRun }) => {
      if (!dryRun) void qc.invalidateQueries({ queryKey: ['networkpolicies'] })
    },
  })
}

export function exportUrl(namespace?: string) {
  return namespace
    ? `/api/v1/networkpolicies/export?namespace=${encodeURIComponent(namespace)}`
    : '/api/v1/networkpolicies/export'
}

/** Namespace-level graph over every non-system namespace. */
export function useNamespaceTopology(enabled: boolean) {
  return useQuery({
    // Same first segment as the workload graph so SSE invalidation covers both.
    queryKey: ['topology', 'namespace-level'],
    queryFn: () => apiGet<NamespaceTopology>('/api/v1/topology?level=namespace'),
    enabled,
    retry: false,
  })
}

// ---- firewall console ----

export function useAccess(namespace: string, workload: string) {
  const params = new URLSearchParams({ namespace })
  if (workload) params.set('workload', workload)
  return useQuery({
    // Invalidated with pods/networkpolicies (see useSSEInvalidation).
    queryKey: ['access', namespace, workload],
    queryFn: () => apiGet<AccessReport>(`/api/v1/access?${params}`),
    enabled: namespace !== '',
  })
}

export function usePlanAccess() {
  return useMutation({
    mutationFn: (req: PlanRequest) => apiSend<AccessPlan>('POST', '/api/v1/access/plan', req),
  })
}

export function useApplyAccess() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (req: PlanRequest & { signature: string }) =>
      apiSend<ApplyResponse>('POST', '/api/v1/access/apply', req),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['access'] })
      void qc.invalidateQueries({ queryKey: ['networkpolicies'] })
      void qc.invalidateQueries({ queryKey: ['posture'] })
      void qc.invalidateQueries({ queryKey: ['topology'] })
    },
  })
}
