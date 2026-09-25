export type Tone = 'ok' | 'warn' | 'block' | 'neutral' | 'info'

export function severityTone(severity: string): Tone {
  return severity === 'critical' ? 'block' : severity === 'warning' ? 'warn' : 'info'
}
