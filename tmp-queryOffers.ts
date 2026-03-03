import { isArray } from 'es-toolkit/compat';
import type { CategoryTreeCategory } from 'components/modal/categories/signals';
import { activeCategory, displayCategories } from 'signals/category';
import { availableCategories, categoryCountsOverride } from 'components/filters/categoryList/signals';
import { canIncludeUnpackedOffers } from 'service/offer/resource';
import { DOTHelper } from 'lib/dot/DOTHelper';
import { filters, localFilterToRemote, getSortRemoteParameter, type FilterSignalData } from 'signals/filters';
import { GEMIUS_PAGES } from 'lib/gemius/pages';
import { gemiusImpress } from 'lib/gemius/gemius';
import { getAnalyticsCategoryAmount } from 'service/category/utils';
import { getMixedOffersSearch } from 'service/offer';
import { getOffers, getOffersSearch } from 'service/offer/resource';
import { offers } from 'signals/offers';
import { OFFERS_WITHOUT_ADS_PER_PAGE, SORT_BY_SORT, UNPACKED_OFFERS_PER_PAGE } from 'utils/constants';
import { phraseCategories, hideOffersCount } from 'components/filters/categoryList/signals';
import { remoteFilterToUnpackedOffersFilter } from 'service/unpacked/utils';
import { SearchType } from 'lib/dot/enum/searchType';
import { searchUnpackedOffers } from 'service/unpacked/resource';
import { sendBazarImpression } from 'lib/dot/bazar/utils';
import { sendSearchAnalytics, sendSearchPageImpression } from 'lib/dot/search/utils';
import { sendSortOffersAnalytics, sortToSortAnalytics } from 'lib/dot/generic/sortOffers';
import { signal } from '@preact/signals';
import { type CategoryData } from 'service/category/model';
import {
	queryOffersAdminCategoriesCounts,
	queryOffersAdminCategoriesFull,
	queryOffersBazarCategories,
	queryOffersEshopCategories,
	queryOffersSearchCategories,
	queryOffersSearchEshopCategories,
} from 'components/categories/signals';

// Null if we did not search for categories via phrase, else array of found categories
export const isQueryOffersAppend = signal<boolean>(false);
export const isQueryOffersLoading = signal<boolean>(false);
export const areQueryCategoriesLoading = signal<boolean>(false);
// FilterPanel on phone uses a prediction of category counts before submitting the filter. We have to separate that.
export const areQueryCategoriesLoadingPhone = signal<boolean>(false);
let queryOffersRequestId = 0;
/**
 *
 * @param appendOffers
 * @param searchType prerequisite for analytics to be sent. Also, if it is `category`, then we can skip refreshing category numbers
 * @param pushHistory
 */
export async function queryOffers(appendOffers: boolean = false, searchType?: SearchType, pushHistory: boolean = true) {
	// We might not want to create a new history state, such as when we query offers via navigating back
	if (pushHistory) filters.historyPushState(undefined, undefined, searchType);

	isQueryOffersAppend.value = appendOffers;
	isQueryOffersLoading.value = true;
	const reqId = ++queryOffersRequestId;
	const filtersValue = filters.peek();

	const [offersResult, categoriesResult] = await Promise.all([
		handleOfferQueries(filtersValue),
		handleCategoryQueries(filtersValue, searchType),
	]);

	const patchedOffersResult = {
		...offersResult,
		results: offersResult.results.map((result) => ({
			...result,
			loadedOnPageNumber: filtersValue.page.value,
		})),
		watchdogId: filtersValue.watchdog_id?.seoName,
	};

	if (reqId === queryOffersRequestId) {
		offers.value = appendOffers
			? {
					...offers.peek(),
					...patchedOffersResult,
					results: [...offers.peek().results, ...patchedOffersResult.results],
				}
			: patchedOffersResult;
		refreshCategoryCounts(categoriesResult, filtersValue);

		isQueryOffersLoading.value = false;
		areQueryCategoriesLoading.value = false;
	}

	if (searchType) {
		// OFFER_STATUS is a subtype of FILTER SearchType, that requires special handling above, but should use same analytics as regular FILTER
		if (searchType === SearchType.FILTER_OFFER_STATUS) searchType = SearchType.FILTER;

		// Edge case for analytics, where SORT filter is supposed to contain the amount of offers sorted. However, there
		// is an edge case where we can alter the filters, and then change the sorting before the first filter change
		// gets its response. So at the time of changing sort, we are not yet aware of how many offers are going to be
		// there in total. So sort analytics must be sent after queryOffers is done to guarantee the correct amount.
		// And also sort is not technically a filter, so it also should NOT trigger search analytics
		if (searchType === SearchType.SORT) {
			const sort = getSortRemoteParameter(filtersValue);
			sendSortOffersAnalytics(
				sortToSortAnalytics(sort ?? SORT_BY_SORT.NEWEST), // No sort means default sort
				offersResult.pagination.totalWithUnpacked ?? offersResult.pagination.total,
			);
		} else {
			DOTHelper.addToStore({ searchType });
			sendSearchAnalytics({
				searchType,
				useCurrentPageType: true,
				filters: filtersValue,
				categoryCount:
					((filtersValue.shop || filtersValue.isAdmin || filtersValue.seller) &&
						getAnalyticsCategoryAmount(availableCategories.peek(), activeCategory.peek()?.id)) ??
					((isArray(categoriesResult) && categoriesResult?.length) || phraseCategories.peek()?.length) ??
					displayCategories.peek().length ??
					null,
				itemCount: offersResult.pagination.total,
				resolvedLocality: filters.peek().resolvedLocality,
			});
		}
	}

	if (filtersValue.shop || filtersValue.seller) {
		sendBazarImpression(offersResult.pagination.total);
	} else {
		gemiusImpress(GEMIUS_PAGES.SEARCH_PAGE);
		sendSearchPageImpression();
	}

	return [patchedOffersResult, categoriesResult] as const;
}

export function refreshCategoryCounts(
	categoriesResult:
		| CategoryData[]
		| Record<number, number>
		| { availableCategories: CategoryTreeCategory[]; categoriesCounts: Record<number, number> }
		| null,
	filtersValue: FilterSignalData,
) {
	if (categoriesResult) {
		hideOffersCount.value = filtersValue.rozbalene?.seoName === 'ano'; // Zbozi search should hide offers counts numbers

		// If we are on search page, we get entire list of categories to replace the current list with
		if (Array.isArray(categoriesResult)) {
			phraseCategories.value = categoriesResult;
		}

		// Else we are on bazar page. We might want to only update the counts or refresh the available categories too
		else if ('availableCategories' in categoriesResult && 'categoriesCounts' in categoriesResult) {
			availableCategories.value = categoriesResult.availableCategories;
			categoryCountsOverride.value = categoriesResult.categoriesCounts;
		} else {
			categoryCountsOverride.value = categoriesResult;
		}
	}
}

export function handleCategoryQueries(
	filtersValue: FilterSignalData,
	searchType?: SearchType,
	isPhoneFilterPanelPrediction = false,
) {
	const filterParams = localFilterToRemote(filtersValue, OFFERS_WITHOUT_ADS_PER_PAGE);
	// Bazar pages show all categories at once, so we don't need to query them when just the category is changed
	if (filtersValue.shop) {
		if (!searchType || searchType !== SearchType.CATEGORY) return queryOffersEshopCategories(filterParams);
	} else if (filtersValue.isAdmin) {
		if (searchType === SearchType.FILTER_OFFER_STATUS) {
			if (isPhoneFilterPanelPrediction) areQueryCategoriesLoadingPhone.value = true;
			else areQueryCategoriesLoading.value = true;

			return queryOffersAdminCategoriesFull(filterParams);
		} else if (!searchType || searchType !== SearchType.CATEGORY) {
			return queryOffersAdminCategoriesCounts(filterParams);
		}
	} else if (filtersValue.seller) {
		if (!searchType || searchType !== SearchType.CATEGORY) return queryOffersBazarCategories(filterParams);
	} else if (filtersValue.rozbalene?.seoName === 'ano') {
		// Search page: replace categories even if the only change in filters is the category
		return queryOffersSearchEshopCategories();
	} else {
		// Search page: replace categories even if the only change in filters is the category
		return queryOffersSearchCategories(filterParams);
	}

	return Promise.resolve(null);
}

export function handleOfferQueries(filtersValue: FilterSignalData) {
	const filterParams = localFilterToRemote(filtersValue, OFFERS_WITHOUT_ADS_PER_PAGE);
	if (filtersValue.shop) {
		return searchUnpackedOffers(
			remoteFilterToUnpackedOffersFilter({ ...filterParams, include_leaf_categories: true }),
		);
	}

	if (filtersValue.isAdmin) {
		return getOffers({ ...filterParams, include_adverts_stats: 1 });
	}

	if (!filtersValue.seller) {
		if (filtersValue.rozbalene?.seoName === 'ano') {
			return searchUnpackedOffers(remoteFilterToUnpackedOffersFilter(filterParams));
		}

		if (canIncludeUnpackedOffers(filterParams) || !['zbozi', undefined].includes(filterParams.sort)) {
			return getMixedOffersSearch(
				{ ...filterParams, limit: String(OFFERS_WITHOUT_ADS_PER_PAGE) },
				remoteFilterToUnpackedOffersFilter({ ...filterParams, limit: String(UNPACKED_OFFERS_PER_PAGE) }),
			);
		}
	}

	return getOffersSearch({ ...filterParams, limit: String(OFFERS_WITHOUT_ADS_PER_PAGE) });
}

