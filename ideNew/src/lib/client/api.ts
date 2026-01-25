export type FetchOptions = {
  method?: string;
  body?: any;
  token: string;
};

export const fetchJson = async (url: string, { method = 'GET', body, token }: FetchOptions) => {
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Session ${token}`
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || 'Request failed');
  }
  return data;
};
