export const metadata = {
  name: 'kawalec',
  title: 'Kawalec Command Center',
  version: '0.1.0',
  description:
    'Project overlay for Kawalec Command Center: pipeline customization, RBAC roles, and seed CLI used after `yarn initialize` on fresh deployments.',
  author: 'Kawalec Agency',
  license: 'Proprietary',
  requires: ['customers', 'auth'],
}

export { features } from './acl'
