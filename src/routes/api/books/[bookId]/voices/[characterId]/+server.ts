import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { getConfig } from '$lib/server/config';
import { getManifest, saveManifest } from '$lib/server/store';
import { chatterboxVoiceOptions, assignVoiceProfiles } from '$lib/server/voices';

const RequestSchema = z.object({ voiceId: z.string().regex(/^[a-z0-9-]+$/) });
const speechIdentity = {
  id: 'local-chatterbox',
  model: 'chatterbox-multilingual-v3',
  voiceOptions: chatterboxVoiceOptions
};

export const POST: RequestHandler = async ({ params, request }) => {
  const config = getConfig();
  if (!config.technicalUi || config.localTtsEngine !== 'chatterbox-v3') error(404, 'Voice lab is disabled');
  const { voiceId } = RequestSchema.parse(await request.json());
  const option = chatterboxVoiceOptions.find((item) => item.id === voiceId);
  if (!option) error(400, 'Unknown synthetic voice');

  const manifest = await getManifest(params.bookId);
  const target = params.characterId === 'narrator'
    ? null
    : manifest.characters.find((character) => character.id === params.characterId);
  if (params.characterId !== 'narrator' && !target) error(404, 'Character not found');
  if (target && !['unknown', 'neutral', option.gender].includes(target.voiceGender)) {
    error(400, `Voice gender ${option.gender} does not match ${target.voiceGender}`);
  }

  const registryCurrent = manifest.voices.some((voice) => voice.characterId === 'narrator')
    && manifest.characters.every((character) => manifest.voices.some((voice) => voice.characterId === character.id))
    && manifest.voices.every((voice) => voice.model === speechIdentity.model && chatterboxVoiceOptions.some((item) => item.id === voice.voiceId));
  if (!registryCurrent) manifest.voices = assignVoiceProfiles(manifest, speechIdentity);

  const profile = manifest.voices.find((voice) => voice.characterId === params.characterId);
  if (!profile) error(500, 'Voice profile could not be initialized');
  profile.voiceId = option.id;
  profile.provider = speechIdentity.id;
  profile.model = speechIdentity.model;
  profile.description = option.description;
  profile.gender = option.gender;
  await saveManifest(manifest);
  return json(profile);
};
