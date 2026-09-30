import CodeMirror from '@uiw/react-codemirror'
import { yaml } from '@codemirror/lang-yaml'
import { Prec } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { useTheme } from '../theme'

// Surface colors come from the theme tokens; the base light/dark theme only
// supplies syntax colors, so the editor matches the page in both modes.
const surface = Prec.highest(
  EditorView.theme({
    '&': {
      backgroundColor: 'var(--color-surface)',
      color: 'var(--color-text)',
      fontSize: '13px',
    },
    '.cm-gutters': {
      backgroundColor: 'var(--color-raised)',
      color: 'var(--color-quiet)',
      border: 'none',
    },
    '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--color-accent) 6%, transparent)' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent' },
    '&.cm-focused': { outline: 'none' },
  }),
)

interface Props {
  value: string
  onChange?: (value: string) => void
  readOnly?: boolean
}

export default function YamlEditor({ value, onChange, readOnly = false }: Props) {
  const theme = useTheme()
  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      readOnly={readOnly}
      theme={theme}
      extensions={[yaml(), surface]}
      basicSetup={{ foldGutter: false, highlightActiveLine: !readOnly }}
      className="overflow-hidden rounded-lg border border-edge"
    />
  )
}
