import { getConfig } from '../config';
import type { RunContext } from '../context';
import { AiSdkStructuredProvider, OpenRouterStructuredProvider } from './text';
import { MockImageProvider, MockSpeechProvider, MockStructuredProvider, ProportionalAligner } from './mock';
import { ChatterboxSpeechProvider, OpenAiCompatibleImageProvider, OpenAiCompatibleSpeechProvider, OpenRouterImageProvider, OpenRouterSpeechProvider } from './media';
import { QwenForcedAlignerProvider } from './alignment';
import type { AlignmentProvider, ImageProvider, ImageRequest, SpeechProvider, SpeechRequest, StructuredRequest, StructuredTextProvider } from './contracts';
import { remapVoice } from '../voices';

class FallbackTextProvider implements StructuredTextProvider {
  id: string; model: string;
  constructor(private primary: StructuredTextProvider, private fallback: StructuredTextProvider) { this.id = `${primary.id}->${fallback.id}`; this.model = primary.model; }
  async generate<T>(request: StructuredRequest<T>) { try { return await this.primary.generate(request); } catch { return this.fallback.generate(request); } }
}

class FallbackSpeechProvider implements SpeechProvider {
  id: string; model: string;
  readonly voiceOptions: SpeechProvider['voiceOptions'];
  constructor(private primary: SpeechProvider, private fallback: SpeechProvider) {
    this.id = `${primary.id}->${fallback.id}`; this.model = primary.model; this.voiceOptions = primary.voiceOptions;
  }
  async synthesize(request: SpeechRequest) {
    try { return await this.primary.synthesize(request); }
    catch {
      const voice = remapVoice(request.voice, this.fallback.voiceOptions, this.fallback.id, this.fallback.model);
      return this.fallback.synthesize({ ...request, voice });
    }
  }
}

class FallbackImageProvider implements ImageProvider {
  id: string; model: string; supportsMultipleReferences: boolean;
  constructor(private primary: ImageProvider, private fallback: ImageProvider) { this.id = `${primary.id}->${fallback.id}`; this.model = primary.model; this.supportsMultipleReferences = primary.supportsMultipleReferences && fallback.supportsMultipleReferences; }
  async generate(request: ImageRequest) { try { return await this.primary.generate(request); } catch { return this.fallback.generate(request); } }
}

class FallbackAlignmentProvider implements AlignmentProvider {
  id: string;
  constructor(private primary: AlignmentProvider, private fallback: AlignmentProvider) { this.id = `${primary.id}->${fallback.id}`; }
  async align(...args: Parameters<AlignmentProvider['align']>) { try { return await this.primary.align(...args); } catch { return this.fallback.align(...args); } }
}

/**
 * Selects a provider per capability for one user's run. Cloud credentials come from the
 * run context — in a multi-tenant deployment the key belongs to the requesting account,
 * never to the process.
 */
export function providers(context: RunContext) {
  const config = getConfig();
  if (context.mode === 'mock') return {
    text: new MockStructuredProvider(), image: new MockImageProvider(), speech: new MockSpeechProvider(), aligner: new ProportionalAligner()
  };

  const cloudKey = context.credentials.openRouterApiKey;
  const localText = new AiSdkStructuredProvider({
    id: 'lm-studio',
    baseURL: config.localLlmBaseUrl,
    apiKey: 'local',
    model: config.localLlmModel,
    reasoningEffort: 'none'
  });
  const cloudText = new OpenRouterStructuredProvider(config.openRouterLlmModel, cloudKey, config.openRouterProviderSort);
  const localSpeech = config.localTtsEngine === 'chatterbox-v3'
    ? new ChatterboxSpeechProvider(config.localTtsBaseUrl)
    : new OpenAiCompatibleSpeechProvider('local-tts', config.localTtsModel, config.localTtsBaseUrl, '', 'wav');
  const cloudSpeech = new OpenRouterSpeechProvider(config.openRouterTtsModel, cloudKey, config.openRouterTtsVoices);
  const localImage = new OpenAiCompatibleImageProvider('local-image', config.localImageModel, config.localImageBaseUrl, '');
  const cloudImage = new OpenRouterImageProvider(config.openRouterImageModel, cloudKey);
  const localAligner = config.localAlignerBaseUrl ? new QwenForcedAlignerProvider(config.localAlignerBaseUrl) : new ProportionalAligner();
  const cloudAligner = new ProportionalAligner();

  const choose = <T>(policy: string, local: T, cloud: T, fallback: (primary: T, secondary: T) => T): T => {
    if (context.mode === 'local' || policy === 'local-required') return local;
    if (context.mode === 'cloud' || policy === 'cloud-only') return cloud;
    if (!cloudKey) return local;
    return policy === 'cloud-preferred' ? fallback(cloud, local) : fallback(local, cloud);
  };
  return {
    text: choose<StructuredTextProvider>(context.policies.text, localText, cloudText, (a, b) => new FallbackTextProvider(a, b)),
    speech: choose<SpeechProvider>(context.policies.tts, localSpeech, cloudSpeech, (a, b) => new FallbackSpeechProvider(a, b)),
    image: choose<ImageProvider>(context.policies.image, localImage, cloudImage, (a, b) => new FallbackImageProvider(a, b)),
    aligner: choose<AlignmentProvider>(context.policies.alignment, localAligner, cloudAligner, (a, b) => new FallbackAlignmentProvider(a, b))
  };
}
