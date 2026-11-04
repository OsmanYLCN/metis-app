export type Health = {
  status: 'Healthy';
  service: 'personal-os-api';
  scope: 'process-only';
};

export const API_URL = 'http://127.0.0.1:5080';

// Foundation has one local endpoint. Remote configuration arrives with authentication.
export async function checkHealth(signal?: AbortSignal): Promise<Health> {
  const response = await fetch(`${API_URL}/health`, {
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(4000)])
      : AbortSignal.timeout(4000),
    cache: 'no-store',
    credentials: 'omit',
  });
  if (!response.ok) throw new Error('API erişilemiyor.');
  const body: unknown = await response.json();
  if (
    typeof body !== 'object' || body === null ||
    !('status' in body) || body.status !== 'Healthy' ||
    !('service' in body) || body.service !== 'personal-os-api' ||
    !('scope' in body) || body.scope !== 'process-only'
  ) throw new Error('Beklenmeyen health yanıtı.');
  return body as Health;
}
