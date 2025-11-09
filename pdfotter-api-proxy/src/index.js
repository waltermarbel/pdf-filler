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

// --- Prefetch Logic Configuration ---
const knownProfiles = {
  "roy.bello@example.com": {
    templateId: "tem_7WBuGSfWyatmFA",
    data: {
      "First name:": "Roy",
      "Last name:": "Bello",
      "Email address:": "roy.bello@example.com",
    }
  },
  "pablo.choy@example.com": {
    templateId: "tem_4ojiqN5ey48qsg",
    data: {
      "First name:": "Pablo",
      "Last name:": "Choy",
      "Email address:": "pablo.choy@example.com",
    }
  },
  "maleidy.martinez@example.com": {
    templateId: "tem_RSYSFfp7hfVsux",
    data: {
      "First name:": "Maleidy",
      "Last name:": "Martinez",
      "Email address:": "maleidy.martinez@example.com",
    }
  }
};

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
    let targetUrl = PDF_OTTER_BASE_URL + url.pathname;
    const isFillEndpoint = url.pathname.endsWith('/fill');

    let requestBody = {};
    let finalBody = null;

    if (request.method === 'POST' || request.method === 'PUT') {
      const contentType = request.headers.get('Content-Type') || '';
      if (contentType.includes('application/json')) {
        requestBody = await request.json();

        // --- Prefetch Logic ---
        if (isFillEndpoint && requestBody.data) {
          const email = requestBody.data['Email address:'] || requestBody.data['Email address'];
          const profile = knownProfiles[email];

          if (profile) {
            // Dynamically set the templateId for the API call
            targetUrl = `${PDF_OTTER_BASE_URL}/pdf_templates/${profile.templateId}/fill`;
            // Merge profile data with incoming data
            requestBody.data = { ...profile.data, ...requestBody.data };
          }
        }
        finalBody = JSON.stringify(requestBody);
      } else {
        finalBody = await request.blob();
      }
    }

    const pdfOtterAuth = btoa(`${env.PDFOTTER_API_KEY}:`);
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('Authorization', `Basic ${pdfOtterAuth}`);
    requestHeaders.set('Host', 'www.pdfotter.com');
    requestHeaders.delete('X-Worker-Key');

    try {
      const response = await fetch(targetUrl, {
        method: request.method,
        headers: requestHeaders,
        body: finalBody,
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
