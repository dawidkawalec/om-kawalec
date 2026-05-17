export const metadata = {
  requireAuth: true,
  requireFeatures: ['projects.view'],
  pageTitle: 'Projekt',
  pageTitleKey: 'projects.nav.detail',
  pageGroup: 'Projekty',
  pageGroupKey: 'projects.nav.group',
  pagePriority: 25,
  pageOrder: 12,
  navHidden: true,
  breadcrumb: [
    { label: 'Projekty', labelKey: 'projects.nav.list', href: '/backend/projects' },
    { label: 'Szczegóły' },
  ],
}
