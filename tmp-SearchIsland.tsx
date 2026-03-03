import { useLayoutEffect } from 'preact/hooks';
import { filters, type FilterSignalData } from 'signals/filters';
import { spaHookupListener, spaUnhookListener } from 'signals/spa';
import type { CategoryData } from 'service/category/model';
import { dispatchIslandLoaded } from 'utils/islandUtils';
import type { GetMixedOffersSearchResponse } from 'service/offer/resource';
import { offers } from 'signals/offers';
import { categoriesData, categoriesMap } from 'signals/category';
import { phraseCategories, hideOffersCount } from 'components/filters/categoryList/signals';
import { activateCategory } from 'components/modal/categories/signals';
import { useIslandInit } from 'signals/island';

export type Props = {
	ssrFilters: FilterSignalData;
	ssrOffers: GetMixedOffersSearchResponse;
	ssrAllCategories: CategoryData[];
	ssrPhraseCategories: CategoryData[] | null;
	ssrHideOffersCount: boolean;
};

export function SearchIsland({
	ssrFilters,
	ssrOffers,
	ssrPhraseCategories,
	ssrHideOffersCount,
	ssrAllCategories,
}: Props) {
	useIslandInit(() => {
		filters.value = ssrFilters;
		offers.value = ssrOffers;
		categoriesData.value = ssrAllCategories;
		phraseCategories.value = ssrPhraseCategories;
		hideOffersCount.value = ssrHideOffersCount;

		const category = filters.peek().category;

		activateCategory(category ? (categoriesMap.peek()[category.id] ?? null) : null);
	});

	useLayoutEffect(() => {
		dispatchIslandLoaded('SearchIsland');

		spaHookupListener();

		return () => {
			spaUnhookListener();
		};
	}, []);

	return;
}

