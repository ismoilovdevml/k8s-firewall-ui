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
import LabelMapEditor from '../components/policy-form/LabelMapEditor'
import PeerEditor from '../components/policy-form/PeerEditor'
import PortListEditor from '../components/policy-form/PortListEditor'
import { PeerNode, TargetNode } from '../components/builder/nodes'

const nodeTypes = { target: TargetNode, peer: PeerNode }

export default function BuilderPage() {
  const store = useBuilderStore()
  const navigate = useNavigate()
  const { data: namespaces } = useNamespaces()
  const create = useCreatePolicy()
  const [feedback, setFeedback] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  const userNamespaces = (namespaces ?? [])
    .map((ns) => ns.name)
    .filter((n) => !n.startsWith('kube-'))

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

  const yamlPreview = useMemo(() => stringify(draftToPolicy(draft)), [draft])

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
        style: { stroke: 'var(--color-allow)' },
        markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--color-allow)' },
      })),
      ...egress.map((card) => ({
        id: `e-${card.id}`,
        source: '__target__',
        target: card.id,
        style: { stroke: 'var(--color-accent)' },
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
        onError: (err) =>
          setFeedback({ tone: 'error', text: err instanceof ApiError ? err.message : String(err) }),
      },
    )
  }

  const ready = store.name.trim() !== '' && store.namespace !== ''

  return (
    <div className="flex h-full min-h-0">
      {/* left: canvas and top controls */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-end gap-3 border-b border-edge px-4 py-3">
          <label className="block">
            <span className="mb-1 block font-mono text-[10px] uppercase tracking-wide text-quiet">name</span>
            <input
              value={store.name}
              onChange={(e) => store.set({ name: e.target.value })}
              placeholder="allow-web-to-db"
              className="w-48 rounded border border-edge bg-surface px-2 py-1.5 font-mono text-sm text-text placeholder:text-quiet focus:border-accent focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="mb-1 block font-mono text-[10px] uppercase tracking-wide text-quiet">namespace</span>
            <select
              value={store.namespace}
              onChange={(e) => store.set({ namespace: e.target.value })}
              className="rounded border border-edge bg-surface px-2 py-1.5 font-mono text-sm text-text focus:border-accent focus:outline-none"
            >
              {userNamespaces.map((ns) => (
                <option key={ns}>{ns}</option>
              ))}
            </select>
          </label>
          <LoadExisting />
          <div className="ml-auto flex gap-2">
            <button
              onClick={() => store.addPeer('ingress')}
              className="rounded border border-allow/50 px-3 py-1.5 text-sm text-allow hover:bg-allow/10"
            >
              + Allow from…
            </button>
            <button
              onClick={() => store.addPeer('egress')}
              className="rounded border border-accent/50 px-3 py-1.5 text-sm text-accent hover:bg-accent/10"
            >
              + Allow to…
            </button>
            <button
              onClick={() => submit(true)}
              disabled={!ready || create.isPending}
              className="rounded border border-edge px-3 py-1.5 text-sm text-muted hover:border-accent hover:text-accent disabled:opacity-50"
            >
              Validate
            </button>
            <button
              onClick={() => submit(false)}
              disabled={!ready || create.isPending}
              className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-base hover:brightness-110 disabled:opacity-50"
            >
              Create
            </button>
          </div>
        </div>

        {feedback && (
          <p className={`px-4 pt-2 font-mono text-xs ${feedback.tone === 'ok' ? 'text-allow' : 'text-block'}`}>
            {feedback.text}
          </p>
        )}

        <div className="min-h-0 flex-1">
          <ReactFlow
            key={store.peers.length /* refit when cards are added/removed */}
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodeClick={(_, node) => node.id !== '__target__' && store.select(node.id)}
            onPaneClick={() => store.select(null)}
            fitView
            proOptions={{ hideAttribution: true }}
            colorMode="dark"
            nodesDraggable={false}
            nodesConnectable={false}
          >
            <Background color="var(--color-edge)" gap={24} />
          </ReactFlow>
        </div>
      </div>

      {/* right: inspector + YAML preview */}
      <aside className="flex w-96 shrink-0 flex-col border-l border-edge bg-surface">
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {selected ? (
            <div>
              <div className="flex items-center justify-between">
                <h2 className="font-mono text-[11px] uppercase tracking-wide text-quiet">
                  {selected.direction === 'ingress' ? 'allow from' : 'allow to'}
                </h2>
                <button
                  onClick={() => store.removePeer(selected.id)}
                  className="text-xs text-quiet hover:text-block"
                >
                  Remove
                </button>
              </div>
              <div className="mt-2">
                <PeerEditor
                  value={selected.peer}
                  onChange={(peer) => store.updatePeer(selected.id, { peer })}
                  onRemove={() => store.removePeer(selected.id)}
                />
              </div>
              <div className="mt-3">
                <div className="mb-1 font-mono text-[10px] uppercase tracking-wide text-quiet">ports</div>
                <PortListEditor
                  value={selected.ports}
                  onChange={(ports) => store.updatePeer(selected.id, { ports })}
                />
              </div>
            </div>
          ) : (
            <div>
              <h2 className="font-mono text-[11px] uppercase tracking-wide text-quiet">policy target</h2>
              <p className="mt-1 text-xs text-muted">
                Which pods this policy applies to. Click a card on the canvas to edit it.
              </p>
              <div className="mt-2">
                <LabelMapEditor
                  value={store.podSelector}
                  onChange={(podSelector) => store.set({ podSelector })}
                  emptyHint="no labels — applies to EVERY pod in the namespace"
                />
              </div>
              <div className="mt-4 space-y-1.5">
                {(['ingress', 'egress'] as const).map((dir) => (
                  <label key={dir} className="flex items-center gap-2 text-sm text-text">
                    <input
                      type="checkbox"
                      checked={dir === 'ingress' ? store.ingressEnabled : store.egressEnabled}
                      onChange={(e) =>
                        store.set(
                          dir === 'ingress'
                            ? { ingressEnabled: e.target.checked }
                            : { egressEnabled: e.target.checked },
                        )
                      }
                      className="accent-(--color-accent)"
                    />
                    isolate {dir}
                    <span className="text-xs text-quiet">
                      {dir === 'ingress' ? '(deny incoming unless allowed)' : '(deny outgoing unless allowed)'}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="border-t border-edge p-3">
          <div className="mb-1.5 font-mono text-[10px] uppercase tracking-wide text-quiet">
            live yaml
          </div>
          <div className="max-h-72 overflow-y-auto">
            <YamlEditor value={yamlPreview} readOnly />
          </div>
        </div>
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
    <label className="block">
      <span className="mb-1 block font-mono text-[10px] uppercase tracking-wide text-quiet">
        load existing
      </span>
      <select
        value={pick}
        onChange={(e) => setPick(e.target.value)}
        className="max-w-56 rounded border border-edge bg-surface px-2 py-1.5 font-mono text-xs text-text focus:border-accent focus:outline-none"
      >
        <option value="">choose policy…</option>
        {(policies ?? []).map((p) => (
          <option key={`${p.namespace}/${p.name}`} value={`${p.namespace}/${p.name}`}>
            {p.namespace}/{p.name}
          </option>
        ))}
      </select>
      {notice && <span className="ml-2 font-mono text-[10px] text-accent">{notice}</span>}
    </label>
  )
}
