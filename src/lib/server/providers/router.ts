import { getConfig } from '../config';
import { AiSdkStructuredProvider, OpenRouterStructuredProvider } from './text';
import { MockImageProvider, MockSpeechProvider, MockStructuredProvider, ProportionalAligner } from './mock';
import { OpenAiCompatibleImageProvider, OpenAiCompatibleSpeechProvider, OpenRouterImageProvider, OpenRouterSpeechProvider } from './media';
import { QwenForcedAlignerProvider } from './alignment';
import type { AlignmentProvider, ImageProvider, ImageRequest, SpeechProvider, SpeechRequest, StructuredRequest, StructuredTextProvider } from './contracts';

class FallbackTextProvider implements StructuredTextProvider {
  id: string; model: string;
  constructor(private primary: StructuredTextProvider, private fallback: StructuredTextProvider) { this.id = `${primary.id}->${fallback.id}`; this.model = primary.model; }
  async generate<T>(request: StructuredRequest<T>) { try { return await this.primary.generate(request); } catch { return this.fallback.generate(request); } }
}

class FallbackSpeechProvider implements SpeechProvider {
  id: string; model: string;
  constructor(private primary: SpeechProvider, private fallback: SpeechProvider) { this.id = `${primary.id}->${fallback.id}`; this.model = primary.model; }
  async synthesize(request: SpeechRequest) { try { return await this.primary.synthesize(request); } catch { return this.fallback.synthesize(request); } }
}

class FallbackImageProvider implements ImageProvider {
  id: string; model: string; supportsMultipleReferences: boolean;
  constructor(private primary: ImageProvider, private fallback: ImageProvider) { this.id = `${primary.id}->${fallback.id}`; this.model = primary.model; this.supportsMultipleReferences = primary.supportsMultipleReferences && fallback.supportsMultipleReferences; }
  async generate(request: ImageRequest) { try { return await this.primary.generate(request); } catch { return this.fallback.generate(request); } }
}

class FallbackAlignmentProvider implements AlignmentProvider {
  id: string;
  constructor(private primary: AlignmentProvider, private fallback: AlignmentProvider) { this.id = `${primary.id}->${fallback.id}`; }
  async align(audioPath: string, text: string, durationMs: number) { try { return await this.primary.align(audioPath, text, durationMs); } catch { return this.fallback.align(audioPath, text, durationMs); } }
}

export function providers() {
  const config = getConfig();
  if (config.mode === 'mock') return {
    text: new MockStructuredProvider(), image: new MockImageProvider(), speech: new MockSpeechProvider(), aligner: new ProportionalAligner()
  };

  const localText = new AiSdkStructuredProvider({
    id: 'lm-studio',
    baseURL: config.localLlmBaseUrl,
    apiKey: 'local',
    model: config.localLlmModel,
    reasoningEffort: 'none'
  });
  const cloudText = new OpenRouterStructuredProvider(config.openRouterLlmModel, config.openRouterApiKey);
  const localSpeech = new OpenAiCompatibleSpeechProvider('local-tts', config.localTtsModel, config.localTtsBaseUrl, '', 'wav');
  const cloudSpeech = new OpenRouterSpeechProvider(config.openRouterTtsModel, config.openRouterApiKey, config.openRouterTtsVoices);
  const localImage = new OpenAiCompatibleImageProvider('local-image', config.localImageModel, config.localImageBaseUrl, '');
  const cloudImage = new OpenRouterImageProvider(config.openRouterImageModel, config.openRouterApiKey);
  const localAligner = config.localAlignerBaseUrl ? new QwenForcedAlignerProvider(config.localAlignerBaseUrl) : new ProportionalAligner();
  const cloudAligner = new ProportionalAligner();

  const choose = <T>(policy: string, local: T, cloud: T, fallback: (primary: T, secondary: T) => T): T => {
    if (config.mode === 'local' || policy === 'local-required') return local;
    if (config.mode === 'cloud' || policy === 'cloud-only') return cloud;
    if (!config.openRouterApiKey) return local;
    return policy === 'cloud-preferred' ? fallback(cloud, local) : fallback(local, cloud);
  };
  return {
    text: choose<StructuredTextProvider>(config.policies.text, localText, cloudText, (a, b) => new FallbackTextProvider(a, b)),
    speech: choose<SpeechProvider>(config.policies.tts, localSpeech, cloudSpeech, (a, b) => new FallbackSpeechProvider(a, b)),
    image: choose<ImageProvider>(config.policies.image, localImage, cloudImage, (a, b) => new FallbackImageProvider(a, b)),
    aligner: choose<AlignmentProvider>(config.policies.alignment, localAligner, cloudAligner, (a, b) => new FallbackAlignmentProvider(a, b))
  };
}
