import util from "node:util";
import { Browser, ElementHandle, Page } from "puppeteer";
import {
  Nilable,
  EventsResult,
  WebsiteConfig,
  BandConfig,
  Selectors,
  TwoPageSiteSelector,
  Event,
  TwoPageWebsiteConfig,
} from "./types";
import chalk from "chalk";
import {
  countEvents,
  findTextSnippets,
  isElementVisible,
  normalizeWhitespace,
  testStringOrRegex,
} from "./util";
import { spinner } from "./spinner";

function determineShowRelevance(terms: string[], description: string) {
  // TODO make this a commandline parameter
  return findTextSnippets(description, terms);
}

function isTwoPageSiteSelector(
  selectors: Selectors,
): selectors is TwoPageSiteSelector {
  return (selectors as any).detailLink != null;
}

function getEventId(event: Event) {
  return `${event.name}-${event.date}`;
}

/**
 * Load the next page of events using the provided selector to determine if the
 * page is loaded.
 */
async function loadNextPage(
  page: Page,
  site: WebsiteConfig,
  timeout: number,
  /**
   * A list of event `name-date` strings that have already been discovered. This
   * is used to prevent duplicates from getting added to the list of events in
   * the case that the page uses infinite scroll.
   */
  discoveredEvents: string[] = [],
  depth = 0,
  maxDepth = 6,
  // TODO Max date parameter? If I add this, then we should make the maxDepth a
  // larger number (12?)
  // maxDate?: Date,
) {
  spinner.suffixText = `: page ${depth + 1}`;
  // Wait for the event container to load
  await page.waitForSelector(site.selectors.event, { timeout });

  // TODO We need to make sure this doesn't add the same events multiple times.
  // In the case of a pageinated page this is working fine. In the cate of an
  // infinite scroll page, the events from the first page are re-added on every
  // subsequent "load more".
  let errors: unknown[] = [];
  let resultsOnPage = await page.$$eval(
    site.selectors.event,
    (elements, selectors, page) => {
      const out = elements.map((el) => {
        const out = {
          name: el
            .querySelector(selectors.name)
            ?.textContent?.replace(/\s+/g, " ")
            .trim(),
          date: el
            .querySelector(selectors.date)
            ?.textContent?.replace(/\s+/g, " ")
            .trim(),
          // Cannot use `isTwoPageSiteSelector` here because it is not
          // available in the browser.
          detailLink: (selectors as any).detailLink
            ? el
                .querySelector((selectors as any).detailLink)
                ?.getAttribute("href")
            : null,
          // Cannot use `isTwoPageSiteSelector` here because it is not
          // available in the browser.
          description: (selectors as any).detailLink
            ? null
            : el?.textContent?.trim(),
          relevance: null,
          page,
        };
        return out;
      });
      return out;
    },
    site.selectors,
    depth,
  );

  // Whether we've gone too far into the future or done too many resursive
  // iterations. Some websites have endless repeating events and we don't want
  // to get stuck in an infinite loop.
  const depthExceeded = maxDepth == null ? false : depth >= maxDepth;
  // const dateExceeded =
  //   maxDate == null
  //     ? false
  //     : results.some((event) => {
  //         return false;
  //         const eventDate = new Date(event.date || "");
  //         return isNaN(eventDate.getTime()) || eventDate > maxDate!;
  //       });

  // Check if there is a "load more" button
  if (
    site.selectors.loadMoreLink &&
    !depthExceeded
    // && !dateExceeded
  ) {
    const nextDepth = depth + 1;

    let loadMoreButton: ElementHandle<Element> | null = null;
    try {
      loadMoreButton = await page.$(site.selectors.loadMoreLink);
    } catch (error) {
      spinner.fail(`Unable to find load more button at depth ${nextDepth}`);
      errors.push(`Could not find load more button on ${site.url}`);
    }

    if (loadMoreButton) {
      let visible = await loadMoreButton?.isVisible();
      if (visible) {
        visible = await loadMoreButton?.evaluate((el) => {
          const o = window.getComputedStyle(el).opacity;
          if (typeof o === "string") {
            return parseFloat(o) > 0;
          } else {
            return true;
          }
        });
      }

      if (visible) {
        const initialEventCount = resultsOnPage.length;

        // Click the "load more" button
        await loadMoreButton.click();

        if (site.selectors.loadMoreLoader) {
          try {
            // Wait for the loader to appear and then disappear
            await page.waitForSelector(site.selectors.loadMoreLoader, {
              visible: true,
              timeout,
            });
            await page.waitForSelector(site.selectors.loadMoreLoader, {
              hidden: true,
              timeout,
            });
          } catch (e) {
            errors.push(
              `Error waiting for load more loader on ${site.url}: ${e}`,
            );
          }
        } else {
          try {
            // Wait for the number of events to increase
            await page.waitForFunction(
              (selector, count) =>
                document.querySelectorAll(selector).length > count,
              {},
              site.selectors.event,
              initialEventCount,
            );
          } catch (e) {
            errors.push(
              `Error waiting for more events to load on ${site.url}: ${e}`,
            );
          }
        }

        // Filter out events we've seen before.
        const newEvents = resultsOnPage.filter(
          (event) => !discoveredEvents.includes(getEventId(event)),
        );
        const eventIds = [
          ...discoveredEvents,
          ...newEvents.map((e) => getEventId(e)),
        ];

        // Recursively load the next page of events
        const moreResults = await loadNextPage(
          page,
          site,
          timeout,
          eventIds,
          nextDepth,
          maxDepth,
          // maxDate,
        );
        resultsOnPage = moreResults.results;
        errors = moreResults.errors;
        // resultsOnPage = [...newEvents, ...moreResults.results];
        // errors = [...errors, ...moreResults.errors];
      }
    }
  }

  return { results: resultsOnPage, errors };
}

/**
 * Get the name, date and detail link for each event on the given web page.
 */
async function getEventSummariesFromWebsite(
  browser: Browser,
  site: WebsiteConfig,
  timeout: number,
  _previous: Nilable<EventsResult>,
) {
  const output: EventsResult = {
    url: site.url,
    events: [],
    errors: [],
  };
  const page = await browser.newPage();

  // page.exposeFunction("__normalizeWhitespace", normalizeWhitespace);
  // page.exposeFunction("__isElementVisible", isElementVisible);

  try {
    await page.goto(site.url, { waitUntil: "networkidle2" });

    spinner.start(`${chalk.yellow(site.url)}`);
    const results = await loadNextPage(page, site, timeout);
    if (results.errors.length > 0) {
      spinner.fail(
        `${chalk.yellow(site.url)} Unable to detect load all events`,
      );
    } else {
      spinner.succeed();
    }
    spinner.suffixText = "";

    output.events = results.results;
    output.errors = results.errors;
  } catch (error) {
    console.error(
      `Error fetching events from ${chalk.yellow(site.url)}:`,
      error,
    );
    output.errors!.push(error);
  } finally {
    await page.close();
  }

  return output;
}

/**
 * Load the event details page for the given event summary. This will also look
 * up the artist lineup bios if the website supports it.
 */
async function getEventDetailsFromPage(
  browser: Browser,
  band: BandConfig,
  websiteConfig: TwoPageWebsiteConfig,
  event: Event,
  eventSummaries: EventsResult,
  index: number,
  timeout: number,
) {
  let errorCount = 0;
  try {
    // Find the selector for the given link.
    const selector = websiteConfig.selectors.description.find((s) =>
      event.detailLink?.includes(s.domain),
    );

    if (!selector) {
      eventSummaries.errors = [
        ...(eventSummaries.errors ?? []),
        `Counld not find a description selector for event (${index}) ${event.name} on ${event.date} at ${event.detailLink}`,
      ];
      spinner.fail(
        `Could not find a description selector for event ${chalk.red(event.name)}`,
      );
      return { success: false, events: eventSummaries, errorCount: 1 };
    }

    spinner.start(
      `Retrieving event ${chalk.green(event.name)} ${chalk.yellow(event.date)}`,
    );
    const page = await browser.newPage();
    await page.goto(event.detailLink as string, {
      waitUntil: "networkidle2",
    });

    // Wait for the event container to load
    await page.waitForSelector(selector.description, { timeout });

    const description = await page.$eval(
      selector.description,
      (el: Element) => el.textContent?.trim(),
      websiteConfig.selectors,
    );

    const descriptions: string[] = [];
    if (description) {
      descriptions.push(description);
    }

    // If the website has a lineup selector, we need to get the description
    // for each artist in the lineup.
    if (selector.lineup) {
      const lineupLinks = await page.$$eval(selector.lineup, (elements) =>
        elements.map((el) => el.getAttribute("href")),
      );

      for (const link of lineupLinks) {
        if (!link || !selector.artistDescription) continue;

        try {
          await page.goto(link, { waitUntil: "networkidle2" });
          await page.waitForSelector(selector.artistDescription, {
            timeout,
          });

          const lineupDescription = await page.$eval(
            selector.artistDescription,
            (el: Element) => el.textContent?.trim(),
          );

          if (lineupDescription) {
            descriptions.push(lineupDescription);
          }
        } catch (lineupError) {
          errorCount++;
          eventSummaries.errors = [
            ...(eventSummaries.errors ?? []),
            `Error fetching lineup description for event (${index}) ${event.name} on ${event.date} at ${link}: ${lineupError}`,
          ];
          spinner.fail(
            `Error fetching lineup description for event ${chalk.red(event.name)} (see errors below)`,
          );
        }
      }
    }

    if (descriptions.length > 0) {
      event.relevance = determineShowRelevance(
        band.genres,
        descriptions.join("\n"),
      );
      spinner.info(
        `Retrieved event ${chalk.green(event.name)} ${chalk.yellow(event.date)}`,
      );
      page.close();
      return { success: true, events: eventSummaries, errorCount };
    } else {
      errorCount++;
      const message = `No description found for event (${index}) ${event.name} on ${event.date} at ${eventSummaries.url}`;
      eventSummaries.errors = [...(eventSummaries.errors ?? []), message];
      event.errors = [...(event.errors ?? []), message];
      spinner.fail(`No description found for event ${chalk.red(event.name)}`);
      page.close();
      return { success: false, events: eventSummaries, errorCount };
    }
  } catch (error) {
    errorCount++;
    eventSummaries.errors = [
      ...(eventSummaries.errors ?? []),
      `Error fetching event (${index}) ${event.name} on ${event.date} at ${event.detailLink ?? eventSummaries.url}: ${error}`,
    ];
    event.errors = [...(event.errors ?? []), String(error)];
    spinner.fail(
      `Error fetching event ${chalk.red(event.name)} (see errors below)`,
    );
    return { success: false, events: eventSummaries, errorCount };
  }
}

export const DEFAULT_EVENT_FILTERS = [
  /private event/i,
  /cancelled/i,
  /postponed/i,
  /open mic/i,
];

/**
 * Determine the relevance of each event by checking the detail link. This will
 * populate the `relevance` field of each event. Only the first `limit` events
 * without a relevance score will be checked so as not to get rate limited. This
 * function modifies the `site` object in place but also returns the number of
 * sucessfully fetched events and errors.
 */
async function getEventDetails(
  browser: Browser,
  /**
   * The website selectors.
   */
  websiteConfig: WebsiteConfig,
  /**
   * The list of event summaries to check.
   */
  eventSummaries: EventsResult,
  /**
   * The band config to use for determining relevance.
   */
  band: BandConfig,
  limit = 5,
  timeout = 10000,
  /**
   * A list of strings to filter out events that are not relevant.
   */
  filter: (string | RegExp)[] = DEFAULT_EVENT_FILTERS,
) {
  if (!eventSummaries.events?.length) {
    spinner.info(
      `No events found for site ${chalk.yellow(eventSummaries.url)}`,
    );
    return { site: eventSummaries, count: 0, errorCount: 0 };
  }

  const offset = eventSummaries.events.findIndex(
    (e) => e.relevance == null && e.errors == null,
  );
  if (offset == -1) {
    spinner.info(
      `All events already have relevance scores for site ${chalk.yellow(eventSummaries.url)}`,
    );
    return { site: eventSummaries, count: 0, errorCount: 0 };
  }

  const remaining = eventSummaries.events.length - offset;
  const count = isTwoPageSiteSelector(websiteConfig.selectors)
    ? Math.min(limit, remaining)
    : remaining;
  const end = offset + count;
  let errorCount = 0;

  spinner.info(
    `Fetching details for events (${chalk.green(offset)} - ${chalk.green(end)}) / ${chalk.green(eventSummaries.events.length)} from ${chalk.yellow(eventSummaries.url)}`,
  );

  for (let index = offset; index < end; index++) {
    const event = eventSummaries.events![index];
    if (!event) throw new Error("Event not found for index " + index);
    // If the relevance info is already set, skip this event. In the case that we
    // start from the wrong offset, this prevents us from needlessly looking up
    // data we already have.
    if (event.relevance) continue;
    // Skip any events that match our filter.
    // if (testStringOrRegex(event.name || "", filter)) {
    // if (filter.some((f) => f.test(event.name || ""))) {
    if (filter.some((f) => testStringOrRegex(event.name || "", f))) {
      // Mark this event as irrelevant
      event.relevance = [];
      continue;
    }

    // If it's a two page selector, we need to load the detail page to get the
    // event description.
    if (isTwoPageSiteSelector(websiteConfig.selectors)) {
      const { events: updatedEvents, errorCount: ec } =
        await getEventDetailsFromPage(
          browser,
          band,
          websiteConfig as TwoPageWebsiteConfig,
          event,
          eventSummaries,
          index,
          timeout,
        );
      eventSummaries = updatedEvents;
      errorCount += ec;
      // try {
      //   // Find the selector for the given link.
      //   const selector = websiteConfig.selectors.description.find((s) =>
      //     event.detailLink?.includes(s.domain),
      //   );
      //
      //   if (!selector) {
      //     eventSummaries.errors = [
      //       ...(eventSummaries.errors ?? []),
      //       `Counld not find a description selector for event (${index}) ${event.name} on ${event.date} at ${event.detailLink}`,
      //     ];
      //     spinner.fail(
      //       `Could not find a description selector for event ${chalk.red(event.name)}`,
      //     );
      //     continue;
      //   }
      //
      //   spinner.start(`Retrieving event ${chalk.green(event.name)}`);
      //   const page = await browser.newPage();
      //   await page.goto(event.detailLink as string, {
      //     waitUntil: "networkidle2",
      //   });
      //
      //   // Wait for the event container to load
      //   await page.waitForSelector(selector.description, { timeout });
      //
      //   const description = await page.$eval(
      //     selector.description,
      //     (el: Element) => el.textContent?.trim(),
      //     websiteConfig.selectors,
      //   );
      //
      //   const descriptions: string[] = [];
      //   if (description) {
      //     descriptions.push(description);
      //   }
      //
      //   // If the website has a lineup selector, we need to get the description
      //   // for each artist in the lineup.
      //   if (selector.lineup) {
      //     const lineupLinks = await page.$$eval(selector.lineup, (elements) =>
      //       elements.map((el) => el.getAttribute("href")),
      //     );
      //
      //     for (const link of lineupLinks) {
      //       if (!link || !selector.artistDescription) continue;
      //
      //       try {
      //         await page.goto(link, { waitUntil: "networkidle2" });
      //         await page.waitForSelector(selector.artistDescription, {
      //           timeout,
      //         });
      //
      //         const lineupDescription = await page.$eval(
      //           selector.artistDescription,
      //           (el: Element) => el.textContent?.trim(),
      //         );
      //
      //         if (lineupDescription) {
      //           descriptions.push(lineupDescription);
      //         }
      //       } catch (lineupError) {
      //         errorCount++;
      //         eventSummaries.errors = [
      //           ...(eventSummaries.errors ?? []),
      //           `Error fetching lineup description for event (${index}) ${event.name} on ${event.date} at ${link}: ${lineupError}`,
      //         ];
      //         spinner.fail(
      //           `Error fetching lineup description for event ${chalk.red(event.name)} (see errors below)`,
      //         );
      //       }
      //     }
      //   }
      //
      //   if (descriptions.length > 0) {
      //     event.relevance = determineShowRelevance(
      //       band.genres,
      //       descriptions.join("\n"),
      //     );
      //     spinner.info(`Retrieved event ${chalk.green(event.name)}`);
      //     page.close();
      //     continue;
      //   } else {
      //     errorCount++;
      //     const message = `No description found for event (${index}) ${event.name} on ${event.date} at ${eventSummaries.url}`;
      //     eventSummaries.errors = [...(eventSummaries.errors ?? []), message];
      //     event.errors = [...(event.errors ?? []), message];
      //     spinner.fail(
      //       `No description found for event ${chalk.red(event.name)}`,
      //     );
      //     page.close();
      //     continue;
      //   }
      // } catch (error) {
      //   errorCount++;
      //   eventSummaries.errors = [
      //     ...(eventSummaries.errors ?? []),
      //     `Error fetching event (${index}) ${event.name} on ${event.date} at ${event.detailLink ?? eventSummaries.url}: ${error}`,
      //   ];
      //   event.errors = [...(event.errors ?? []), String(error)];
      //   spinner.fail(
      //     `Error fetching event ${chalk.red(event.name)} (see errors below)`,
      //   );
      //   continue;
      // }
    }
    // If we already have a description, then we have everything we need to
    // determine the event relevance.
    else if (event.description) {
      event.relevance = determineShowRelevance(band.genres, event.description);
    }
    // We probably have a misconfiguration here.
    else {
      errorCount++;
      eventSummaries.errors = [
        ...(eventSummaries.errors ?? []),
        `No detail link found for event (${index}) ${event.name} on ${event.date} at ${eventSummaries.url}`,
      ];
      spinner.fail(`No detail link found for event ${chalk.red(event.name)}`);
      continue;
    }
  }

  return {
    site: eventSummaries,
    count,
    errorCount,
  };
}

/**
 * Load the event summaries for the given list of websites. This will visit the
 * event list page for that website and extract the event summary data.
 */
export async function loadAllEventSummaries(
  websiteConfigs: WebsiteConfig[],
  previous: EventsResult[],
  browser: Browser,
  timeout: number,
) {
  const sites: EventsResult[] = [];
  for (const site of websiteConfigs) {
    const prev = previous.find((s) => s.url === site.url);

    spinner.info(`Fetching events from: ${chalk.yellow(site.url)}`);
    const data = await getEventSummariesFromWebsite(
      browser,
      site,
      timeout,
      prev,
    );
    sites.push(data);
    spinner.succeed(`Finished fetching events from: ${chalk.yellow(site.url)}`);
  }
  // console.log(util.inspect(sites, { colors: true, depth: null }));

  const loadErrorCount = sites.reduce(
    (count, site) => count + (site.errors?.length ?? 0),
    0,
  );
  if (loadErrorCount > 0)
    spinner.fail(`${chalk.red(loadErrorCount)} errors found`);
  else
    spinner.succeed(`${chalk.green(countEvents(sites))} remote events found`);

  return sites;
}

/**
 * Calculate the relevance for the events missing this data. This modifies the
 * sites data in place. How relevance is calculated depends on the website and may
 * require loading additional pages.
 */
export async function getRelevanceForEvents(
  sites: EventsResult[],
  band: BandConfig,
  browser: Browser,
  limit: number,
  timeout: number,
) {
  let detailCount = 0;
  for (const site of sites) {
    const c = band.websiteConfigs.find((c) => c.url === site.url);

    if (!c) {
      site.errors = [
        ...(site.errors ?? []),
        `Unable to find config for site ${site.url}`,
      ];
      spinner.fail(`Unable to find config for site ${chalk.red(site.url)}`);
      continue;
    }

    const r = await getEventDetails(browser, c, site, band, limit, timeout, [
      ...(band.filter ?? []),
      ...DEFAULT_EVENT_FILTERS,
    ]);
    detailCount += r.count;
  }
  spinner.succeed(`${chalk.green(detailCount)} Event details fetched`);
}
