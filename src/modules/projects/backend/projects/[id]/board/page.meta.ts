export const metadata = {
  requireAuth: true,
  requireFeatures: ['projects.tasks.view'],
  pageTitle: 'Tablica zadań',
  pageTitleKey: 'projects.nav.board',
  pageGroup: 'Projekty',
  pageGroupKey: 'projects.nav.group',
  pagePriority: 25,
  pageOrder: 13,
  navHidden: true,
  breadcrumb: [
    { label: 'Projekty', labelKey: 'projects.nav.list', href: '/backend/projects' },
    { label: 'Tablica' },
  ],
}
