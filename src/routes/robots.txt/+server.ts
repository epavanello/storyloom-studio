import type { RequestHandler } from './$types';
import { getConfig } from '$lib/server/config';

export const GET: RequestHandler = () => {
  const origin = getConfig().publicUrl;
  const body = `# Storyloom Studio — open-source audiovisual storytelling
User-agent: *
Allow: /
Allow: /llms.txt
Disallow: /api/
Disallow: /auth/
Disallow: /books/
Disallow: /jobs
Disallow: /settings

Sitemap: ${origin}/sitemap.xml
`;
  return new Response(body, {
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=86400' }
  });
};
