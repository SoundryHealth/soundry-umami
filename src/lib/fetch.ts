import { buildPath } from '@/lib/url';

export interface ErrorResponse {
  error: {
    status: number;
    message: string;
    code?: string;
  };
}

export interface FetchResponse {
  ok: boolean;
  status: number;
  data?: any;
  error?: ErrorResponse;
}

export async function request(
  method: string,
  url: string,
  body?: string,
  headers: object = {},
): Promise<FetchResponse> {
  return fetch(url, {
    method,
    cache: 'no-cache',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...headers,
    },
    body,
  }).then(async res => {
    // Important: some endpoints may legitimately return an empty body (e.g. 204),
    // and server errors may return non-JSON. Avoid throwing on res.json().
    const raw = await res.text();
    const contentType = res.headers.get('content-type') || '';

    let data: any;

    if (raw) {
      if (
        contentType.includes('application/json') ||
        raw.trimStart().startsWith('{') ||
        raw.trimStart().startsWith('[')
      ) {
        try {
          data = JSON.parse(raw);
        } catch {
          // Fall back to a structured error for non-JSON responses.
          data = { error: { message: raw, status: res.status } };
        }
      } else {
        data = { error: { message: raw, status: res.status } };
      }
    }

    // If we got a non-OK response with no payload, still surface a usable error.
    if (!res.ok && (!data || typeof data !== 'object' || !('error' in data))) {
      data = {
        error: {
          message: res.statusText || 'Request failed',
          status: res.status,
        },
      };
    }

    // Helpful debug in dev to pinpoint unexpected empty/non-JSON responses.
    if (process.env.NODE_ENV !== 'production' && !res.ok) {
      // eslint-disable-next-line no-console
      console.error('API request failed:', { method, url, status: res.status, data });
    }

    return {
      ok: res.ok,
      status: res.status,
      data,
    };
  });
}

export async function httpGet(path: string, params: object = {}, headers: object = {}) {
  return request('GET', buildPath(path, params), undefined, headers);
}

export async function httpDelete(path: string, params: object = {}, headers: object = {}) {
  return request('DELETE', buildPath(path, params), undefined, headers);
}

export async function httpPost(path: string, params: object = {}, headers: object = {}) {
  return request('POST', path, JSON.stringify(params), headers);
}

export async function httpPut(path: string, params: object = {}, headers: object = {}) {
  return request('PUT', path, JSON.stringify(params), headers);
}
