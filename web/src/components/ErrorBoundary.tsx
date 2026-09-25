import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

interface State {
  error: Error | null
}

/** Keeps a crashing page from blanking the whole app. */
export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('page crashed', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="p-6">
        <div className="max-w-xl rounded-xl border border-block/40 bg-block/5 p-5">
          <h1 className="font-bold text-block">Something went wrong on this page</h1>
          <p className="mt-2 font-mono text-xs text-text">{this.state.error.message}</p>
          <button
            onClick={() => this.setState({ error: null })}
            className="mt-4 rounded border border-edge bg-surface px-3 py-1.5 text-sm text-muted hover:text-text"
          >
            Try again
          </button>
        </div>
      </div>
    )
  }
}
