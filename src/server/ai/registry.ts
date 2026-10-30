import { createAnthropicProvider, type AiProvider } from "./provider";

/**
 * The one place a provider is made. Production: Anthropic over `fetch`. Tests: `setProviderFactoryForTests` swaps in a fake,
 * so no test ever touches the network (and a test can read exactly what the provider was given).
 */
export interface ProviderConfig {
  apiKey: string;
  model: string;
}

export type ProviderFactory = (config: ProviderConfig) => AiProvider;

const real: ProviderFactory = (config) => createAnthropicProvider({ apiKey: config.apiKey, model: config.model });

let factory: ProviderFactory = real;

export function makeProvider(config: ProviderConfig): AiProvider {
  return factory(config);
}

/** Tests only: pass a factory to replace the provider, `null` to restore the real one. */
export function setProviderFactoryForTests(next: ProviderFactory | null): void {
  factory = next ?? real;
}
