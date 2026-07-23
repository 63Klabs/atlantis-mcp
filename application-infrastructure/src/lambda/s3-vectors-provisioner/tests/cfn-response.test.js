'use strict';

const { buildResponseBody, sendResponse } = require('../lib/cfn-response');
const { RESPONSE_STATUS } = require('../lib/provisioner-helpers');

const baseEvent = {
  ResponseURL: 'https://cloudformation-custom-resource.s3.amazonaws.com/abc?signature=redacted',
  StackId: 'arn:aws:cloudformation:us-east-1:123456789012:stack/test/abc',
  RequestId: 'req-1',
  LogicalResourceId: 'DocAiVectorIndex'
};
const baseContext = { logStreamName: 'log-stream-1' };

/**
 * Build a fake `https`-like client that captures the request and simulates either a
 * successful S3 PUT or a transport error.
 */
function makeFakeHttps({ failRequest = false } = {}) {
  const calls = [];
  const httpsClient = {
    request(options, callback) {
      const call = { options, body: null };
      calls.push(call);
      const req = {
        errorHandler: null,
        on(eventName, cb) {
          if (eventName === 'error') {
            this.errorHandler = cb;
          }
          return this;
        },
        write(body) {
          call.body = body;
        },
        end() {
          if (failRequest) {
            process.nextTick(() => this.errorHandler && this.errorHandler(new Error('network down')));
            return;
          }
          process.nextTick(() => {
            const handlers = {};
            const res = {
              statusCode: 200,
              on(eventName, cb) {
                handlers[eventName] = cb;
                return this;
              }
            };
            callback(res);
            if (handlers.data) {
              handlers.data(Buffer.from(''));
            }
            if (handlers.end) {
              handlers.end();
            }
          });
        }
      };
      return req;
    }
  };
  return { httpsClient, calls };
}

describe('cfn-response: buildResponseBody', () => {
  it('builds a SUCCESS body with data and the given physical id', () => {
    const body = buildResponseBody(baseEvent, baseContext, {
      status: RESPONSE_STATUS.SUCCESS,
      physicalResourceId: 'bucket/index',
      data: { VectorBucketName: 'bucket', IndexName: 'index' }
    });
    expect(body.Status).toBe('SUCCESS');
    expect(body.PhysicalResourceId).toBe('bucket/index');
    expect(body.StackId).toBe(baseEvent.StackId);
    expect(body.RequestId).toBe(baseEvent.RequestId);
    expect(body.LogicalResourceId).toBe(baseEvent.LogicalResourceId);
    expect(body.NoEcho).toBe(false);
    expect(body.Data).toEqual({ VectorBucketName: 'bucket', IndexName: 'index' });
  });

  it('coerces any non-SUCCESS status to FAILED and falls back to the log stream name', () => {
    const body = buildResponseBody(baseEvent, baseContext, { status: 'weird' });
    expect(body.Status).toBe('FAILED');
    expect(body.PhysicalResourceId).toBe('log-stream-1');
    expect(body.Data).toEqual({});
  });
});

describe('cfn-response: sendResponse', () => {
  it('PUTs the response body to the pre-signed URL and resolves with the status code', async () => {
    const { httpsClient, calls } = makeFakeHttps();
    const result = await sendResponse(
      baseEvent,
      baseContext,
      { status: RESPONSE_STATUS.SUCCESS, physicalResourceId: 'bucket/index', data: { IndexName: 'index' } },
      { httpsClient }
    );

    expect(result.statusCode).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].options.method).toBe('PUT');
    expect(calls[0].options.hostname).toBe('cloudformation-custom-resource.s3.amazonaws.com');
    // Content-length header must match the serialized body length.
    const parsed = JSON.parse(calls[0].body);
    expect(parsed.Status).toBe('SUCCESS');
    expect(calls[0].options.headers['content-length']).toBe(Buffer.byteLength(calls[0].body));
    expect(calls[0].options.headers['content-type']).toBe('');
  });

  it('rejects when ResponseURL is missing', async () => {
    const { httpsClient } = makeFakeHttps();
    await expect(sendResponse({}, baseContext, { status: 'SUCCESS' }, { httpsClient }))
      .rejects.toThrow(/ResponseURL/);
  });

  it('rejects when ResponseURL is not https', async () => {
    const { httpsClient } = makeFakeHttps();
    const event = { ...baseEvent, ResponseURL: 'http://insecure.example.com/callback' };
    await expect(sendResponse(event, baseContext, { status: 'SUCCESS' }, { httpsClient }))
      .rejects.toThrow(/https/);
  });

  it('rejects when the underlying request errors', async () => {
    const { httpsClient } = makeFakeHttps({ failRequest: true });
    await expect(sendResponse(baseEvent, baseContext, { status: 'FAILED', reason: 'boom' }, { httpsClient }))
      .rejects.toThrow(/network down/);
  });
});
