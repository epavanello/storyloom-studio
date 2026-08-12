import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { resolveArtifact } from '../store';
import type { AlignmentProvider } from './contracts';

const AlignmentResponseSchema = z.object({
  words: z.array(z.object({
    text: z.string(),
    start_ms: z.number().nonnegative(),
    end_ms: z.number().nonnegative()
  }))
});

export class QwenForcedAlignerProvider implements AlignmentProvider {
  readonly id = 'qwen3-forced-aligner';

  constructor(private readonly baseUrl: string) {}

  async align(audioPath: string, text: string, _durationMs: number) {
    const match = audioPath.match(/^\/api\/artifacts\/([^/]+)\/(.+)$/);
    if (!match) throw new Error(`Cannot align non-local artifact: ${audioPath}`);
    const bookId = decodeURIComponent(match[1]);
    const relativePath = match[2].split('/').map(decodeURIComponent).join('/');
    const bytes = await readFile(resolveArtifact(bookId, relativePath));
    const form = new FormData();
    form.set('audio', new Blob([bytes], { type: 'audio/wav' }), 'utterance.wav');
    form.set('text', text);
    form.set('language', 'Italian');
    const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}/align`, { method: 'POST', body: form });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${(await response.text()).slice(0, 500)}`);
    const payload = AlignmentResponseSchema.parse(await response.json());
    return {
      words: payload.words.map((word) => ({ text: word.text, startMs: word.start_ms, endMs: word.end_ms })),
      quality: 'exact' as const
    };
  }
}
