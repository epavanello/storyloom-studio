import type { RequestHandler } from './$types';

export const GET: RequestHandler = () => Response.json({
  name: 'Storyloom Studio',
  short_name: 'Storyloom',
  description: 'Turn books into synchronized audiovisual chapter performances.',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  theme_color: '#22352f',
  background_color: '#f5f1ea',
  icons: [{ src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
  categories: ['books', 'entertainment', 'productivity'],
  lang: 'en'
}, { headers: { 'content-type': 'application/manifest+json', 'cache-control': 'public, max-age=86400' } });
