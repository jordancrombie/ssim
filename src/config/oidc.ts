import { Issuer, Client, generators } from 'openid-client';
import { config, OIDCProviderConfig } from './env';

interface InitializedProvider {
  config: OIDCProviderConfig;
  client: Client;
}

const initializedProviders: Map<string, InitializedProvider> = new Map();

/**
 * Ensure URL uses HTTPS protocol
 * This prevents 301 redirect issues when HTTP URLs are accidentally configured
 */
function ensureHttps(url: string): string {
  if (url.startsWith('http://')) {
    const httpsUrl = url.replace('http://', 'https://');
    console.warn(`[OIDC] Upgrading HTTP URL to HTTPS: ${url} -> ${httpsUrl}`);
    return httpsUrl;
  }
  return url;
}

export async function initializeProviders(): Promise<void> {
  for (const providerConfig of config.providers) {
    try {
      const issuerUrl = ensureHttps(providerConfig.issuer);
      console.log(`Discovering OIDC provider: ${providerConfig.name} (${issuerUrl})`);

      const issuer = await Issuer.discover(issuerUrl);
      console.log(`Discovered issuer: ${issuer.metadata.issuer}`);

      const client = new issuer.Client({
        client_id: providerConfig.clientId,
        client_secret: providerConfig.clientSecret,
        redirect_uris: [`${config.appBaseUrl}/auth/callback/${providerConfig.id}`],
        response_types: ['code'],
      });

      initializedProviders.set(providerConfig.id, {
        config: providerConfig,
        client,
      });

      console.log(`Initialized OIDC provider: ${providerConfig.name}`);
    } catch (error) {
      console.error(`Failed to initialize provider ${providerConfig.name}:`, error);
    }
  }
}

export function getProvider(providerId: string): InitializedProvider | undefined {
  return initializedProviders.get(providerId);
}

export function getAllProviders(): { id: string; name: string }[] {
  return Array.from(initializedProviders.entries()).map(([id, provider]) => ({
    id,
    name: provider.config.name,
  }));
}

export function generateState(): string {
  return generators.state();
}

export function generateNonce(): string {
  return generators.nonce();
}

export function generateCodeVerifier(): string {
  return generators.codeVerifier();
}

export function generateCodeChallenge(verifier: string): string {
  return generators.codeChallenge(verifier);
}
