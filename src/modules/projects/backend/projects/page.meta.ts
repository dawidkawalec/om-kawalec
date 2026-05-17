import React from 'react'

const folderIcon = React.createElement(
  'svg',
  {
    width: 16,
    height: 16,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  },
  React.createElement('path', {
    d: 'M20 7h-8l-2-2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2Z',
  }),
  React.createElement('path', { d: 'M7 13h10' }),
  React.createElement('path', { d: 'M7 17h6' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['projects.view'],
  pageTitle: 'Projekty',
  pageTitleKey: 'projects.nav.list',
  pageGroup: 'Projekty',
  pageGroupKey: 'projects.nav.group',
  pagePriority: 25,
  pageOrder: 10,
  icon: folderIcon,
  breadcrumb: [{ label: 'Projekty', labelKey: 'projects.nav.list' }],
}
