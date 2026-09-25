export class ApiError extends Error {
  code: string
  status: number

  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

/** Fired on window whenever the API answers 401; the auth gate listens. */
export const UNAUTHORIZED_EVENT = 'fwui:unauthorized'

// Every state-changing request carries this header; the server rejects
// writes without it (CSRF protection — cross-site requests cannot set it).
const CSRF_HEADERS = { 'X-Requested-With': 'k8s-firewall-ui' }

export async function apiGet<T>(path: string): Promise<T> {
  return handle(await fetch(path, { credentials: 'same-origin' }))
}

export async function apiSend<T>(
  method: 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers:
      body !== undefined ? { ...CSRF_HEADERS, 'Content-Type': 'application/json' } : CSRF_HEADERS,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  return handle(res)
}

/** Sends a raw YAML document; the backend parses and validates it. */
export async function apiSendYaml<T>(method: 'POST' | 'PUT', path: string, yaml: string): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: { ...CSRF_HEADERS, 'Content-Type': 'application/yaml' },
    body: yaml,
  })
  return handle(res)
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let code = 'UNKNOWN'
    let message = res.statusText
    try {
      const body = await res.json()
      if (body?.error) {
        code = body.error.code
        message = body.error.message
      }
    } catch {
      // non-JSON error body
    }
    if (res.status === 401) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
    throw new ApiError(res.status, code, message)
  }
  return res.json()
}

/** Human-readable message for any thrown value. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 403 && err.code === 'Forbidden') {
      return `Kubernetes RBAC denied this action for your account: ${err.message}`
    }
    return err.message
  }
  return err instanceof Error ? err.message : String(err)
}
