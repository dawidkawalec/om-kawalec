export const metadata = {
  name: 'projects',
  title: 'Projekty',
  version: '0.1.0',
  description:
    'Project + task management. Auto-created from CustomerDeal when the deal enters an execution stage (potwierdzono+), with a Kanban task board.',
  author: 'Kawalec Agency',
  license: 'Proprietary',
  requires: ['customers', 'auth'],
}

export { features } from './acl'
