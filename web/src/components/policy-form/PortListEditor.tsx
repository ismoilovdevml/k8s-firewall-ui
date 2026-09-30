import type { PortDraft } from '../../policy/model'
import { IconPlus, IconX } from '../icons'
import { Button, IconButton, Input, Select } from '../ui'

interface Props {
  value: PortDraft[]
  onChange: (value: PortDraft[]) => void
}

export default function PortListEditor({ value, onChange }: Props) {
  const setPort = (i: number, port: PortDraft) => onChange(value.map((p, j) => (j === i ? port : p)))

  return (
    <div className="space-y-2">
      {value.map((port, i) => (
        <div key={i} className="flex flex-wrap items-center gap-1.5">
          <Select
            mono
            aria-label="Protocol"
            value={port.protocol}
            onChange={(e) => setPort(i, { ...port, protocol: e.target.value as PortDraft['protocol'] })}
            className="h-8"
          >
            <option>TCP</option>
            <option>UDP</option>
            <option>SCTP</option>
          </Select>
          <Input
            mono
            value={port.port}
            onChange={(e) => setPort(i, { ...port, port: e.target.value })}
            placeholder="port or name"
            aria-label="Port"
            className="h-8 w-32"
          />
          <span className="text-xs text-quiet">to</span>
          <Input
            mono
            value={port.endPort ?? ''}
            onChange={(e) => setPort(i, { ...port, endPort: e.target.value || undefined })}
            placeholder="end (opt)"
            aria-label="End port"
            disabled={!/^\d+$/.test(port.port)}
            className="h-8 w-24"
          />
          <IconButton
            label="Remove port"
            onClick={() => onChange(value.filter((_, j) => j !== i))}
            className="hover:bg-block-soft hover:text-block"
          >
            <IconX size={15} />
          </IconButton>
        </div>
      ))}
      {value.length === 0 && (
        <p className="text-xs text-quiet">
          No ports — allows <span className="font-medium text-accent-strong">all ports</span>.
        </p>
      )}
      <Button
        size="sm"
        onClick={() => onChange([...value, { protocol: 'TCP', port: '' }])}
        icon={<IconPlus size={14} />}
      >
        Add port
      </Button>
    </div>
  )
}
