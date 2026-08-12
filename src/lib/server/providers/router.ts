import { getConfig } from '../config';
import { AiSdkStructuredProvider } from './text';
import { MockImageProvider, MockSpeechProvider, MockStructuredProvider, ProportionalAligner } from './mock';
import { OpenAiCompatibleImageProvider, OpenAiCompatibleSpeechProvider } from './media';
import type { ImageProvider, ImageRequest, SpeechProvider, SpeechRequest, StructuredRequest, StructuredTextProvider } from './contracts';

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

export function providers() {
  const config = getConfig();
  if (config.mode === 'mock') return {
    text: new MockStructuredProvider(), image: new MockImageProvider(), speech: new MockSpeechProvider(), aligner: new ProportionalAligner()
  };

  const localText = new AiSdkStructuredProvider({ id: 'lm-studio', baseURL: config.localLlmBaseUrl, apiKey: 'local', model: config.localLlmModel });
  const cloudText = new AiSdkStructuredProvider({ id: 'openrouter', baseURL: 'https://openrouter.ai/api/v1', apiKey: config.openRouterApiKey, model: config.openRouterLlmModel });
  const localSpeech = new OpenAiCompatibleSpeechProvider('local-tts', config.localTtsModel, config.localTtsBaseUrl, '');
  const cloudSpeech = new OpenAiCompatibleSpeechProvider('openrouter', config.openRouterTtsModel, 'https://openrouter.ai/api/v1', config.openRouterApiKey);
  const localImage = new OpenAiCompatibleImageProvider('local-image', config.localImageModel, config.localImageBaseUrl, '');
  const cloudImage = new OpenAiCompatibleImageProvider('openrouter', config.openRouterImageModel, 'https://openrouter.ai/api/v1', config.openRouterApiKey);

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
    aligner: new ProportionalAligner()
  };
}
