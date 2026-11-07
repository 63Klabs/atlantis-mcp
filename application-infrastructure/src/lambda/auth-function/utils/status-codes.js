/**
 * HTTP statuses the Auth function chooses for conditions that API Gateway or CloudFront
 * would otherwise turn into the site's landing page.
 *
 * >! CloudFront rewrites every origin response with status 403 or 404 to /index.html with
 * >! status 200, so "not found" cannot be a 404 here. A JSON client would parse HTML.
 *
 * @module utils/status-codes
 */
'use strict';

/** Valid token, but no Users record for the account. */
const USER_NOT_FOUND_STATUS = 422;

/** A request that matches none of the Auth function's routes. */
const UNKNOWN_ROUTE_STATUS = 400;

module.exports = { USER_NOT_FOUND_STATUS, UNKNOWN_ROUTE_STATUS };
