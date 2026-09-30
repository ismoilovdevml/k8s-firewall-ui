import { useState } from 'react'
import type { ChangeEvent } from 'react'
import { errorMessage } from '../api/client'
import { useImportPolicies } from '../api/queries'
import type { ImportResponse } from '../api/types'
import { IconUpload } from './icons'
import { Badge, Button, Feedback, Field, Modal, Select, Textarea } from './ui'

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
    <Modal
      title="Import NetworkPolicies"
      description="Paste or upload YAML with one or more NetworkPolicy documents. Existing policies with the same name are updated; identical ones are left untouched."
      onClose={onClose}
      wide
      footer={
        <>
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
        </>
      }
    >
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-dashed border-edge-strong bg-raised/50 px-3 text-sm text-muted hover:border-accent hover:text-accent-strong">
          <IconUpload size={15} /> Upload file
          <input type="file" accept=".yaml,.yml,.json" onChange={onFile} className="sr-only" />
        </label>
        <Field label="Default namespace" className="ml-auto">
          <Select mono value={namespace} onChange={(e) => setNamespace(e.target.value)} className="h-8">
            <option value="">(from documents)</option>
            {namespaces.map((ns) => (
              <option key={ns}>{ns}</option>
            ))}
          </Select>
        </Field>
      </div>
      <Textarea
        value={yaml}
        onChange={(e) => {
          setYaml(e.target.value)
          setResult(null)
        }}
        rows={12}
        spellCheck={false}
        aria-label="YAML to import"
        placeholder={
          'apiVersion: networking.k8s.io/v1\nkind: NetworkPolicy\nmetadata:\n  name: default-deny-ingress\n  namespace: team-a\nspec:\n  podSelector: {}\n  policyTypes: [Ingress]'
        }
        className="mt-3 w-full"
      />
      <p className="mt-1.5 text-xs text-quiet">
        Separate documents with <code className="font-mono">---</code>, or paste a List. Import unlocks after a clean
        validation.
      </p>

      {importer.isError && <Feedback tone="error">{errorMessage(importer.error)}</Feedback>}
      {result && (
        <div className="mt-3 rounded-lg border border-edge bg-raised/40 p-3">
          <p className="text-sm font-medium text-text">
            {result.dryRun ? 'Dry-run: ' : 'Applied: '}
            {Object.entries(result.summary)
              .map(([k, v]) => `${v} ${k}`)
              .join(', ')}
          </p>
          <ul className="mt-2 max-h-48 space-y-1.5 overflow-auto">
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
    </Modal>
  )
}
