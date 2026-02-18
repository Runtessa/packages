import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docs: [
    'intro',
    {
      type: 'category',
      label: 'Architecture',
      items: ['architecture/overview', 'architecture/dependency-graph'],
    },
    {
      type: 'category',
      label: 'Services',
      items: ['services/core', 'services/ide', 'services/auth', 'services/infrastructure'],
    },
    {
      type: 'category',
      label: 'Reference',
      items: ['reference/services', 'reference/routes', 'reference/openapi-spec'],
    },
  ],
};

export default sidebars;
