import { SpanStatusCode, trace, context, propagation } from '@opentelemetry/api';
import * as Sentry from '@sentry/astro';
import config from 'config/shared';
import { logErrorTimes, logTimes } from './logger';
import { getCache, setCache } from './cache';
import { encodeHeaders } from 'utils/encoding';
import { abortControllerPool } from './abortControllerPool';
import { ApiError } from 'utils/apiError';
import { enforceHttpsProtocol } from 'utils/enforceHttpsProtocol';
import { outgoingMetrics } from 'middleware/metrics';
import { isSSR } from 'utils/isSSR';
import { normalizeToCamelCase } from './normalize';
import { isPlainObject, isArray, isFunction, isObject } from 'es-toolkit/compat';
import type { MockConfig } from 'utils/mockapi/types';
import { findActiveMockResponse } from 'utils/mockapi/utility';
import { applyMappedResponseObject } from 'utils/mockapi/mapping/applyMappedResponseObject';
import { isLabMode } from 'utils/labMode';

const CACHE_TTL = 1000 * 60 * 15;

const tracer = trace.getTracer('requestHandler');

const methods = {
	DELETE: async (url: string, input?: Record<string, string>, requestInit: RequestInit = {}) =>
		fetch(url, {
			method: 'DELETE',
			body: input instanceof FormData ? input : JSON.stringify(input),
			...requestInit,
		}),
	GET: async (url: string, input?: Record<string, string>, requestInit: RequestInit = {}) =>
		fetch(input && Object.keys(input).length ? `${url}?${new URLSearchParams(input).toString()}` : url, {
			...requestInit,
		}),
	PATCH: async (url: string, input?: Record<string, any>, requestInit: RequestInit = {}) =>
		fetch(url, {
			method: 'PATCH',
			body: input instanceof FormData ? input : JSON.stringify(input),
			...requestInit,
		}),
	POST: async (url: string, input?: Record<string, any>, requestInit: RequestInit = {}) =>
		fetch(url, {
			method: 'POST',
			body: input instanceof FormData ? input : JSON.stringify(input),
			...requestInit,
		}),
	PUT: async (url: string, input?: Record<string, any>, requestInit: RequestInit = {}) =>
		fetch(url, {
			method: 'PUT',
			body: input instanceof FormData ? input : JSON.stringify(input),
			...requestInit,
		}),
} as const;

const REQUEST_TIMEOUT = 7_000;

export type Pagination = {
	total: number;
	totalWithUnpacked?: number;
	limit: number;
	offset: number;
};

export type ApiPath = '/api/v1' | '/api/v2' | '/mkp/api/v1' | '/api/web' | '/api/prx';
export type ApiMethods = keyof typeof methods;

type CreateAPIMethod = <TInput extends object | undefined = object, TOutput = Response>(
	opts: {
		apiPath?: ApiPath;
		method: ApiMethods;
		headers?: HeadersInit | undefined;
		normalize?: (
			response: {
				categories?: any;
				results?: any;
				result?: any;
				pagination?: any;
				leaf_categories?: any;
			},
			isLabMode?: boolean,
		) => TOutput;
		skipResponseParsing?: boolean;
		suppressErrorThrowing?: boolean;
		requestTimeout?: number;
		requestId?: ReturnType<typeof crypto.randomUUID>;
		abortController?: AbortController;
		useCache?: boolean;
		cacheKeyPostfix?: string;
		cacheTtl?: number;
		resetCache?: boolean;
		mockConfig?: MockConfig;
	} & (
		| {
				url: string;
				path?: string;
		  }
		| {
				url?: string;
				path: string;
		  }
	),
) => (input?: TInput) => Promise<TOutput>;

const getHeaderValue = (headers: Headers, keys: string[]): string | undefined => {
	for (const k of keys) {
		const v = headers.get(k);
		if (v) return v;
	}
	return undefined;
};

const getCorrelationId = (headers: Headers): string | undefined => {
	return getHeaderValue(headers, ['x-correlation-id', 'x-request-id']);
};

const getTraceId = (headers: Headers): string | undefined => {
	return getHeaderValue(headers, ['x-trace-id', 'x-trace_id', 'trace-id', 'trace_id']);
};

export async function performRequestOrReturnMock(
	method: ApiMethods,
	url: string,
	input: any,
	requestInit: RequestInit,
	mockConfig?: MockConfig,
): Promise<Response> {
	const mock = findActiveMockResponse({
		method,
		url,
		mockConfig,
	});

	if (mock) {
		let data = mock.data;
		const responseOverride =
			(mock.map?.fromMapped && mock.shortId && mockConfig?.mockOverrides?.[mock.shortId]) || undefined;

		if (responseOverride) data = applyMappedResponseObject(data, responseOverride, mock.map!.fromMapped);

		const body = JSON.stringify(data);
		const mockResponse = new Response(body, {
			status: mock.code,
			headers: { 'Content-Type': 'application/json' },
		});
		if (mock.delay) {
			return new Promise((resolve) => setTimeout(resolve, mock.delay)).then(() => mockResponse);
		}
		return mockResponse;
	}

	return methods[method](url, input, requestInit);
}

export const createAPIMethod: CreateAPIMethod = (args) => (input) => {
	const {
		apiPath = '/api/v1',
		method,
		url,
		path,
		headers,
		normalize = (response) =>
			'results' in response || 'result' in response
				? normalizeToCamelCase(response.results || response.result)
				: normalizeToCamelCase(response),
		skipResponseParsing,
		suppressErrorThrowing,
		requestTimeout = REQUEST_TIMEOUT,
		requestId = crypto.randomUUID(),
		abortController = abortControllerPool.getController(requestId),
		cacheKeyPostfix,
		cacheTtl = CACHE_TTL,
		resetCache = false,
		mockConfig,
	} = args;
	const _isLabMode = isSSR() ? !!mockConfig : isLabMode();
	const useCache = (args.useCache && !_isLabMode) ?? false;

	return tracer.startActiveSpan('request', (span) => {
		// Get it either from mockConfig (SSR from middleware) or from signal on the client
		const timeFrom = globalThis.performance.now();
		const requestHeaders = prepareHeaders(headers, requestId, useCache);
		const fetchUrl = prepareUrl(apiPath, path, url);
		const headersInstance = new Headers(requestHeaders);

		const requestUID = {
			correlationId: getCorrelationId(headersInstance) ?? '',
			traceId: getTraceId(headersInstance) ?? '',
			requestId,
			timeFrom,
		};

		logTimes(requestUID, { uri: path || fetchUrl, input, response_status: 100 });

		const inputStr = serializeInputForSpan(input);
		span.setAttributes({
			fetchUrl,
			method,
			...(inputStr && { input: inputStr }),
			'span.kind': 'internal',
		});
		const cachedUrlKey = useCache ? buildCachedUrlKey(fetchUrl, method, input, cacheKeyPostfix) : null;
		const mock = findActiveMockResponse({
			method,
			url: fetchUrl,
			mockConfig,
		});
		if (isSSR() && cachedUrlKey && !resetCache && !mock) {
			const cached = getCache<any>(cachedUrlKey);

			if (cached) {
				logTimes(requestUID, { cache: 'Fetch:HIT', uri: path || fetchUrl, input, response_status: 200 });
				abortControllerPool.releaseController(requestId);
				span.setAttribute('cache', 'HIT');
				span.end();
				return new Promise((resolve) => resolve(cached));
			}

			span.setAttribute('cache', 'MISS');
			logTimes(requestUID, { cache: 'Fetch:MISS', uri: path || fetchUrl, input, response_status: 204 });
		}

		const timeoutId = setTimeout(() => {
			logTimes(requestUID, { response_status: 408, uri: path || fetchUrl, input });
			span.setAttribute('aborted', true);
			abortControllerPool.abort(requestId);
		}, requestTimeout);
		const requestInit = {
			headers: requestHeaders,
			signal: abortController.signal,
		};

		// Explicitly bind the current span context to ensure UndiciInstrumentation sees it as parent
		// We need to return the promise directly from within the context callback
		const activeContext = trace.setSpan(context.active(), span);

		const promise = context.with(activeContext, async () => {
			// The fetch call MUST happen within this synchronous callback for context propagation
			return await performRequestOrReturnMock(method, fetchUrl, input, requestInit, mockConfig);
		});

		return promise
			.catch((e) => {
				clearTimeout(timeoutId);
				abortControllerPool.releaseController(requestId);

				if (e instanceof Error && e.name === 'AbortError') {
					span.setStatus({ code: SpanStatusCode.OK, message: e.message });
					span.setAttribute('aborted', true);
					span.end();
					throw e;
				}

				if (isSSR()) {
					logErrorTimes(
						requestUID,
						`: Failed to fetch: ${fetchUrl}, with: ${input ? JSON.stringify(input) : 'No request input.'}`,
						e,
					);

					outgoingMetrics.measureOutgoingRequestDuration(
						{
							endpoint: getEndpoint(apiPath, path, url),
							type: 'REST',
							method,
							remote_app: getRemoteApp(fetchUrl) ?? '',
							status_code:
								e instanceof ApiError
									? e.cause.status.toString()
									: e instanceof Error && e.name === 'AbortError'
										? '299'
										: '500',
						},
						globalThis.performance.now() - timeFrom,
					);
				}

				const errorMessage = e instanceof Error ? e.message : String(e);
				span.setStatus({ code: SpanStatusCode.ERROR, message: errorMessage });
				span.end();
				throw e;
			})
			.then((res) => {
				clearTimeout(timeoutId);
				abortControllerPool.releaseController(requestId);
				if (isSSR()) {
					logTimes(requestUID, { response_status: res.status, uri: path || fetchUrl, input });

					outgoingMetrics.measureOutgoingRequestDuration(
						{
							endpoint: getEndpoint(apiPath, path, url),
							type: 'REST',
							method,
							remote_app: getRemoteApp(fetchUrl) ?? '',
							status_code: res.status.toString(),
						},
						globalThis.performance.now() - timeFrom,
					);
				}

				if (res.status >= 400) {
					const traceId = getTraceId(res.headers);
					const correlationId = getCorrelationId(res.headers);

					// Log server errors (5xx) to Sentry
					if (res.status >= 500 && isSSR()) {
						Sentry.captureException(
							new ApiError(`API Server Error: ${res.status} ${res.statusText} for ${fetchUrl}`, {
								cause: res,
								url: res.url,
								input,
								traceId,
								correlationId,
							}),
							{
								tags: {
									path: path || fetchUrl,
									status: res.status.toString(),
									traceId,
									correlationId,
									apiPath,
								},
								contexts: {
									request: {
										url: fetchUrl,
										method,
										data: input,
									},
								},
							},
						);
						span.setStatus({ code: SpanStatusCode.ERROR });
					} else {
						span.setStatus({ code: SpanStatusCode.OK });
					}

					if (!suppressErrorThrowing) {
						span.setStatus({ code: SpanStatusCode.ERROR });
						span.end();

						throw new ApiError(
							`TraceId ${traceId}, CorrelationId ${correlationId} of API Error for ${fetchUrl}, with: ${input ? JSON.stringify(input) : 'No request input.'} \n${res.status} ${res.statusText}\n${JSON.stringify(requestInit)}`,
							{ cause: res, url: res.url, input, traceId, correlationId },
						);
					}
					return res
						.json()
						.then(normalizeToCamelCase)
						.then((data) => {
							span.end();
							return data;
						})
						.catch((e) => {
							logErrorTimes(requestUID, `Failed to parse response: ${fetchUrl}`, e);
							span.recordException(e);
							span.setStatus({
								code: SpanStatusCode.ERROR,
								message: e instanceof Error ? e.message : String(e),
							});
							span.end();
						});
				}

				if (skipResponseParsing) {
					if (isSSR() && cachedUrlKey) {
						setCache(cachedUrlKey, structuredClone(res.clone()), cacheTtl);
					}

					span.setStatus({ code: SpanStatusCode.OK });
					span.end();
					return res;
				}

				return res.json().then((response) => {
					const data = normalize(response, _isLabMode);

					if (isSSR() && cachedUrlKey) {
						setCache(cachedUrlKey, structuredClone(data), cacheTtl);
					}

					span.setStatus({ code: SpanStatusCode.OK });
					span.end();
					return data;
				});
			});
	});
};

export const convertHeadersToObject = (headers: Headers | HeadersInit | undefined): Record<string, string> => {
	const result: Record<string, string> = {};
	if (headers instanceof Headers) {
		headers.forEach((value, key) => {
			result[key] = value;
		});
	} else if (headers) {
		Object.entries(headers).forEach(([key, value]) => {
			result[key] = value;
		});
	} else {
		return {};
	}

	return result;
};

export const addDefaultHeaders = (
	headers: Record<string, string>,
	useCache: boolean,
	requestId: string,
): Record<string, string> => {
	const newHeaders = { ...headers };

	newHeaders['x-service-version'] = config.version;
	newHeaders['x-request-id'] = requestId;

	if (!useCache) {
		newHeaders['cache-control'] = 'no-cache, no-store, must-revalidate';
		newHeaders['pragma'] = 'no-cache';
		newHeaders['expires'] = '0';
	}

	if (!('cookie' in newHeaders)) {
		newHeaders['cookie'] = globalThis?.document?.cookie ?? '';
	}

	if (isSSR()) {
		newHeaders['x-server-side-rendering'] = 'true';
		newHeaders['x-service-name'] = 'sbazar';
		if (!headers) {
			newHeaders['x-forwarded-for'] = '127.0.0.1, ::1';
		}
		if (!headers['referer'] && globalThis?.location?.href) {
			newHeaders['referer'] = enforceHttpsProtocol(globalThis?.location?.href);
		}
	}

	return newHeaders;
};

export const prepareHeaders = (headers: undefined | HeadersInit, requestId: string, useCache: boolean): HeadersInit => {
	let headersObject = convertHeadersToObject(headers);

	headersObject = addDefaultHeaders(headersObject, useCache, requestId);

	// Manually inject OpenTelemetry trace context into headers for propagation
	// This ensures the proxy receives the correct parent span context
	const carrier: Record<string, string> = {};
	propagation.inject(context.active(), carrier);
	Object.assign(headersObject, carrier);

	// Encode headers
	return encodeHeaders(headersObject);
};

const blockerWordsRegex = /items(?!_list)/;
export function denormalizeBlockerWords(path: string) {
	// items_list is for statistic endpoint /items/statistics/items_list, leave it as it is
	return path.replace(blockerWordsRegex, 'adverts');
}

export const prepareUrl = (apiPath: string, path = '', url?: string) => {
	if (url) return url;

	if (isSSR()) {
		return `http://${process.env.CONF_BACKEND || 'localhost:80'}${apiPath}${denormalizeBlockerWords(path)}`;
	}

	return `${globalThis.window.location.origin}${apiPath}${path}`;
};

const obfuscateRegex = /(\w*\d\w+)|(((?:\/))\d((?:\/|$)))/g;
export const getEndpoint = (apiPath: string, path = '', url?: string) => {
	if (url) return url;

	return `${apiPath}${denormalizeBlockerWords(path).replace(obfuscateRegex, '*')}`;
};

export const getRemoteApp = (url: string) => {
	if (url.includes('ribbon')) {
		return process.env.CONF_RIBBON_URL;
	}

	return process.env.CONF_BACKEND;
};

export function buildCachedUrlKey(fetchUrl: string, method: ApiMethods, input: any, cacheKeyPostfix?: string): string {
	const serialized = safeSerializeForCache(input);
	const suffix = method === 'GET' ? (serialized ? `?${serialized}` : '') : serialized ? `|body=${serialized}` : '';
	return `${fetchUrl}${suffix}${cacheKeyPostfix ? `_${cacheKeyPostfix}` : ''}`;
}

const serializeCache = new WeakMap<object, string>();

const MAX_SPAN_ATTRIBUTE_LENGTH = 1000;

/**
 * Safely serializes input for span attributes with truncation to avoid blocking the event loop.
 * Handles FormData and large objects gracefully.
 * @param input - The input to serialize
 * @param maxLength - Maximum length before truncation
 * @returns Serialized string or undefined
 */
export function serializeInputForSpan(
	input: unknown,
	maxLength: number = MAX_SPAN_ATTRIBUTE_LENGTH,
): string | undefined {
	if (!input || input instanceof FormData) return undefined;

	if (typeof input !== 'object') return undefined;

	try {
		const serialized = JSON.stringify(input);
		return serialized.length > maxLength ? serialized.slice(0, maxLength) + '...' : serialized;
	} catch {
		return '[unserializable input]';
	}
}

export function safeSerializeForCache(input: any): string {
	if (input === undefined || input === null) return '';

	try {
		if (typeof input === 'string') return input;

		if (typeof URLSearchParams !== 'undefined' && input instanceof URLSearchParams) {
			return input.toString();
		}

		if (typeof FormData !== 'undefined' && input instanceof FormData) {
			const params = new URLSearchParams();
			for (const [key, value] of input.entries()) {
				params.append(key, JSON.stringify(value));
			}
			return params.toString();
		}

		if (isArray(input)) {
			return JSON.stringify(input);
		}

		if (typeof input === 'object') {
			const cached = serializeCache.get(input as object);
			if (cached !== undefined) return cached;

			// Fast path for plain objects with only primitive values
			if (isPlainObject(input)) {
				const entries = Object.entries(input as Record<string, unknown>);
				if (entries.length === 0) return '';
				let hasComplex = false;
				for (const [, value] of entries) {
					if (isArray(value) || isFunction(value) || (isObject(value) && !isArray(value))) {
						hasComplex = true;
						break;
					}
				}

				if (!hasComplex) {
					const usp = new URLSearchParams();
					for (const [key, value] of entries) {
						if (value === undefined) continue;
						usp.append(key, JSON.stringify(value));
					}
					const out = usp.toString();
					serializeCache.set(input as object, out);
					return out;
				}
			}

			// General path: support arrays and nested objects via URLSearchParams + JSON for nested
			const params = new URLSearchParams();
			for (const [key, value] of Object.entries(input)) {
				if (isArray(value)) {
					for (const item of value) params.append(key, String(item));
				} else if (isObject(value) && !isArray(value)) {
					params.append(key, JSON.stringify(value));
				} else if (value !== undefined) {
					params.append(key, JSON.stringify(value));
				}
			}
			const paramsString = params.toString();
			const out = paramsString || JSON.stringify(input);
			serializeCache.set(input as object, out);
			return out;
		}

		return String(input);
	} catch {
		try {
			return JSON.stringify(input);
		} catch {
			return String(input);
		}
	}
}

