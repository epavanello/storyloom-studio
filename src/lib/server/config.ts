import { env } from '$env/dynamic/private';
import { z } from 'zod';

const PolicySchema = z.enum(['local-required', 'local-preferred', 'cloud-preferred', 'cloud-only']);

export const AppConfigSchema = z.object({
  mode: z.enum(['mock', 'local', 'cloud', 'hybrid']),
  dataDir: z.string(),
  localLlmBaseUrl: z.string(),
  localLlmModel: z.string(),
  localLlmModelKey: z.string(),
  openRouterApiKey: z.string(),
  openRouterLlmModel: z.string(),
  localTtsBaseUrl: z.string(),
  localTtsModel: z.string(),
  localTtsRuntimeModel: z.string(),
  localImageBaseUrl: z.string(),
  localImageModel: z.string(),
  localImageRuntimeModel: z.string(),
  localAlignerBaseUrl: z.string(),
  openRouterTtsModel: z.string(),
  openRouterTtsVoices: z.array(z.string()).min(1),
  openRouterImageModel: z.string(),
  policies: z.object({
    text: PolicySchema,
    tts: PolicySchema,
    image: PolicySchema,
    alignment: PolicySchema
  })
});

export function getConfig() {
  return AppConfigSchema.parse({
    mode: env.STORYLOOM_MODE ?? 'mock',
    dataDir: env.STORYLOOM_DATA_DIR ?? './data',
    localLlmBaseUrl: env.LOCAL_LLM_BASE_URL ?? 'http://127.0.0.1:1234/v1',
    localLlmModel: env.LOCAL_LLM_MODEL ?? 'local-model',
    localLlmModelKey: env.LOCAL_LLM_MODEL_KEY ?? env.LOCAL_LLM_MODEL ?? 'local-model',
    openRouterApiKey: env.OPENROUTER_API_KEY ?? '',
    openRouterLlmModel: env.OPENROUTER_LLM_MODEL ?? 'deepseek/deepseek-v4-flash-0731',
    localTtsBaseUrl: env.LOCAL_TTS_BASE_URL ?? 'http://127.0.0.1:7861/v1',
    localTtsModel: env.LOCAL_TTS_MODEL ?? 'qwen3-tts',
    localTtsRuntimeModel: env.LOCAL_TTS_RUNTIME_MODEL ?? 'mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-8bit',
    localImageBaseUrl: env.LOCAL_IMAGE_BASE_URL ?? 'http://127.0.0.1:7862/v1',
    localImageModel: env.LOCAL_IMAGE_MODEL ?? 'qwen-image-edit',
    localImageRuntimeModel: env.LOCAL_IMAGE_RUNTIME_MODEL ?? 'mlx-community/flux2-klein-4b-4bit',
    localAlignerBaseUrl: env.LOCAL_ALIGNER_BASE_URL ?? '',
    openRouterTtsModel: env.OPENROUTER_TTS_MODEL ?? 'google/gemini-3.1-flash-tts-preview',
    openRouterTtsVoices: (env.OPENROUTER_TTS_VOICES ?? 'Zephyr,Puck,Charon,Kore,Fenrir,Leda,Orus,Aoede,Callirrhoe,Autonoe,Enceladus,Iapetus,Umbriel,Algieba,Despina,Erinome,Algenib,Rasalgethi,Laomedeia,Achernar,Alnilam,Schedar,Gacrux,Pulcherrima,Achird,Zubenelgenubi,Vindemiatrix,Sadachbia,Sadaltager,Sulafat').split(',').map((voice) => voice.trim()).filter(Boolean),
    openRouterImageModel: env.OPENROUTER_IMAGE_MODEL ?? 'google/gemini-3.1-flash-image',
    policies: {
      text: env.TEXT_POLICY ?? 'local-preferred',
      tts: env.TTS_POLICY ?? 'local-preferred',
      image: env.IMAGE_POLICY ?? 'local-preferred',
      alignment: env.ALIGNMENT_POLICY ?? 'local-preferred'
    }
  });
}
