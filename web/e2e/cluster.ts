import { execFileSync } from 'node:child_process'

// Real-traffic probes for UI tests: exec wget in a source pod.
const kubectl = process.env.KUBECTL ?? 'kubectl'

function run(args: string[]): string {
  return execFileSync(kubectl, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

export function podIP(namespace: string, app: string): string {
  return run(['-n', namespace, 'get', 'pod', '-l', `app=${app}`, '-o', 'jsonpath={.items[0].status.podIP}'])
}

/** True when deploy/<from> can open http://<to-pod>:<port>/. */
export function canConnect(fromNs: string, from: string, toNs: string, to: string, port: number): boolean {
  const ip = podIP(toNs, to)
  try {
    run(['-n', fromNs, 'exec', `deploy/${from}`, '--', 'wget', '-qO-', '-T', '3', `http://${ip}:${port}/`])
    return true
  } catch {
    return false
  }
}

export function deleteManaged(namespace: string, name: string) {
  try {
    run(['-n', namespace, 'delete', 'networkpolicy', name, '--ignore-not-found'])
  } catch {
    // best effort cleanup
  }
}

/** Enforcement is asynchronous in the CNI: poll briefly. */
export async function eventually(fn: () => boolean, want: boolean, timeoutMs = 15_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const got = fn()
    if (got === want || Date.now() > deadline) return got
    await new Promise((r) => setTimeout(r, 1000))
  }
}
