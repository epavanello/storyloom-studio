export function storyloomLlmsIndex(origin: string) {
  return `# Storyloom Studio

> Storyloom Studio is an open-source, local-first application that turns EPUB, PDF, TXT, or AI-authored books into synchronized audiovisual chapter performances.

Storyloom preserves the imported source text. Creative planning is stored as a separate, structured annotation layer, and expensive narration and imagery are generated on demand.

## Start here

- [Product overview](${origin}/): What Storyloom does, how chapter generation works, and the hosted BYOK model.
- [Source repository](https://github.com/epavanello/storyloom-studio): Installation, architecture, configuration, limitations, and contribution guidance.
- [OpenRouter keys](https://openrouter.ai/settings/keys): Create the personal key used by the hosted service.

## Deployment choices

- Hosted SaaS: each account supplies its own OpenRouter key. The key is encrypted at rest and used only for that account's jobs.
- Trusted self-host: one environment OpenRouter key can fund every account.
- Local: text, speech, alignment, and images can run on the deployment machine when their local runtimes are configured.
- Mock: deterministic providers exercise the complete product flow without external credentials or model downloads.

## Supported sources and outputs

- Inputs: EPUB, PDF, TXT, or a story prompt.
- Outputs: preserved chapter text, character and voice registries, narration passages, word timing, scene images, and a versioned rendered chapter manifest.
- Generation is chapter-scoped and on demand; Storyloom does not eagerly render an entire imported book.

## Discovery

- [Sitemap](${origin}/sitemap.xml)
- [Robots policy](${origin}/robots.txt)
`;
}
