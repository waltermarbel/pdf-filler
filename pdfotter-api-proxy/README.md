# Asset Blueprint: Universal PDF Otter API Proxy

## 1. Executive Summary

This asset is a secure, production-grade Cloudflare Worker that functions as a universal proxy for the entire PDF Otter API. It transforms the public PDF Otter API into a private, authenticated service controlled exclusively by you.

Its purpose is to serve as the single, hardened gateway for any application—primarily a Custom GPT—that needs to perform PDF automation tasks, from template creation and management to document fulfillment.

### Strategic Objectives

*   **Total Control:** Centralize all PDF Otter API interactions through a single point of control that you own.
*   **Absolute Security:** Expose a private API key (`WORKER_KEY`) to clients (like a GPT Action) while keeping the master PDF Otter API key (`PDFOTTER_API_KEY`) completely secured on the server-side.
*   **Universal Functionality:** Proxy the *entire* PDF Otter API surface, not just a single endpoint. This allows the GPT to list, create, update, delete, and fill any template programmatically.

## 2. System Architecture

The architecture is a classic secure proxy pattern. All complexity is handled by the worker, providing a simple and secure interface for the client.

```
+----------------+ +--------------------------+ +-----------------+
|                | |                          | |                 |
| Custom GPT     |------->| Cloudflare Worker Proxy  |------->| PDF Otter API   |
| (Client)       | | (This Asset)             | | (Upstream)      |
|                | |                          | |                 |
+----------------+ +--------------------------+ +-----------------+
|                |                          |
| 1. Sends request with: | 2. Validates WORKER_KEY. |
|    - Path (/pdf_...) |    Rejects if invalid.      |
|    - Body (JSON/Form) |                          |
|    - X-Worker-Key      | 3. Injects PDFOTTER_API_KEY|
|                |    into Authorization header. |
|                |                          |
|                | 4. Forwards the request.     |
|                |                          |
|                | 5. Streams response back.    |
|<--------------------------|                          |
| 6. Receives final      |                          |
|    response (JSON/PDF). |                          |
```

## 3. Core Components

*   `src/index.js`: The worker logic. A lightweight, stateless proxy that handles authentication, credential injection, and request forwarding.
*   `wrangler.toml`: The configuration file. Defines the worker's name and, most importantly, the secrets it requires.
*   `package.json`: Standard project file for managing dependencies (`wrangler`).
*   `openapi.json`: The comprehensive API contract. This file describes every PDF Otter API endpoint for the Custom GPT, enabling it to intelligently use the entire API.

## 4. Deployment Protocol

Follow these steps precisely to provision and deploy the asset.

**Prerequisites:**
*   Node.js and npm installed.
*   Wrangler CLI installed (`npm install -g wrangler`).
*   Logged into Cloudflare via `wrangler login`.

**Step 1: Set Up Project**
Create a directory, and place the four provided files (`package.json`, `wrangler.toml`, `openapi.json`, and `src/index.js`) inside it. The `index.js` file should be in a `src` subdirectory.

**Step 2: Install Dependencies**
In the project directory, run:
```bash
npm install
```
**Step 3: Provision Secrets (Mandatory)**
This worker requires two secrets to function. Run these commands from your terminal and paste the keys when prompted.

*PDF Otter API Key:* Your production key from the PDF Otter dashboard.
```bash
npx wrangler secret put PDFOTTER_API_KEY
```
*Worker Access Key:* A unique, strong password you generate. This is what your GPT will use to access the worker.
```bash
npx wrangler secret put WORKER_KEY
```
**Step 4: Deploy the Worker**
```bash
npx wrangler deploy
```
Wrangler will output a URL (e.g., `https://pdfotter-api-proxy.your-name.workers.dev`). Copy this URL.

## 5. GPT Integration Protocol

**Step 1: Update API Schema**
Open `openapi.json`. Replace the placeholder URL in the `servers` block with the URL you copied from the deployment step.

**Step 2: Configure GPT Action**
1.  In your Custom GPT's configuration, click "Create new action."
2.  Paste the entire updated content of `openapi.json` into the schema editor.
3.  Click the "Authentication" button below the schema editor.
4.  Select "API Key" as the authentication type.
5.  Paste your secret `WORKER_KEY` (from Deployment Step 3) into the API Key field.
6.  Set the Auth Type to "Custom."
7.  Set the Header Name to `X-Worker-Key`.
8.  Click "Save."

Your Custom GPT is now a fully-featured, authenticated client for your private PDF Otter proxy. It can discover and use all available actions, such as "list all pdf templates," "get details for template tem_abc," and "fill template tem_xyz with the following data."
