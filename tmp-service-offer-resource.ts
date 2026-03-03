import { createAPIMethod, type Pagination } from 'utils/generic';
import {
	type OfferData,
	type ApiOfferData,
	type ApprovalAdmin,
	type DraftOfferData,
	type DraftApiOfferData,
	type WhereSold,
	normalizeOfferData,
	normalizeDraftOfferData,
} from 'service/offer/model';
import { type FormResponseError } from 'utils/form';
import { normalizeToSnakeCase } from 'utils/normalize';
import type { LocalityData } from 'service/locality/model';
import type { UnpackedOfferData } from 'service/unpacked/model';
import { type PaymentStatus, type PaymentType, SORT_BY_SORT, type TRemoteSort } from 'utils/constants';
import { omit, pick } from 'es-toolkit/object';
import { cacheKeyPostfixByUser } from 'service/user/utils';
import type { MockConfig } from 'utils/mockapi/types';

type GetOfferParam = {
	id: string;
	advert_locality_id?: string;
};

export async function getDraftOffer({ id, ...restParams }: GetOfferParam, headers?: Headers, mockConfig?: MockConfig) {
	// Cache is disabled for signed-in users, because result data includes recommendationData per user
	const userCacheKey = cacheKeyPostfixByUser(headers);

	return createAPIMethod<object, DraftOfferData>({
		path: `/items/${id}`,
		method: 'GET',
		normalize: ({ result }, isLabMode) => normalizeDraftOfferData(result as DraftApiOfferData, isLabMode),
		useCache: !userCacheKey,
		cacheTtl: 60 * 1000,
		headers,
		mockConfig,
	})(restParams);
}

export async function getOffer({ id, ...restParams }: GetOfferParam, headers?: Headers, mockConfig?: MockConfig) {
	// Cache is disabled for signed-in users, because result data includes recommendationData per user
	const userCacheKey = cacheKeyPostfixByUser(headers);

	return createAPIMethod<object, OfferData>({
		path: `/items/${id}`,
		method: 'GET',
		normalize: ({ result }, isLabMode) => normalizeOfferData(result as ApiOfferData, isLabMode),
		useCache: !userCacheKey,
		cacheTtl: 60 * 1000,
		headers,
		mockConfig,
	})(restParams);
}

export async function getEditOffer(id: string | number, headers?: HeadersInit, mockConfig?: MockConfig) {
	return createAPIMethod<object, DraftOfferData>({
		path: `/items/${id}?for_editing=1`,
		method: 'GET',
		normalize: ({ result }, isLabMode) => normalizeDraftOfferData(result as DraftApiOfferData, isLabMode),
		headers,
		mockConfig,
	})();
}

export type GetOffersParams = {
	approval_admin?: ApprovalAdmin;
	category_id?: string;
	hide_price_by_agreement?: 'true' | 'false';
	include_adverts_stats?: 1;
	limit?: string;
	locality?: string;
	offset?: string;
	phrase?: string;
	premise_id?: string;
	price_for_free?: 'true' | 'false';
	price_from?: string;
	price_to?: string;
	radius_precision?: string;
	sort?: TRemoteSort;
	timestamp_to?: string;
	user_id?: string;
	valid_date_from?: string;
	valid_date_to?: string;
};

export type GetOffersResponse = {
	pagination: Pagination;
	results: (OfferData | UnpackedOfferData)[];
};

export type CreateOfferLocalityData = Pick<LocalityData, 'entityId' | 'entityType'>;

export type CreateOfferData = {
	categoryId: number;
	description?: string;
	dontShowPhone: boolean;
	locality: CreateOfferLocalityData;
	otherLocalities?: CreateOfferLocalityData[];
	name: string;
	phone: string;
	price: number;
	priceByAgreement: boolean;
	termsOfUse: boolean;
	buyerProtection?: boolean;
};

export type EditOfferData = Partial<CreateOfferData>;

export async function getOffersSearch(
	params: GetOffersParams,
	headers?: HeadersInit,
	abortController?: AbortController,
	mockConfig?: MockConfig,
) {
	return createAPIMethod<GetOffersParams, GetOffersResponse>({
		path: `/items/search`,
		method: 'GET',
		normalize: ({ results, pagination }, isLabMode) => ({
			pagination,
			results: results.map((offer: ApiOfferData) => normalizeOfferData(offer, isLabMode)),
		}),
		useCache: true,
		headers,
		abortController,
		mockConfig,
	})(params);
}

export type GetRelatedOffersParams = {
	id: string;
	limit?: string;
};

export async function getRelatedOffers(
	params: GetRelatedOffersParams,
	headers?: HeadersInit,
	abortController?: AbortController,
	mockConfig?: MockConfig,
) {
	return createAPIMethod<GetOffersParams, GetOffersResponse>({
		path: `/items/${params.id}/related`,
		method: 'GET',
		normalize: ({ results, pagination }, isLabMode) => ({
			pagination,
			results: results.map((offer: ApiOfferData) => normalizeOfferData(offer, isLabMode)),
		}),
		useCache: true,
		cacheTtl: 60 * 1000,
		headers,
		abortController,
		mockConfig,
	})(omit(params, ['id']));
}

type GetStaticsParams = {
	item_ids: string;
};

type GetStatisticsResponse = {
	[offerId: string]: {
		detailView: number;
	};
};

export async function getOffersStatistics(params: GetStaticsParams, headers?: HeadersInit) {
	return createAPIMethod<GetStaticsParams, GetStatisticsResponse>({
		path: `/adverts/statistics/items_list`,
		method: 'GET',
		headers,
	})(params);
}

export async function getOffers(params: GetOffersParams, headers?: HeadersInit, mockConfig?: MockConfig) {
	return createAPIMethod<GetOffersParams, GetOffersResponse>({
		path: `/items`,
		method: 'GET',
		normalize: ({ results, pagination }, isLabMode) => ({
			pagination,
			results: results.map((offer: ApiOfferData) => normalizeOfferData(offer, isLabMode)),
		}),
		useCache: 'timestamp_to' in params,
		cacheTtl: 60 * 1000,
		headers,
		mockConfig,
	})(params);
}

export async function draftOffer(headers?: HeadersInit) {
	return await createAPIMethod({
		path: '/items/draft',
		method: 'POST',
		skipResponseParsing: true,
		headers,
	})({}).then((response) => response.json().then((data: { id: number }) => data.id));
}

type GetCreatePageResponse = {
	sections: Array<{
		title: string;
		description: string;
		elements: Array<{
			dependsOn?: string[];
			extraData?: {
				source: string;
			};
			isCodeBook: boolean;
			required: boolean;
			name: string;
			placeholder: string;
			text: string;
			options: [];
			tooltip?: Array<{
				text: string;
				type: string;
			}>;
			validation: {
				maxLimit: number;
				minLimit: number;
			};
			widget: string;
			unit?: string;
			value?: string | LocalityData;
		}>;
	}>;
};

export async function getCreatePage(headers?: HeadersInit) {
	return createAPIMethod<object, GetCreatePageResponse>({
		path: '/items/create_page',
		method: 'GET',
		headers,
	})({});
}

export async function saveOffer(id: number, data: CreateOfferData, headers?: HeadersInit) {
	return createAPIMethod({
		path: `/items/${id}`,
		method: 'PUT',
		skipResponseParsing: true,
		headers,
	})(normalizeToSnakeCase({ ...data, locality: pick(data.locality, ['entityId', 'entityType']) }));
}

export async function patchOffer(id: number, data: Partial<ApiOfferData> | EditOfferData, headers?: HeadersInit) {
	return createAPIMethod({
		path: `/items/${id}`,
		method: 'PATCH',
		skipResponseParsing: true,
		headers,
	})(normalizeToSnakeCase(data));
}

export async function saveImageOrder(id: number, order: number[], headers?: HeadersInit) {
	const newHeaders = new Headers(headers);
	newHeaders.set('Accept', 'application/json');
	newHeaders.set('Content-Type', 'application/json');

	return createAPIMethod({
		path: `/items/${id}/images`,
		method: 'POST',
		skipResponseParsing: true,
		headers: newHeaders,
	})({ order });
}

export async function getFavoriteOffers(
	params: GetOffersParams,
	headers?: HeadersInit,
	abortController?: AbortController,
	mockConfig?: MockConfig,
) {
	return createAPIMethod<GetOffersParams, GetOffersResponse>({
		path: '/items/favorites',
		method: 'GET',
		normalize: ({ results, pagination }, isLabMode) => ({
			pagination,
			results: results.map((offer: ApiOfferData) => normalizeOfferData(offer, isLabMode)),
		}),
		headers,
		useCache: 'timestamp_to' in params,
		abortController,
		mockConfig,
	})(params);
}

export function setReserved(id: number, isCurrentlyReserved: boolean) {
	return patchOffer(id, { is_reserved: isCurrentlyReserved });
}

export function setIsActive(offers: OfferData[], isActive: boolean, sold: WhereSold = 'not_specified') {
	const ids = offers.map((offer) => offer.id);

	return updateOfferStatus({ ids, status_active: isActive, sold });
}

// const INTERWEAVE_INDICES = new Set([2, 6, 7, 12, 13, 18, 24, 25, 27, 28, 29]);

export function canIncludeUnpackedOffers(filters: GetOffersParams) {
	return filters.sort === SORT_BY_SORT.NEWEST || filters.sort === undefined;
}

export type GetMixedOffersSearchResponse = {
	results: (UnpackedOfferData | OfferData)[];
	response?: GetOffersResponse;
	pagination: Pagination;
	watchdogId?: string; // to deduplicate multiple requests with same watchdog_id for backend API
};

export type ReportOfferParams = {
	report_message: string;
	report_reason: string;
	user_email: string;
	captcha_text?: string;
	captcha_hash?: string;
};

export type ReportOffersResponse = {
	id: number;
	status_code: number;
	status_message: string;
	errors?: FormResponseError[];
};

export async function reportOffer(id: string | number, params: ReportOfferParams, headers?: HeadersInit) {
	return createAPIMethod<ReportOfferParams, ReportOffersResponse>({
		path: `/items/${String(id)}/reports`,
		method: 'POST',
		skipResponseParsing: true,
		headers,
	})(params);
}

export type ReplyToOfferParams = {
	message: string;
	user_email?: string;
	captcha_text?: string;
	captcha_hash?: string;
	tos_accepted?: boolean;
};

export type ReplyToOfferResponse = {
	id: number;
	messengerRoomId?: string;
	statusCode: number;
	statusMessage: string;
	errors?: FormResponseError[];
};

export async function replyToOffer(id: string | number, params: ReplyToOfferParams, headers?: HeadersInit) {
	return createAPIMethod<ReplyToOfferParams, ReplyToOfferResponse>({
		path: `/items/${String(id)}/replies`,
		method: 'POST',
		headers,
	})(params);
}

export async function deleteOffer(id: string | number, headers?: HeadersInit) {
	return createAPIMethod({
		path: `/items/${String(id)}`,
		method: 'DELETE',
		skipResponseParsing: true,
		headers,
	})();
}

export async function updateOfferStatus(
	data: { ids: number[]; status_active?: boolean; status_deleted?: boolean; sold?: string },
	headers?: HeadersInit,
) {
	return createAPIMethod({
		path: '/items/status',
		method: 'POST',
		skipResponseParsing: true,
		headers,
	})(data);
}

export type GetPhoneParams = {
	captcha_text?: string;
	captcha_hash?: string;
};

export type GetPhoneResponse = {
	result: {
		phone: string;
	};
	status_code: number;
	status_message: string;
	errors?: FormResponseError[];
};

export function getPhone(id: string | number, params: GetPhoneParams, headers?: HeadersInit) {
	const newHeaders = new Headers(headers);
	newHeaders.set('Accept', 'application/json');
	newHeaders.set('Content-Type', 'application/json');

	return createAPIMethod<object, GetPhoneResponse>({
		path: `/items/${id}/phone`,
		method: 'POST',
		headers: newHeaders,
		normalize: (result: any) => result,
	})(params);
}

export type UpdateOffersStatusParams = {
	ids: number[];
	status_active?: boolean; // aktivni/neaktivni inzerat
	status_deleted?: boolean; // smazany inzerat
	sold?: string; // duvod prodeje
};

export type UpdateStatusSummary = {
	advert_id: number;
	current_status: string;
	errors?: string[];
	operation_ok: boolean;
};

export type UpdateOffersStatusResponse = {
	status_code: number;
	status_message: string;
	summary?: UpdateStatusSummary[];
};

export function updateAdvertsStatus(params: UpdateOffersStatusParams, headers?: HeadersInit) {
	return createAPIMethod<UpdateOffersStatusParams, UpdateOffersStatusResponse>({
		path: '/items/status',
		method: 'POST',
		normalize: (result: any) => result,
		headers,
	})(params);
}

export type PayOfferToppingParams =
	| {
			offerId: number | string;
			paymentType:
				| (typeof PaymentType)['CARD']
				| (typeof PaymentType)['WALLET']
				| (typeof PaymentType)['VOUCHER'];
			vouchers?: number;
			pin?: undefined;
			phone?: string;
			failUrl?: string;
			returnUrl?: string;
	  }
	| {
			offerId: number | string;
			paymentType: (typeof PaymentType)['SMS'];
			pin: string;
			phone: string;
			vouchers?: undefined;
			failUrl?: undefined;
			returnUrl?: undefined;
	  };

export function payOfferTopping(
	{
		offerId,
		paymentType,
		vouchers = undefined,
		pin = undefined,
		failUrl = undefined,
		returnUrl = undefined,
		phone = undefined,
	}: PayOfferToppingParams,
	headers?: HeadersInit,
) {
	const newHeaders = new Headers(headers);
	newHeaders.set('Accept', 'application/json');
	newHeaders.set('Content-Type', 'application/json');

	return createAPIMethod({
		path: `/items/${offerId}/payments`,
		method: 'POST',
		skipResponseParsing: true,
		headers: newHeaders,
	})({
		payment_type: paymentType,
		vouchers,
		sms_pin: pin,
		phone,
		fail_url: failUrl,
		return_url: returnUrl,
	});
}

export function payOfferToppingV2(
	{
		offerId,
		paymentType,
		vouchers = undefined,
		pin = undefined,
		failUrl = undefined,
		returnUrl = undefined,
	}: PayOfferToppingParams,
	headers?: HeadersInit,
) {
	const newHeaders = new Headers(headers);
	newHeaders.set('Accept', 'application/json');
	newHeaders.set('Content-Type', 'application/json');

	return createAPIMethod({
		path: `/items/${offerId}/payments`,
		method: 'POST',
		skipResponseParsing: true,
		headers: newHeaders,
	})({
		payment_type: paymentType,
		vouchers,
		sms_pin: pin,
		fail_url: failUrl,
		return_url: returnUrl,
	});
}

export type checkOfferPaymentStatusResponse = {
	statusCode: number;
	paymentStatus: (typeof PaymentStatus)[keyof typeof PaymentStatus];
	errors: { errorCode: number | string; errorData: any }[];
};

export function checkOfferPaymentStatus(
	offerId: number | string,
	paymentId: number | string,
	params: any = {},
	headers?: HeadersInit,
) {
	return createAPIMethod<object, checkOfferPaymentStatusResponse>({
		path: `/items/${offerId}/payments/${paymentId}`,
		method: 'PUT',
		suppressErrorThrowing: true,
		headers,
	})(params);
}

export function getPopularOffers(
	categoryId?: number,
	headers?: HeadersInit,
	abortController?: AbortController,
	mockConfig?: MockConfig,
) {
	const newHeaders = new Headers(headers);
	newHeaders.set('Accept', 'application/json');
	newHeaders.set('Content-Type', 'application/json');

	return createAPIMethod<object, GetOffersResponse>({
		path: '/popular_adverts',
		method: 'GET',
		normalize: ({ results, pagination }, isLabMode) => ({
			pagination,
			results: results.map((offer: ApiOfferData) => normalizeOfferData(offer, isLabMode)),
		}),
		headers: newHeaders,
		useCache: true,
		cacheTtl: 60 * 1000,
		abortController,
		mockConfig,
	})(categoryId ? { category_id: categoryId } : {});
}

export function validateOffer(offerId: number | string, params: object) {
	return createAPIMethod<object>({
		path: `/items/${offerId}/validate`,
		method: 'POST',
		skipResponseParsing: true,
	})(normalizeToSnakeCase(params));
}

export type ExtendOfferStatusSummary = {
	advert_id: number;
	errors?: string[];
	operation_ok: boolean;
};

export type ExtendOffersResponse = {
	status_code: number;
	status_message: string;
	summary?: ExtendOfferStatusSummary[];
};

export function extendOffers(offerIds: number[]) {
	return createAPIMethod<{ ids: number[] }, ExtendOffersResponse>({
		path: `/items/validity/extend`,
		method: 'POST',
		normalize: (result: any) => result,
	})({ ids: offerIds });
}

export type GetMessengerRoomResponse = {
	messengerRoomId: string;
};

export function getMessengerRoom(offerId: number | string) {
	return createAPIMethod<object, GetMessengerRoomResponse>({
		path: `/items/${offerId}/messenger_room`,
		method: 'GET',
	})();
}

export function rejoinMessengerRoom(offerId: number | string) {
	return createAPIMethod<object, GetMessengerRoomResponse>({
		path: `/items/${offerId}/messenger_room/rejoin`,
		method: 'POST',
	})();
}

export type OfferRooms = {
	advertId: number;
	messengerRooms: Array<{
		roomId: string;
		unreadMessages: number;
	}>;
	unreadRooms: number;
};
export function getMessengerOffersRooms(offersId: Array<number | string>, headers?: HeadersInit) {
	return createAPIMethod<object, OfferRooms[]>({
		apiPath: '/api/v2',
		path: `/items/self/list_messenger_rooms/${offersId.join(',')}`,
		method: 'GET',
		headers,
	})();
}

