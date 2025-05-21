export type Nilable<T> = T | null | undefined;

interface WebsiteContentSelector {
  /**
   * The domain on which the selector is valid. Some venue sites will link out
   * to multiple ticketing sites which will each have different selector needs.
   */
  domain: string;
  /**
   * The event description selector.
   */
  description: string;
  /**
   * The lineup selector used to find links to description pages for each artist
   * on the lineup. This is useful for sites that don't provide much detail in
   * the event description so we need to get a description of the event artists
   * instead.
   */
  lineup?: string;
  /**
   * The selector used to find the description about an artist on the lineup
   * (if a `lineup` selector is defined).
   */
  artistDescription?: string;
}

/**
 * The config for a website that includes all necessary information on the first
 * page.
 */
export interface SinglePageSiteSelector {
  /**
   * The CSS selector used to find each event on the page.
   */
  event: string;
  /**
   * The CSS selector used to find the date of the event.
   */
  date: string;
  /**
   * The name of the event. This is usually the name of the band(s) playing.
   */
  name: string;
  /**
   * A link to load additional events. If this is specified, then it is expected
   * that the page has a "load more" button that will load more events when
   * pressed.
   */
  loadMoreLink?: string;
  /**
   * A selector to determine if the page is currently loading more events. When
   * this is added and then remove, the "load more" event is considered to be
   * complete. If this is not specified, then the number of events on the page
   * will be tracked to determine when the page has finished loading.
   */
  loadMoreLoader?: string;
}

/**
 * Te config for a website that requires visiting an event detail page to get
 * the event description.
 */
export interface TwoPageSiteSelector extends SinglePageSiteSelector {
  /**
   * A link to the event details page. If this has a value set, that page will
   * be opened and used to populate the event data.
   */
  detailLink: string;
  /**
   * The container that holds the event description. This is a list
   * because the detail link could point to pages on different sites.
   */
  description: WebsiteContentSelector[];
}

export type Selectors = SinglePageSiteSelector | TwoPageSiteSelector;

export interface Event {
  name: Nilable<string>;
  date: Nilable<string>;
  /**
   * The description text for the event if all the data is available on the
   * first page.
   */
  description: Nilable<string>;
  /**
   * The link to the event detail page if the data is not available on the first
   * page.
   */
  detailLink: Nilable<string>;
  /**
   * A list of snippets of text from the event description that are relevant to
   * our genres.
   */
  relevance: Nilable<string[]>;
  /**
   * The page number on which the event was found. Or in the case of an infinite
   * scroll page, the number of times "load more" was triggered.
   */
  page: number;
  /**
   * Whether or not there were any errors scraping the event.
   */
  errors?: string[];
}

export interface EventsResult {
  url: string;
  events?: Event[];
  errors?: unknown[];
}

/**
 * The config describing how to scrape a venue website.
 */
export interface WebsiteConfig {
  /**
   * The website where we will search for gig opportunities.
   */
  url: string;
  /**
   * The list of CSS selectors used to find events and information about those
   * events.
   */
  selectors: Selectors;
  // /**
  //  * Group any events that are on the same date.
  //  */
  // mergeEvents?: (events: Event[]) => Event[];
  // /**
  //  * Convert the date string into separate date and time strings.
  //  */
  // normalizeDate?: (date: string) => [string, string];
}

/**
 * A website config that specifically has a TwoPageSiteSelector.
 */
export type TwoPageWebsiteConfig = Omit<WebsiteConfig, "selectors"> & {
  selectors: TwoPageSiteSelector;
};

/**
 * The minimal configuration for a band as defined in their config file.
 */
export interface BandBaseConfiguration {
  name: string;
  genres: string[];
  sites: string[];
  /**
   * Ignore events that match these filters even if they have a relevance value.
   */
  filter?: (string | RegExp)[];
}

/**
 * The extended configuration for a band that includes the website configs.
 */
export interface BandConfig extends BandBaseConfiguration {
  websiteConfigs: WebsiteConfig[];
}
