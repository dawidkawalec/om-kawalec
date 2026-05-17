export const metadata = {
  requireAuth: true,
  requireFeatures: ['projects.manage'],
  pageTitle: 'Nowy projekt',
  pageTitleKey: 'projects.nav.create',
  pageGroup: 'Projekty',
  pageGroupKey: 'projects.nav.group',
  pagePriority: 25,
  pageOrder: 11,
  navHidden: true,
  breadcrumb: [
    { label: 'Projekty', labelKey: 'projects.nav.list', href: '/backend/projects' },
    { label: 'Nowy projekt' },
  ],
}
