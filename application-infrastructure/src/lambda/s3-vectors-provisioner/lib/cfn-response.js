'use strict';

/**
 * Minimal CloudFormation custom-resource response helper.
 *
 * CloudFormation waits for the custom resource to signal completion by sending a signed
 * JSON document to the pre-signed S3 `ResponseURL` in the event. This module implements
 * that callback with Node's built-in `https` + `url` only — no `cfn-response` npm package
 * and no AWS SDK — keeping the function dependency-light.
 *
 * Security:
 *   - `event.ResponseURL` is a pre-signed S3 URL containing a signature; it is treated as
 *     sensitive and is NEVER logged (only the host + status are logged). // >!
 *   - The URL scheme is validated to be `https:` before any request. // >!
 *   - The response `Reason`/`Data` are expected to be pre-sanitized by the caller. // >!
 *
 * @module lib/cfn-response
 */

const https = require('https');

const { RESPONSE_STATUS } = require('./provisioner-helpers');

/**
 * Build the CloudFormation custom-resource response document.
 *
 * @param {Object} event - The custom resource event.
 * @param {Object} context - The Lambda context (used for a fallback physical id).
 * @param {Object} details - Response details.
 * @param {string} details.status - `'SUCCESS'` or `'FAILED'`.
 * @param {string} [details.reason] - Human-readable reason (shown in the console on failure).
 * @param {string} [details.physicalResourceId] - Physical resource id; falls back to the log stream name.
 * @param {Object} [details.data] - Name/value pairs returned as `Fn::GetAtt`-able outputs.
 * @param {boolean} [details.noEcho=false] - Whether to mask the returned data.
 * @returns {Object} The response document to send to CloudFormation.
 * @example
 * buildResponseBody(event, context, { status: 'SUCCESS', physicalResourceId: 'b/i', data: { VectorBucketName: 'b' } });
 */
function buildResponseBody(event, context, details) {
  const evt = event || {};
  const ctx = context || {};
  const info = details || {};
  return {
    Status: info.status === RESPONSE_STATUS.SUCCESS ? RESPONSE_STATUS.SUCCESS : RESPONSE_STATUS.FAILED,
    Reason: info.reason || `See CloudWatch log stream: ${ctx.logStreamName || 'unknown'}`,
    PhysicalResourceId: info.physicalResourceId || ctx.logStreamName || evt.RequestId || 'unknown',
    StackId: evt.StackId,
    RequestId: evt.RequestId,
    LogicalResourceId: evt.LogicalResourceId,
    NoEcho: info.noEcho === true,
    Data: (info.data && typeof info.data === 'object') ? info.data : {}
  };
}

/**
 * Send the custom-resource response to CloudFormation's pre-signed `ResponseURL`.
 *
 * @async
 * @param {Object} event - The custom resource event (must include `ResponseURL`).
 * @param {Object} context - The Lambda context.
 * @param {Object} details - Response details (see {@link buildResponseBody}).
 * @param {Object} [options] - Optional overrides.
 * @param {Object} [options.httpsClient=https] - Injected `https`-like client (test seam).
 * @returns {Promise<{statusCode: number}>} Resolves with the S3 PUT status code.
 * @throws {Error} When `ResponseURL` is missing/not https, or the PUT request errors.
 * @example
 * await sendResponse(event, context, { status: 'SUCCESS', physicalResourceId: 'b/i' });
 */
function sendResponse(event, context, details, options = {}) {
  const httpsClient = options.httpsClient || https;
  const responseUrl = event && event.ResponseURL;

  return new Promise((resolve, reject) => {
    // >! Validate the callback URL is a well-formed https URL before sending; never log it.
    let parsedUrl;
    try {
      parsedUrl = new URL(responseUrl);
    } catch {
      reject(new Error('Custom resource event is missing a valid ResponseURL.'));
      return;
    }
    if (parsedUrl.protocol !== 'https:') {
      reject(new Error('ResponseURL must use the https protocol.'));
      return;
    }

    const responseBody = JSON.stringify(buildResponseBody(event, context, details));

    const requestOptions = {
      hostname: parsedUrl.hostname,
      port: 443,
      path: `${parsedUrl.pathname}${parsedUrl.search}`,
      method: 'PUT',
      headers: {
        // CloudFormation requires an empty content-type for the pre-signed PUT.
        'content-type': '',
        'content-length': Buffer.byteLength(responseBody)
      }
    };

    // Log status + host only (never the signed URL or body). // >!
    console.log(JSON.stringify({
      level: 'INFO',
      event: 'cfn-response.send',
      status: details && details.status,
      host: parsedUrl.hostname,
      logicalResourceId: event && event.LogicalResourceId
    }));

    const request = httpsClient.request(requestOptions, (response) => {
      // Drain the response so the socket can be reused/closed.
      response.on('data', () => {});
      response.on('end', () => resolve({ statusCode: response.statusCode }));
    });

    request.on('error', (error) => {
      reject(error);
    });

    request.write(responseBody);
    request.end();
  });
}

module.exports = {
  buildResponseBody,
  sendResponse
};
