import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getVoiceAudio } from '$lib/server/voice-catalog';

export const GET: RequestHandler = async ({ params, url }) => {
  const kind = url.searchParams.get('kind') === 'audition' ? 'audition' : 'reference';
  const audio = await getVoiceAudio(params.voiceId, kind);
  if (!audio) error(404, 'Voice reference not found');
  return new Response(audio, {
    headers: {
      'content-type': 'audio/wav',
      'cache-control': 'private, max-age=3600'
    }
  });
};
