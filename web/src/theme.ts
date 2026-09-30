import { useSyncExternalStore } from 'react'

// Color theme: the user's preference (persisted) and the resolved light/dark
// value. public/theme-init.js applies it before first paint; this module keeps
// it in sync afterwards. No state library: a tiny external store.

export type ThemePref = 'light' | 'dark' | 'system'
export type Theme = 'light' | 'dark'

const KEY = 'fwui-theme'
const listeners = new Set<() => void>()
const media = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

let pref: ThemePref = readPref()

function resolve(p: ThemePref): Theme {
  return p === 'system' ? (media?.matches ? 'dark' : 'light') : p
}

function apply() {
  document.documentElement.dataset.theme = resolve(pref)
  listeners.forEach((l) => l())
}

media?.addEventListener('change', () => pref === 'system' && apply())

export function setThemePref(next: ThemePref) {
  pref = next
  try {
    if (next === 'system') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, next)
  } catch {
    /* storage blocked: keep it for this session only */
  }
  apply()
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useThemePref(): ThemePref {
  return useSyncExternalStore(subscribe, () => pref)
}

/** The theme actually shown, for components that need a JS value (React Flow). */
export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, () => resolve(pref))
}
