import type { RequestHandler } from './$types';
import { storyloomLlmsIndex } from '$lib/server/agent-docs';
import { getConfig } from '$lib/server/config';

/** Compatibility alias for clients that still probe the singular filename. */
export const GET: RequestHandler = () => new Response(storyloomLlmsIndex(getConfig().publicUrl), {
  headers: { 'content-type': 'text/markdown; charset=utf-8', 'cache-control': 'public, max-age=3600', link: '</llms.txt>; rel="canonical"' }
});
