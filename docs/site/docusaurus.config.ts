import type { Config } from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'IdpCore Docs',
  tagline: 'Architecture, APIs, and operations for the IDP platform',
  favicon: 'img/favicon.svg',
  url: 'http://localhost',
  baseUrl: '/',
  organizationName: 'idp',
  projectName: 'idpcore-docs',
  onBrokenLinks: 'throw',
  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },
  markdown: {
    mermaid: true,
    hooks: {
      onBrokenMarkdownLinks: 'warn',
    },
  },
  themes: ['@docusaurus/theme-mermaid'],
  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          routeBasePath: '/',
          editUrl: undefined,
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],
  themeConfig: {
    image: 'img/social-card.svg',
    navbar: {
      title: 'IdpCore',
      items: [
        { to: '/', label: 'Docs', position: 'left' },
        { to: '/reference/routes', label: 'API', position: 'left' },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [
            { label: 'Architecture', to: '/architecture/overview' },
            { label: 'Service Inventory', to: '/reference/services' },
            { label: 'Routes', to: '/reference/routes' },
          ],
        },
      ],
      copyright: `Generated ${new Date().toISOString().slice(0, 10)}`,
    },
    prism: {
      additionalLanguages: ['bash', 'json', 'yaml'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
