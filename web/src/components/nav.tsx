import type { ReactNode } from 'react'
import { IconFileText, IconFlame, IconFlask, IconGauge, IconHistory, IconNetwork, IconPencilRuler } from './icons'

export interface NavItem {
  to: string
  label: string
  hint: string
  icon: ReactNode
}

// Grouped by what the user is trying to do: understand the cluster, change
// what is allowed, or check who changed what.
export const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: 'Observe',
    items: [
      { to: '/', label: 'Overview', hint: 'Security posture', icon: <IconGauge size={18} /> },
      { to: '/topology', label: 'Topology', hint: 'Live traffic map', icon: <IconNetwork size={18} /> },
    ],
  },
  {
    title: 'Control',
    items: [
      { to: '/firewall', label: 'Firewall', hint: 'Allow & block traffic', icon: <IconFlame size={18} /> },
      { to: '/policies', label: 'Policies', hint: 'Rules on the cluster', icon: <IconFileText size={18} /> },
      { to: '/builder', label: 'Builder', hint: 'Draw a policy', icon: <IconPencilRuler size={18} /> },
      { to: '/simulator', label: 'Simulator', hint: 'Test a connection', icon: <IconFlask size={18} /> },
    ],
  },
  {
    title: 'Govern',
    items: [{ to: '/audit', label: 'Audit log', hint: 'Who changed what', icon: <IconHistory size={18} /> }],
  },
]

export const NAV: NavItem[] = NAV_GROUPS.flatMap((g) => g.items)

/** The nav item a path belongs to (longest matching prefix). */
export function navFor(pathname: string): NavItem | undefined {
  return [...NAV]
    .sort((a, b) => b.to.length - a.to.length)
    .find((n) => (n.to === '/' ? pathname === '/' : pathname === n.to || pathname.startsWith(n.to + '/')))
}
