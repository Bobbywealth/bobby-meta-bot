'use strict';

/**
 * Netlify Function entry point.
 *
 * Wraps the Express app from index.js using serverless-http so that every
 * existing route (/privacy, /terms, /deletion, /webhook/meta, …) becomes a
 * serverless function call. The wrapped request includes the original URL
 * (e.g. /privacy), so Express routes match normally.
 *
 * Deployed at: /.netlify/functions/api — netlify.toml rewrites /* → here.
 */

const serverless = require('serverless-http');
const app = require('../../index');

const handler = serverless(app);

module.exports.handler = async (event, context) => {
  // serverless-http exposes the original event via req.apiGateway.event after
  // invocation. Capture the raw body bytes here and stash them on a per-request
  // context object so our middleware in index.js can pull them in.
  let rawBody = '';
  if (event && typeof event.body === 'string') {
    rawBody = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString('utf8')
      : event.body;
  }
  // Attach to context so the express middleware below can read it.
  context = context || {};
  context._rawBody = rawBody;

  const result = await handler(event, context);
  return result;
};
