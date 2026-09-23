const DEFAULT_APPS_SCRIPT_URL =
  'https://script.google.com/macros/s/AKfycbx_oskzxEmhTpYsEloIKwxvWhmJPEsVx2UZuO6QW3hC7fz9KLxfzm8ZaB_4Gvk5y1B8/exec';

const MAX_REQUEST_BYTES = 5_500_000;
const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

const reply = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });

export default async function handler(request) {
  if (request.method !== 'POST') {
    return reply({ ok: false, error: 'Method not allowed.' }, 405);
  }

  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return reply({ ok: false, error: 'JSON is required.' }, 415);
  }

  const declaredSize = Number(request.headers.get('content-length'));
  if (declaredSize > MAX_REQUEST_BYTES) {
    return reply({ ok: false, error: 'Files are too large for one submission.' }, 413);
  }

  let input;
  try {
    const body = await request.text();
    if (new TextEncoder().encode(body).byteLength > MAX_REQUEST_BYTES) {
      return reply({ ok: false, error: 'Files are too large for one submission.' }, 413);
    }
    input = JSON.parse(body);
  } catch {
    return reply({ ok: false, error: 'The form data could not be read.' }, 400);
  }

  if (!input || typeof input !== 'object') {
    return reply({ ok: false, error: 'The form data is invalid.' }, 400);
  }

  // This is a simple bot trap. No applicant data is retained for trapped requests.
  if (input.website) return reply({ ok: true, applicationId: 'Received' });
  if (!input.requestId || !input.application || !input.photo?.base64 ||
      !input.idDocument?.base64 || !input.signature?.base64) {
    return reply({ ok: false, error: 'Complete the form, files and signature.' }, 400);
  }

  const apiKey = process.env.APPS_SCRIPT_API_KEY;
  if (!apiKey) {
    return reply({ ok: false, error: 'This form is not configured yet. Please contact Re Prop.' }, 503);
  }

  const endpoint = process.env.APPS_SCRIPT_URL || DEFAULT_APPS_SCRIPT_URL;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 55_000);

  try {
    const upstream = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        apiKey,
        requestId: input.requestId,
        application: input.application,
        photo: input.photo,
        idDocument: input.idDocument,
        signature: input.signature,
      }),
      redirect: 'follow',
      signal: controller.signal,
    });

    const data = await upstream.json().catch(() => null);
    if (!upstream.ok || !data || typeof data.ok !== 'boolean') {
      return reply({ ok: false, error: 'The application service is unavailable. Please try again.' }, 502);
    }
    if (!data.ok) {
      return reply({ ok: false, error: data.error || 'The application was not accepted.' }, 422);
    }
    return reply({ ok: true, applicationId: data.applicationId, duplicate: Boolean(data.duplicate) });
  } catch {
    return reply({ ok: false, error: 'Submission was interrupted. Please try again.' }, 504);
  } finally {
    clearTimeout(timeout);
  }
}
