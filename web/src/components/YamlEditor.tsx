import CodeMirror from '@uiw/react-codemirror'
import { yaml } from '@codemirror/lang-yaml'
import { EditorView } from '@codemirror/view'

const theme = EditorView.theme(
  {
    '&': {
      backgroundColor: 'var(--color-surface)',
      color: 'var(--color-text)',
      fontSize: '13px',
    },
    '.cm-gutters': {
      backgroundColor: 'var(--color-surface)',
      color: 'var(--color-quiet)',
      border: 'none',
    },
    '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,0.03)' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent' },
    '&.cm-focused': { outline: 'none' },
  },
  { dark: true },
)

interface Props {
  value: string
  onChange?: (value: string) => void
  readOnly?: boolean
}

export default function YamlEditor({ value, onChange, readOnly = false }: Props) {
  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      readOnly={readOnly}
      theme={theme}
      extensions={[yaml()]}
      basicSetup={{ foldGutter: false, highlightActiveLine: !readOnly }}
      className="overflow-hidden rounded-md border border-edge"
    />
  )
}
