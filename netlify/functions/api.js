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

module.exports.handler = serverless(app);
