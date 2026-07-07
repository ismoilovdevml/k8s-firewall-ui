export class ApiError extends Error {
  code: string
  status: number

  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

export async function apiGet<T>(path: string): Promise<T> {
  return handle(await fetch(path))
}

export async function apiSend<T>(
  method: 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  return handle(res)
}

/** Sends a raw YAML document; the backend parses and validates it. */
export async function apiSendYaml<T>(method: 'POST' | 'PUT', path: string, yaml: string): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/yaml' },
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
    throw new ApiError(res.status, code, message)
  }
  return res.json()
}
