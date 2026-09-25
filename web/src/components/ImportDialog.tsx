import { useState } from 'react'
import type { ChangeEvent } from 'react'
import { errorMessage } from '../api/client'
import { useImportPolicies } from '../api/queries'
import type { ImportResponse } from '../api/types'
import { Badge, Button, Feedback, Modal } from './ui'

const ACTION_TONE = { created: 'ok', updated: 'info', unchanged: 'neutral', error: 'block' } as const

/**
 * Bulk import of multi-document YAML (e.g. a GitOps repo or an export from
 * another cluster). Always validated with a server-side dry-run first; the
 * apply button unlocks only after a clean validation of the same text.
 */
export default function ImportDialog({ namespaces, onClose }: { namespaces: string[]; onClose: () => void }) {
  const [yaml, setYaml] = useState('')
  const [namespace, setNamespace] = useState('')
  const [validated, setValidated] = useState<string | null>(null)
  const [result, setResult] = useState<ImportResponse | null>(null)
  const importer = useImportPolicies()

  const run = (dryRun: boolean) =>
    importer.mutate(
      { yaml, namespace: namespace || undefined, dryRun },
      {
        onSuccess: (res) => {
          setResult(res)
          const clean = !res.results.some((r) => r.action === 'error')
          setValidated(dryRun && clean ? yaml + '\u0000' + namespace : null)
        },
        onError: () => setResult(null),
      },
    )

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setYaml(await file.text())
      setValidated(null)
      setResult(null)
    }
  }

  const canApply = validated === yaml + '\u0000' + namespace

  return (
    <Modal title="Import NetworkPolicies" onClose={onClose} wide>
      <p className="text-sm text-muted">
        Paste or upload YAML with one or more NetworkPolicy documents (separated by <code>---</code>, or a
        List). Existing policies with the same name are updated; identical ones are left untouched.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input type="file" accept=".yaml,.yml,.json" onChange={onFile} className="text-xs text-muted" />
        <label className="ml-auto flex items-center gap-1 text-xs text-muted">
          default namespace
          <select
            value={namespace}
            onChange={(e) => setNamespace(e.target.value)}
            className="rounded border border-edge bg-surface px-2 py-1 font-mono text-xs text-text"
          >
            <option value="">(from documents)</option>
            {namespaces.map((ns) => (
              <option key={ns}>{ns}</option>
            ))}
          </select>
        </label>
      </div>
      <textarea
        value={yaml}
        onChange={(e) => {
          setYaml(e.target.value)
          setResult(null)
        }}
        rows={12}
        spellCheck={false}
        placeholder={'apiVersion: networking.k8s.io/v1\nkind: NetworkPolicy\nmetadata:\n  name: default-deny-ingress\n  namespace: team-a\nspec:\n  podSelector: {}\n  policyTypes: [Ingress]'}
        className="mt-2 w-full rounded border border-edge bg-base p-2 font-mono text-xs text-text placeholder:text-quiet focus:border-accent focus:outline-none"
      />

      {importer.isError && <Feedback tone="error">{errorMessage(importer.error)}</Feedback>}
      {result && (
        <div className="mt-3">
          <p className="text-sm text-text">
            {result.dryRun ? 'Dry-run: ' : 'Applied: '}
            {Object.entries(result.summary)
              .map(([k, v]) => `${v} ${k}`)
              .join(', ')}
          </p>
          <ul className="mt-2 max-h-48 space-y-1 overflow-auto">
            {result.results.map((r) => (
              <li key={`${r.namespace}/${r.name}`} className="flex items-start gap-2 text-xs">
                <Badge tone={ACTION_TONE[r.action]}>{r.action}</Badge>
                <span className="font-mono text-text">
                  {r.namespace}/{r.name}
                </span>
                {r.error && <span className="text-block">{r.error}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          {result && !result.dryRun ? 'Close' : 'Cancel'}
        </Button>
        <Button onClick={() => run(true)} disabled={yaml.trim() === '' || importer.isPending}>
          Validate (dry-run)
        </Button>
        <Button
          variant="primary"
          onClick={() => run(false)}
          disabled={!canApply || importer.isPending}
          title={canApply ? undefined : 'Validate first'}
        >
          Import
        </Button>
      </div>
    </Modal>
  )
}
