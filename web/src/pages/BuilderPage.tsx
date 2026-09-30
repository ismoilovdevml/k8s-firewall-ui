import { useEffect, useMemo, useState } from 'react'
import { ReactFlow, Background, MarkerType } from '@xyflow/react'
import type { Edge, Node } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { stringify } from 'yaml'
import { useNavigate } from 'react-router-dom'
import { useBuilderStore } from '../builder/store'
import { builderToDraft, draftToBuilder } from '../builder/convert'
import { draftToPolicy, policyToDraft } from '../policy/model'
import { useCreatePolicy, useNamespaces, usePolicies, usePolicyDetail } from '../api/queries'
import { ApiError } from '../api/client'
import YamlEditor from '../components/YamlEditor'
import ImpactPanel from '../components/ImpactPanel'
import LabelMapEditor from '../components/policy-form/LabelMapEditor'
import PeerEditor from '../components/policy-form/PeerEditor'
import PortListEditor from '../components/policy-form/PortListEditor'
import { PeerNode, TargetNode } from '../components/builder/nodes'
import { Button, Checkbox, Feedback, Field, Input, Select } from '../components/ui'
import { IconArrowLeft, IconPlus, IconTrash } from '../components/icons'
import { useTheme } from '../theme'

const nodeTypes = { target: TargetNode, peer: PeerNode }

export default function BuilderPage() {
  const store = useBuilderStore()
  const navigate = useNavigate()
  const { data: namespaces } = useNamespaces()
  const create = useCreatePolicy()
  const theme = useTheme()
  const [feedback, setFeedback] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  const userNamespaces = (namespaces ?? []).map((ns) => ns.name).filter((n) => !n.startsWith('kube-'))

  useEffect(() => {
    if (store.namespace === '' && userNamespaces.length > 0) {
      store.set({ namespace: userNamespaces[0] })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.namespace, userNamespaces.join(',')])

  const draft = useMemo(
    () =>
      builderToDraft({
        name: store.name,
        namespace: store.namespace,
        podSelector: store.podSelector,
        ingressEnabled: store.ingressEnabled,
        egressEnabled: store.egressEnabled,
        peers: store.peers,
      }),
    [store.name, store.namespace, store.podSelector, store.ingressEnabled, store.egressEnabled, store.peers],
  )

  const policy = useMemo(() => draftToPolicy(draft), [draft])
  const yamlPreview = useMemo(() => stringify(policy), [policy])

  const { nodes, edges } = useMemo(() => {
    const ingress = store.peers.filter((p) => p.direction === 'ingress')
    const egress = store.peers.filter((p) => p.direction === 'egress')
    const rows = Math.max(ingress.length, egress.length, 1)
    const centerY = ((rows - 1) * 130) / 2

    const ns: Node[] = [
      {
        id: '__target__',
        type: 'target',
        position: { x: 320, y: centerY },
        draggable: false,
        data: { name: store.name, podSelector: store.podSelector },
      },
      ...ingress.map((card, i) => ({
        id: card.id,
        type: 'peer',
        position: { x: 0, y: i * 130 },
        data: { card },
        selected: store.selectedId === card.id,
      })),
      ...egress.map((card, i) => ({
        id: card.id,
        type: 'peer',
        position: { x: 640, y: i * 130 },
        data: { card },
        selected: store.selectedId === card.id,
      })),
    ]
    const es: Edge[] = [
      ...ingress.map((card) => ({
        id: `e-${card.id}`,
        source: card.id,
        target: '__target__',
        style: { stroke: 'var(--color-info)', strokeWidth: 2 },
        markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--color-info)' },
      })),
      ...egress.map((card) => ({
        id: `e-${card.id}`,
        source: '__target__',
        target: card.id,
        style: { stroke: 'var(--color-accent)', strokeWidth: 2 },
        markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--color-accent)' },
      })),
    ]
    return { nodes: ns, edges: es }
  }, [store.peers, store.selectedId, store.name, store.podSelector])

  const selected = store.peers.find((p) => p.id === store.selectedId) ?? null

  const submit = (dryRun: boolean) => {
    create.mutate(
      { namespace: draft.namespace, payload: { json: draftToPolicy(draft) }, dryRun },
      {
        onSuccess: () => {
          if (dryRun) setFeedback({ tone: 'ok', text: 'Valid — the API server accepts this policy.' })
          else navigate(`/policies/${draft.namespace}/${draft.name}`)
        },
        onError: (err) => setFeedback({ tone: 'error', text: err instanceof ApiError ? err.message : String(err) }),
      },
    )
  }

  const ready = store.name.trim() !== '' && store.namespace !== ''

  return (
    <div className="flex h-full min-h-0 flex-col lg:flex-row">
      {/* left: canvas and top controls */}
      <div className="flex min-h-[420px] min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-end gap-3 border-b border-edge bg-surface px-4 py-3">
          <Field label="Policy name">
            <Input
              mono
              value={store.name}
              onChange={(e) => store.set({ name: e.target.value })}
              placeholder="allow-web-to-db"
              className="w-52"
            />
          </Field>
          <Field label="Namespace">
            <Select mono value={store.namespace} onChange={(e) => store.set({ namespace: e.target.value })}>
              {userNamespaces.map((ns) => (
                <option key={ns}>{ns}</option>
              ))}
            </Select>
          </Field>
          <LoadExisting />
          <div className="ml-auto flex flex-wrap gap-2">
            <Button onClick={() => store.addPeer('ingress')} icon={<IconPlus size={15} className="text-info" />}>
              Allow from…
            </Button>
            <Button
              onClick={() => store.addPeer('egress')}
              icon={<IconPlus size={15} className="text-accent-strong" />}
            >
              Allow to…
            </Button>
            <span className="mx-1 hidden w-px bg-edge sm:block" />
            <Button onClick={() => submit(true)} disabled={!ready || create.isPending}>
              Validate
            </Button>
            <Button variant="primary" onClick={() => submit(false)} disabled={!ready || create.isPending}>
              Create
            </Button>
          </div>
        </div>

        {feedback && (
          <div className="px-4">
            <Feedback tone={feedback.tone}>{feedback.text}</Feedback>
          </div>
        )}

        <div className="relative min-h-0 flex-1">
          <ReactFlow
            key={store.peers.length /* refit when cards are added/removed */}
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodeClick={(_, node) => node.id !== '__target__' && store.select(node.id)}
            onPaneClick={() => store.select(null)}
            fitView
            fitViewOptions={{ maxZoom: 1.1 }}
            proOptions={{ hideAttribution: true }}
            colorMode={theme}
            nodesDraggable={false}
            nodesConnectable={false}
          >
            <Background color="var(--color-edge-strong)" gap={24} />
          </ReactFlow>
          {store.peers.length === 0 && (
            <div className="pointer-events-none absolute inset-x-0 bottom-6 flex justify-center px-4">
              <div className="max-w-md rounded-xl border border-edge bg-surface/95 px-4 py-3 text-center text-sm text-muted shadow-card">
                <span className="font-medium text-text">Start drawing:</span> use <strong>Allow from…</strong> for
                incoming traffic and <strong>Allow to…</strong> for outgoing. Click any card to edit it.
              </div>
            </div>
          )}
          <div className="pointer-events-none absolute left-4 top-4 flex gap-3 rounded-lg border border-edge bg-surface/90 px-3 py-1.5 text-xs text-muted shadow-sm">
            <span className="flex items-center gap-1.5">
              <span className="h-0.5 w-4 rounded bg-info" /> ingress
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-0.5 w-4 rounded bg-accent" /> egress
            </span>
          </div>
        </div>
      </div>

      {/* right: inspector + YAML preview */}
      <aside className="flex w-full shrink-0 flex-col border-t border-edge bg-surface lg:w-[400px] lg:border-l lg:border-t-0">
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {selected ? (
            <div>
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => store.select(null)}
                  className="inline-flex items-center gap-1 text-xs text-muted hover:text-accent-strong"
                >
                  <IconArrowLeft size={13} /> Policy target
                </button>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => store.removePeer(selected.id)}
                  icon={<IconTrash size={13} />}
                  className="hover:bg-block-soft hover:text-block"
                >
                  Remove
                </Button>
              </div>
              <h2 className="mt-2 text-sm font-semibold text-text">
                {selected.direction === 'ingress' ? 'Allow traffic from' : 'Allow traffic to'}
              </h2>
              <div className="mt-2">
                <PeerEditor
                  value={selected.peer}
                  onChange={(peer) => store.updatePeer(selected.id, { peer })}
                  onRemove={() => store.removePeer(selected.id)}
                />
              </div>
              <div className="mt-4">
                <div className="mb-2 text-xs font-medium text-muted">Ports</div>
                <PortListEditor value={selected.ports} onChange={(ports) => store.updatePeer(selected.id, { ports })} />
              </div>
            </div>
          ) : (
            <div>
              <h2 className="text-sm font-semibold text-text">Policy target</h2>
              <p className="mt-0.5 text-xs text-muted">
                Which pods this policy applies to. Click a card on the canvas to edit it.
              </p>
              <div className="mt-3">
                <LabelMapEditor
                  value={store.podSelector}
                  onChange={(podSelector) => store.set({ podSelector })}
                  emptyHint="no labels — applies to EVERY pod in the namespace"
                />
              </div>
              <div className="mt-4 space-y-2 rounded-lg border border-edge p-3">
                {(['ingress', 'egress'] as const).map((dir) => (
                  <Checkbox
                    key={dir}
                    checked={dir === 'ingress' ? store.ingressEnabled : store.egressEnabled}
                    onChange={(e) =>
                      store.set(
                        dir === 'ingress' ? { ingressEnabled: e.target.checked } : { egressEnabled: e.target.checked },
                      )
                    }
                    label={`Isolate ${dir}`}
                    hint={dir === 'ingress' ? 'deny incoming unless allowed' : 'deny outgoing unless allowed'}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="border-t border-edge p-3">
          <ImpactPanel
            request={draft.name && draft.namespace ? { operation: 'apply', namespace: draft.namespace, policy } : null}
          />
        </div>
        <details className="border-t border-edge p-3" open>
          <summary className="cursor-pointer text-xs font-medium text-muted hover:text-text">Live YAML</summary>
          <div className="mt-2 max-h-72 overflow-y-auto">
            <YamlEditor value={yamlPreview} readOnly />
          </div>
        </details>
      </aside>
    </div>
  )
}

/** Dropdown that loads an existing policy onto the canvas. */
function LoadExisting() {
  const { data: policies } = usePolicies()
  const [pick, setPick] = useState('')
  const [ns, name] = pick ? pick.split('/', 2) : ['', '']
  const detail = usePolicyDetail(ns, name)
  const store = useBuilderStore()
  const [notice, setNotice] = useState('')

  useEffect(() => {
    if (!detail.data || !pick) return
    const { draft, lossy: l1 } = policyToDraft(detail.data.policy)
    const { state, lossy: l2 } = draftToBuilder(draft)
    const lossy = [...l1, ...l2]
    store.load(state)
    setPick('')
    setNotice(lossy.length > 0 ? `Loaded with omissions: ${lossy.join('; ')}` : '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.data, pick])

  return (
    <Field label="Load existing" hint={notice ? <span className="text-warn-text">{notice}</span> : undefined}>
      <Select mono value={pick} onChange={(e) => setPick(e.target.value)} className="max-w-60">
        <option value="">choose policy…</option>
        {(policies ?? []).map((p) => (
          <option key={`${p.namespace}/${p.name}`} value={`${p.namespace}/${p.name}`}>
            {p.namespace}/{p.name}
          </option>
        ))}
      </Select>
    </Field>
  )
}
