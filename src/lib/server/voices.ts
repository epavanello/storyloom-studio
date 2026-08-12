import type { BookManifest, Character, VoiceProfile } from '$lib/core/schemas';
import type { VoiceOption } from './providers/contracts';

export const qwenVoiceOptions: readonly VoiceOption[] = [
  { id: 'Vivian', gender: 'female', description: 'confident, lively young woman' },
  { id: 'Serena', gender: 'female', description: 'gentle young woman' },
  { id: 'Ono_Anna', gender: 'female', description: 'spirited young woman' },
  { id: 'Sohee', gender: 'female', description: 'warm, emotionally expressive woman' },
  { id: 'Uncle_Fu', gender: 'male', description: 'seasoned older man' },
  { id: 'Dylan', gender: 'male', description: 'clear young man' },
  { id: 'Eric', gender: 'male', description: 'steady adult man' },
  { id: 'Ryan', gender: 'male', description: 'natural adult man' },
  { id: 'Aiden', gender: 'male', description: 'young adult man' }
];

export const chatterboxVoiceOptions: readonly VoiceOption[] = [
  { id: 'narrator-warm-a', gender: 'female', description: 'fictional VoiceDesign · warm, authoritative Italian narrator' },
  { id: 'narrator-clear-b', gender: 'female', description: 'fictional VoiceDesign · clear, understated Italian narrator' },
  { id: 'narrator-deep-c', gender: 'female', description: 'fictional VoiceDesign · deep, cinematic Italian narrator' },
  { id: 'male-sober-a', gender: 'male', description: 'fictional VoiceDesign · grounded mature Italian man' },
  { id: 'male-grave-b', gender: 'male', description: 'fictional VoiceDesign · deep, reserved Italian investigator' },
  { id: 'male-clear-c', gender: 'male', description: 'fictional VoiceDesign · clear adult Italian man' }
];

export const geminiVoiceOptions: readonly VoiceOption[] = [
  { id: 'Zephyr', gender: 'female', description: 'bright' },
  { id: 'Kore', gender: 'female', description: 'firm' },
  { id: 'Leda', gender: 'female', description: 'youthful' },
  { id: 'Aoede', gender: 'female', description: 'breezy' },
  { id: 'Callirrhoe', gender: 'female', description: 'easy-going' },
  { id: 'Autonoe', gender: 'female', description: 'bright' },
  { id: 'Despina', gender: 'female', description: 'smooth' },
  { id: 'Erinome', gender: 'female', description: 'clear' },
  { id: 'Gacrux', gender: 'female', description: 'mature' },
  { id: 'Laomedeia', gender: 'female', description: 'upbeat' },
  { id: 'Pulcherrima', gender: 'female', description: 'forward' },
  { id: 'Sulafat', gender: 'female', description: 'warm' },
  { id: 'Vindemiatrix', gender: 'female', description: 'gentle' },
  { id: 'Achernar', gender: 'female', description: 'soft' },
  { id: 'Puck', gender: 'male', description: 'upbeat' },
  { id: 'Charon', gender: 'male', description: 'informative' },
  { id: 'Fenrir', gender: 'male', description: 'excitable' },
  { id: 'Orus', gender: 'male', description: 'firm' },
  { id: 'Enceladus', gender: 'male', description: 'breathy' },
  { id: 'Iapetus', gender: 'male', description: 'clear' },
  { id: 'Algenib', gender: 'male', description: 'gravelly' },
  { id: 'Algieba', gender: 'male', description: 'smooth' },
  { id: 'Alnilam', gender: 'male', description: 'firm' },
  { id: 'Rasalgethi', gender: 'male', description: 'informative' },
  { id: 'Schedar', gender: 'male', description: 'even' },
  { id: 'Achird', gender: 'male', description: 'friendly' },
  { id: 'Umbriel', gender: 'male', description: 'easy-going' },
  { id: 'Zubenelgenubi', gender: 'male', description: 'casual' },
  { id: 'Sadachbia', gender: 'male', description: 'lively' },
  { id: 'Sadaltager', gender: 'male', description: 'knowledgeable' }
];

function seed(value: string) {
  let result = 0;
  for (const character of value) result = (result * 31 + character.charCodeAt(0)) | 0;
  return Math.abs(result);
}

function chooseVoice(characterId: string, gender: Character['voiceGender'], options: readonly VoiceOption[], used: Set<string>) {
  const matching = gender === 'unknown' || gender === 'neutral' ? options : options.filter((voice) => voice.gender === gender);
  const pool = matching.length ? matching : options;
  if (!pool.length) throw new Error('The selected speech provider exposes no usable voices');
  const ordered = [...pool].sort((a, b) => seed(`${characterId}:${a.id}`) - seed(`${characterId}:${b.id}`));
  return ordered.find((voice) => !used.has(voice.id)) ?? ordered[seed(characterId) % ordered.length];
}

export function assignVoiceProfiles(manifest: BookManifest, provider: { id: string; model: string; voiceOptions: readonly VoiceOption[] }): VoiceProfile[] {
  const used = new Set<string>();
  const narratorOption = provider.voiceOptions.find((voice) => voice.id === 'Sulafat')
    ?? provider.voiceOptions.find((voice) => voice.gender === 'female')
    ?? provider.voiceOptions[0];
  if (!narratorOption) throw new Error('The selected speech provider exposes no usable narrator voice');
  used.add(narratorOption.id);
  const profiles: VoiceProfile[] = [{
    characterId: 'narrator',
    voiceId: narratorOption.id,
    seed: seed(`${manifest.id}:narrator`),
    description: `Warm literary narrator · ${narratorOption.description}`,
    gender: narratorOption.gender,
    language: 'it',
    provider: provider.id,
    model: provider.model
  }];
  for (const character of manifest.characters) {
    const option = chooseVoice(character.id, character.voiceGender, provider.voiceOptions, used);
    used.add(option.id);
    profiles.push({
      characterId: character.id,
      voiceId: option.id,
      seed: seed(`${manifest.id}:${character.id}`),
      description: `${character.voiceDescription} · ${option.description}`,
      gender: character.voiceGender,
      language: 'it',
      provider: provider.id,
      model: provider.model
    });
  }
  return profiles;
}

export function voiceFor(characterId: string | null, manifest: BookManifest): VoiceProfile {
  const id = characterId ?? 'narrator';
  const voice = manifest.voices.find((candidate) => candidate.characterId === id);
  if (!voice) throw new Error(`Voice registry has no profile for ${id}`);
  return voice;
}

export function remapVoice(profile: VoiceProfile, options: readonly VoiceOption[], provider: string, model: string): VoiceProfile {
  if (options.some((option) => option.id === profile.voiceId)) return { ...profile, provider, model };
  const option = chooseVoice(profile.characterId, profile.gender, options, new Set());
  return { ...profile, voiceId: option.id, provider, model };
}
