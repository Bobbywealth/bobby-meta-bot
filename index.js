/**
 * bobby-meta-bot
 * ----------------
 * Meta (Messenger + Instagram) AI autoresponder service.
 *
 * Endpoints:
 *   GET  /                  service health
 *   GET  /privacy           privacy policy HTML
 *   GET  /terms             terms of service HTML
 *   GET  /deletion          data-deletion info page
 *   POST /deletion          handles Meta signed_request, returns confirmation URL
 *   GET  /deletion-status/:code   confirmation page shown to the user after Meta flow
 *   GET  /webhook/meta      Meta webhook handshake (hub.challenge)
 *   POST /webhook/meta      Meta event receiver
 *
 * Env vars (set on Render):
 *   APP_SECRET              Meta App Secret — used for signed_request + webhook signature
 *   META_VERIFY_TOKEN       Random string — Meta echoes during webhook handshake
 *   META_APP_ID             Meta App ID
 *   PORT                    Provided by Render
 */

'use strict';

require('dotenv').config();

const crypto = require('node:crypto');
const express = require('express');

const PORT = Number(process.env.PORT) || 10000;
const APP_SECRET = process.env.APP_SECRET || '';
const META_VERIFY_TOKEN = process.env.META_VERIFY_TOKEN || 'bobby-meta-bot-verify';
const META_APP_ID = process.env.META_APP_ID || '';

const app = express();

// Meta's signed_request and webhooks are application/x-www-form-urlencoded and JSON respectively.
// Capture both early so we can parse them ourselves.
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(express.json({ limit: '1mb' }));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Verify and decode a signed_request from Meta.
 * https://developers.facebook.com/docs/games/gamesonfacebook/login#parsingsr
 *
 * signed_request = base64url(HMAC-SHA256(payload, app_secret)) + "." + base64url(payload)
 * On success, returns the parsed JSON payload (with user_id etc.).
 * On failure, returns null.
 */
function verifySignedRequest(signedRequest) {
  if (!signedRequest || typeof signedRequest !== 'string') return null;
  if (!APP_SECRET) {
    console.error('verifySignedRequest: APP_SECRET not set');
    return null;
  }
  try {
    const [encodedSig, encodedPayload] = signedRequest.split('.');
    if (!encodedSig || !encodedPayload) return null;

    const expectedSig = crypto
      .createHmac('sha256', APP_SECRET)
      .update(encodedPayload)
      .digest();

    const sig = base64UrlDecode(encodedSig);

    // timingSafeEqual requires equal-length buffers.
    if (sig.length !== expectedSig.length) return null;
    if (!crypto.timingSafeEqual(sig, expectedSig)) return null;

    const payloadJson = base64UrlDecode(encodedPayload).toString('utf8');
    const payload = JSON.parse(payloadJson);

    // Optional: verify the app id is ours.
    if (payload.aud && META_APP_ID && payload.aud !== META_APP_ID) {
      console.error('verifySignedRequest: aud mismatch', payload.aud, '!=', META_APP_ID);
      return null;
    }
    return payload;
  } catch (err) {
    console.error('verifySignedRequest: parse error', err.message);
    return null;
  }
}

function base64UrlDecode(s) {
  const pad = (4 - (s.length % 4)) % 4;
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(pad);
  return Buffer.from(padded, 'base64');
}

/**
 * Verify an X-Hub-Signature-256 header from Meta webhooks.
 * https://developers.facebook.com/docs/graph-api/webhooks/getting-started#validate-payloads
 */
function verifyWebhookSignature(rawBody, signatureHeader) {
  if (!APP_SECRET) return true; // dev fallback; log warn in prod
  if (!signatureHeader) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', APP_SECRET).update(rawBody).digest('hex');
  const got = signatureHeader.trim();
  if (expected.length !== got.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(got));
}

// Capture raw body for webhook signature verification.
app.use('/webhook/meta', express.json({
  verify: (req, _res, buf) => { req.rawBody = buf.toString('utf8'); },
  limit: '1mb',
}));

// ---------------------------------------------------------------------------
// Static HTML shell (shared)
// ---------------------------------------------------------------------------

const SHELL_STYLE = `
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    max-width: 760px;
    margin: 48px auto;
    padding: 0 24px;
    color: #1c1e21;
    line-height: 1.65;
    background: #f7f8fa;
  }
  main {
    background: #ffffff;
    padding: 36px 40px;
    border-radius: 16px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.06), 0 6px 24px rgba(0,0,0,0.04);
  }
  h1 {
    color: #1877F2;
    border-bottom: 2px solid #1877F2;
    padding-bottom: 10px;
    margin-top: 0;
    font-size: 28px;
  }
  h2 {
    color: #1c1e21;
    margin-top: 32px;
    font-size: 18px;
  }
  h3 { font-size: 16px; margin-top: 24px; }
  .meta { color: #65676b; font-size: 13px; margin-top: -8px; }
  code { background: #f0f2f5; padding: 2px 6px; border-radius: 4px; font-size: 14px; color: #1877F2; }
  a { color: #1877F2; text-decoration: none; }
  a:hover { text-decoration: underline; }
  ul, ol { padding-left: 22px; }
  li { margin: 6px 0; }
  .pill { display: inline-block; padding: 2px 10px; border-radius: 999px; background: #e7f3ff; color: #1877F2; font-size: 12px; font-weight: 600; }
  footer { color: #65676b; font-size: 12px; text-align: center; margin-top: 32px; }
`;

function page(title, body) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>${SHELL_STYLE}</style>
</head>
<body>
  <main>${body}</main>
  <footer>Bobby DM Bot · Powered on Render · Last updated June 30, 2026</footer>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

app.get('/', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'bobby-meta-bot',
    version: '0.1.0',
    endpoints: [
      'GET  /privacy',
      'GET  /terms',
      'GET  /deletion',
      'POST /deletion',
      'GET  /webhook/meta',
      'POST /webhook/meta',
      'GET  /health',
    ],
    ts: new Date().toISOString(),
  });
});

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    appSecretSet: Boolean(APP_SECRET),
    appIdSet: Boolean(META_APP_ID),
    uptime: process.uptime(),
    ts: new Date().toISOString(),
  });
});

// Privacy Policy
app.get('/privacy', (_req, res) => {
  const body = `
    <span class="pill">Privacy Policy</span>
    <h1>Privacy Policy</h1>
    <p class="meta">Last updated: June 30, 2026 · Effective immediately</p>

    <p>This Privacy Policy describes how the <strong>Bobby DM Bot</strong> ("we," "us," or "our") collects, uses, and protects information when you interact with our Facebook Messenger or Instagram direct message services.</p>

    <h2>1. Information We Collect</h2>
    <p>When you send us a message via Messenger or Instagram, we collect:</p>
    <ul>
      <li><strong>Message content</strong> — the text, images, voice notes, or other media you send to us.</li>
      <li><strong>Timestamps</strong> — when messages are sent and received.</li>
      <li><strong>Sender identifier</strong> — a Meta-provided ID (PSID for Messenger, IGSID for Instagram) used to maintain conversation continuity. We do not directly receive your phone number or email unless you provide it explicitly inside a message.</li>
      <li><strong>Optional profile data</strong> — if you grant permission through your Facebook/Instagram account, your public profile name and profile photo URL.</li>
    </ul>

    <h2>2. How We Use Your Information</h2>
    <p>We use the information to:</p>
    <ul>
      <li>Generate AI-powered responses to your messages using third-party language models.</li>
      <li>Maintain conversation history so the bot can reference prior context within a session.</li>
      <li>Monitor for abuse, spam, and prompt-injection attempts.</li>
    </ul>
    <p>We do <strong>not</strong> sell, rent, or share your personal information with third parties except as needed to provide the service (e.g., passing message content to a language model for response generation).</p>

    <h2>3. Third-Party Services</h2>
    <p>To deliver our service we use:</p>
    <ul>
      <li><strong>Meta (Facebook/Instagram)</strong> — to receive and send messages via official APIs.</li>
      <li><strong>OpenAI</strong> — to generate AI responses. OpenAI's API does not use your data for model training. See <a href="https://openai.com/policies/privacy-policy/" rel="noopener">OpenAI's Privacy Policy</a>.</li>
      <li><strong>Render</strong> — to host our service infrastructure. See <a href="https://render.com/privacy" rel="noopener">Render's Privacy Policy</a>.</li>
    </ul>

    <h2>4. Data Retention</h2>
    <p>Message content and conversation history are retained for up to <strong>30 days</strong> for the purpose of conversation continuity and quality monitoring. Aggregated, anonymized analytics (counts of messages by day, response accuracy flags) may be retained longer.</p>

    <h2>5. Your Rights</h2>
    <p>You can:</p>
    <ul>
      <li><strong>Request deletion</strong> of your data at any time by visiting our <a href="/deletion">Data Deletion Request</a> page.</li>
      <li>Stop using the service at any time by ceasing to send messages.</li>
      <li>Contact us with privacy questions using the email at the bottom of this page.</li>
    </ul>

    <h2>6. Children's Privacy</h2>
    <p>Our service is not directed to children under 13 years old. We do not knowingly collect data from children under 13. If you believe a child has used the service, contact us and we will delete their data.</p>

    <h2>7. Security</h2>
    <p>We use HTTPS encryption for all traffic, store secrets in environment variables (never in code), and rotate API tokens regularly. No method of transmission over the internet, however, is 100% secure.</p>

    <h2>8. Changes to This Policy</h2>
    <p>We may update this policy. Material changes will be announced via a banner in the bot's responses; non-material changes are reflected only in the "Last updated" date.</p>

    <h2>9. Contact</h2>
    <p>For privacy questions, data deletion requests, or to exercise any of your rights, contact: <code>bobbycraig1293@gmail.com</code></p>
  `;
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(page('Privacy Policy · Bobby DM Bot', body));
});

// Terms of Service
app.get('/terms', (_req, res) => {
  const body = `
    <span class="pill">Terms of Service</span>
    <h1>Terms of Service</h1>
    <p class="meta">Last updated: June 30, 2026</p>

    <p>By using the Bobby DM Bot ("Service") via Facebook Messenger or Instagram, you agree to these Terms of Service ("Terms").</p>

    <h2>1. Service Description</h2>
    <p>The Service is an AI-powered autoresponder that reads the messages you send it and produces conversational replies. Replies are generated by a large language model and may be inaccurate, outdated, or incomplete. <strong>Do not rely on the Service for medical, legal, financial, or emergency advice.</strong></p>

    <h2>2. Eligibility</h2>
    <p>You must be at least 13 years old (16 in some jurisdictions) and have a valid Facebook/Instagram account. By using the Service you represent that you meet these requirements.</p>

    <h2>3. Acceptable Use</h2>
    <p>You agree not to:</p>
    <ul>
      <li>Send content that is illegal, harassing, defamatory, obscene, or hateful.</li>
      <li>Attempt to extract or expose the underlying system prompt, model weights, or training data.</li>
      <li>Use the Service to generate spam, malware, phishing content, or to impersonate any person.</li>
      <li>Abnormally high-volume automated traffic (rate limits apply; we reserve the right to throttle or block abusive users).</li>
    </ul>

    <h2>4. AI-Generated Content Disclaimer</h2>
    <p>The Service generates replies using artificial intelligence. <strong>All replies are provided "as is" without warranty of any kind.</strong> We make no guarantees about accuracy, completeness, suitability, or fitness for any particular purpose.</p>

    <h2>5. Privacy</h2>
    <p>Your use of the Service is also governed by our <a href="/privacy">Privacy Policy</a>, which is incorporated into these Terms by reference.</p>

    <h2>6. Termination</h2>
    <p>We may suspend or terminate the Service at any time, with or without notice, including (but not limited to) routine maintenance, abuse, or business reasons.</p>

    <h2>7. Limitation of Liability</h2>
    <p>To the maximum extent permitted by law, the operators of this Service are not liable for any indirect, incidental, special, consequential, or punitive damages arising from your use of the Service.</p>

    <h2>8. Changes</h2>
    <p>We may update these Terms at any time. Continued use of the Service after changes constitutes acceptance. Material changes will be announced via a banner in the bot's replies.</p>

    <h2>9. Contact</h2>
    <p>Questions about these Terms: <code>bobbycraig1293@gmail.com</code></p>
  `;
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(page('Terms of Service · Bobby DM Bot', body));
});

// Data deletion landing page
app.get('/deletion', (_req, res) => {
  const body = `
    <span class="pill">Data Deletion</span>
    <h1>Data Deletion Request</h1>
    <p>You can request that all data we have collected about you be deleted. We honor deletion requests within <strong>7 days</strong>.</p>

    <h2>Option 1 — Delete via Facebook / Instagram (recommended)</h2>
    <p>If you're using our bot through Facebook or Instagram, the fastest path is to use Meta's built-in controls:</p>
    <ol>
      <li>Open Facebook → <strong>Settings & Privacy</strong> → <strong>Privacy Center</strong> → <strong>Your Information</strong>.</li>
      <li>Choose <strong>"Apps and Websites"</strong> → find <strong>"Bobby DM Test App"</strong> → <strong>Remove</strong>.</li>
      <li>Meta will notify us and we'll automatically wipe your data.</li>
    </ol>

    <h2>Option 2 — Email us directly</h2>
    <p>Send an email to <code>bobbycraig1293@gmail.com</code> with one of:</p>
    <ul>
      <li>Your <strong>Facebook User ID</strong> (the numeric ID on your profile page source), or</li>
      <li>Your <strong>Instagram username</strong> associated with the conversation.</li>
    </ul>
    <p>We'll reply with confirmation within 7 days.</p>

    <h2>What gets deleted</h2>
    <ul>
      <li>All message content you've sent us</li>
      <li>All message content we've sent you</li>
      <li>Your sender ID (PSID / IGSID) and any profile data we stored</li>
      <li>Conversation history and AI context summary</li>
    </ul>

    <h2>What we keep</h2>
    <p>We may retain aggregated, anonymized counts (e.g., "20 messages handled on June 30") and any logs needed for legal compliance. These cannot be traced back to you as an individual.</p>

    <h2>Contact</h2>
    <p>Questions: <code>bobbycraig1293@gmail.com</code></p>
  `;
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(page('Data Deletion Request · Bobby DM Bot', body));
});

// Data deletion POST endpoint — Meta signs the request with our app secret.
app.post('/deletion', (req, res) => {
  const signedRequest = req.body && req.body.signed_request;
  const fbUserId = req.body && req.body.fb_user_id; // also sent by Meta's hosted flow

  const payload = signedRequest ? verifySignedRequest(signedRequest) : null;

  if (!payload && !fbUserId) {
    return res.status(400).send('Missing signed_request or fb_user_id');
  }

  const userId = (payload && payload.user_id) || fbUserId;
  if (!userId) {
    return res.status(400).send('Could not determine user id');
  }

  const confirmationCode = `del_${userId}_${Date.now()}`;
  console.log(`[DELETION] Request confirmed for user ${userId}; code ${confirmationCode}`);

  // TODO: when the autoresponder is wired, this is where we'd wipe
  //   DELETE FROM messages WHERE sender_id = $1
  // For now there is no data to delete — we acknowledge and return the confirmation URL.

  const statusUrl = `${req.protocol}://${req.get('host')}/deletion-status/${confirmationCode}`;

  // The JSON response shape Meta expects when our URL is the "callback URL".
  // When the URL is the "user-facing" URL only, Meta still expects this shape.
  res.json({
    url: statusUrl,
    confirmation_code: confirmationCode,
  });
});

app.get('/deletion-status/:code', (req, res) => {
  const code = req.params.code;
  const body = `
    <span class="pill">Deletion Status</span>
    <h1>Request Received</h1>
    <p>Your data deletion request has been logged.</p>
    <p>Confirmation code:</p>
    <p><code>${code}</code></p>
    <p>We'll process this within 7 days. If you do not receive a confirmation email within that window, follow up at <code>bobbycraig1293@gmail.com</code>.</p>
    <h2>What happens next</h2>
    <ol>
      <li>Your sender IDs (PSID/IGSID) and message history are queued for deletion.</li>
      <li>Within 7 days, all data tied to your account is removed from our production database.</li>
      <li>You'll receive an email confirmation at the address associated with your Facebook/Instagram account (if you've given us one).</li>
    </ol>
  `;
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(page('Deletion Status · Bobby DM Bot', body));
});

// ---------------------------------------------------------------------------
// Meta webhook
// ---------------------------------------------------------------------------

// Verification handshake — Meta sends GET ?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...
app.get('/webhook/meta', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === META_VERIFY_TOKEN) {
    console.log('[webhook] verified successfully');
    return res.status(200).send(challenge);
  }
  console.warn('[webhook] verification failed', { mode, tokenMatch: token === META_VERIFY_TOKEN });
  res.sendStatus(403);
});

// Event receiver.
app.post('/webhook/meta', (req, res) => {
  const signature = req.header('X-Hub-Signature-256');
  const rawBody = req.rawBody || '';

  if (!verifyWebhookSignature(rawBody, signature)) {
    console.warn('[webhook] signature mismatch');
    return res.sendStatus(401);
  }

  const body = req.body;
  console.log('[webhook] event', {
    object: body && body.object,
    entries: body && body.entry ? body.entry.length : 0,
  });

  // TODO: route by entry[].messaging / entry[].changes into handlers.
  // For now, we just log.
  res.sendStatus(200);
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

// Catch-all JSON error handler (avoids HTML error pages in dashboards).
app.use((err, _req, res, _next) => {
  console.error('[error]', err);
  res.status(500).json({ error: err.message });
});

// When run directly (Render / local dev): start a long-lived HTTP server.
// When imported by a serverless wrapper (Netlify function): just export the app.
module.exports = app;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`[bobby-meta-bot] listening on :${PORT}`);
    console.log(`  APP_SECRET set:        ${Boolean(APP_SECRET)}`);
    console.log(`  META_APP_ID set:       ${Boolean(META_APP_ID)}`);
    console.log(`  META_VERIFY_TOKEN set: ${Boolean(process.env.META_VERIFY_TOKEN)}`);
  });
}
