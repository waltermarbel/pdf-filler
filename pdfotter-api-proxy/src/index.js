/**
 * Cloudflare Worker: Universal PDF Otter API Proxy with Stateful Filling
 *
 * This worker acts as a secure, universal proxy for the entire PDF Otter API.
 * It authenticates incoming requests via a custom 'X-Worker-Key' header,
 * then forwards the request to the PDF Otter API, securely injecting the
 * real PDF Otter API key on the server side.
 *
 * SPECIAL HANDLING FOR /fill ENDPOINT:
 * When a request is made to fill a PDF, this worker will 'tee' the response.
 * One stream is returned directly to the client (e.g., a Custom GPT).
 * The second stream is asynchronously uploaded to a configured R2 bucket.
 */

const PDF_OTTER_BASE_URL = 'https://www.pdfotter.com/api/v1';

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return handleOptions(request);
    }

    const workerKey = request.headers.get('X-Worker-Key');
    if (!workerKey || workerKey !== env.WORKER_KEY) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', ...corsHeaders() },
      });
    }

    const url = new URL(request.url);
    const targetUrl = PDF_OTTER_BASE_URL + url.pathname;
    const isFillEndpoint = url.pathname.endsWith('/fill');

    const pdfOtterAuth = btoa(`${env.PDFOTTER_API_KEY}:`);
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('Authorization', `Basic ${pdfOtterAuth}`);
    requestHeaders.set('Host', 'www.pdfotter.com');
    requestHeaders.delete('X-Worker-Key');

    try {
      const response = await fetch(targetUrl.startsWith(PDF_OTTER_BASE_URL) ? targetUrl : new Response(null, { status: 400 }), {
        method: request.method,
        headers: requestHeaders,
        body: request.body,
        redirect: 'follow',
      });

      const responseHeaders = new Headers(response.headers);
      Object.entries(corsHeaders()).forEach(([key, value]) => {
        responseHeaders.set(key, value);
      });

      if (response.ok && isFillEndpoint && env.PDF_BUCKET) {
        const [streamForClient, streamForR2] = response.body.tee();

        const templateId = url.pathname.split('/')[3] || 'unknown-template';
        const fileName = `filled/${templateId}/${new Date().toISOString()}.pdf`;

        ctx.waitUntil(
          env.PDF_BUCKET.put(fileName, streamForR2, {
            httpMetadata: { contentType: 'application/pdf' },
          })
        );

        return new Response(streamForClient, {
          status: response.status,
          statusText: response.statusText,
          headers: responseHeaders,
        });
      }

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
      });

    } catch (error) {
      return new Response(JSON.stringify({ error: 'Proxy Error', message: error.message }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', ...corsHeaders() },
      });
    }
  },
};

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Worker-Key',
  };
}

function handleOptions(request) {
  const headers = request.headers;
  if (
    headers.get('Origin') !== null &&
    headers.get('Access-Control-Request-Method') !== null &&
    headers.get('Access-Control-Request-Headers') !== null
  ) {
    return new Response(null, { headers: corsHeaders() });
  } else {
    return new Response(null, { headers: { Allow: 'GET, POST, PUT, DELETE, OPTIONS' } });
  }
}
