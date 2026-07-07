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
  const res = await fetch(path)
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
