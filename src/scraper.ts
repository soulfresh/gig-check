import util from "node:util";
import { Browser, Page } from "puppeteer";
import {
  Nilable,
  EventsResult,
  WebsiteConfig,
  BandConfig,
  Selectors,
  TwoPageSiteSelector,
} from "./types";
import chalk from "chalk";
import { countEvents, findTextSnippets } from "./util";
import { spinner } from "./spinner";

function determineShowRelevance(terms: string[], description: string) {
  // TODO make this a commandline parameter
  return findTextSnippets(description, terms, 50);
}

function isTwoPageSiteSelector(
  selectors: Selectors,
): selectors is TwoPageSiteSelector {
  return (selectors as any).detailLink != null;
}

/**
 * Load the next page of events using the provided selector to determine if the
 * page is loaded.
 */
async function loadNextPage(
  page: Page,
  site: WebsiteConfig,
  loadedSelector: string,
) {
  // Wait for the event container to load
  await page.waitForSelector(loadedSelector);

  const results = await page.$$eval(
    site.selectors.event,
    (elements, selectors) => {
      const out = elements.map((el) => {
        const out = {
          name: el.querySelector(selectors.name)?.textContent?.trim(),
          date: el.querySelector(selectors.date)?.textContent?.trim(),
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
        };
        return out;
      });
      return out;
    },
    site.selectors,
  );

  // TODO Madam's Organ has a load more button but using it is going to be a bit
  // of a pain. I would need to wait for the number of events on the page to
  // increase or watch the button for the load indicator to be removed
  // (.mec-load-more-loading).
  // if (site.selectors.loadMore) {
  //   const lastEventDate = results.at(-1)?.date;
  //   if (lastEventDate) {
  //     const date = new Date(lastEventDate);
  //     if (!isNaN(date.getTime())) {
  //       const loadMoreButton = await page.$(site.selectors.loadMore);
  //       if (loadMoreButton) {
  //         await loadMoreButton.click();
  //         await page.waitForSelector(loadedSelector, { timeout: 10000 });
  //         const moreResults = await loadNextPage(page, site, loadedSelector);
  //         return [...results, ...moreResults];
  //       } else {
  //         console.log(
  //           `No more events found for ${site.url} on ${lastEventDate}`,
  //         );
  //       }
  //     }
  //   }
  // }

  return results;
}

/**
 * Get the name, date and detail link for each event on the given web page.
 */
async function getEventSummariesFromWebsite(
  browser: Browser,
  site: WebsiteConfig,
  _previous: Nilable<EventsResult>,
) {
  // const hasAllRelevance = !!previous
  //   ? previous.events?.every((e) => e.relevance !== null)
  //   : false;
  // const fetchMore = hasAllRelevance && site.selectors.loadMore;

  const output: EventsResult = {
    url: site.url,
    events: [],
    errors: [],
  };
  const page = await browser.newPage();

  try {
    await page.goto(site.url, { waitUntil: "networkidle2" });

    const results = await loadNextPage(page, site, site.selectors.event);

    // // Wait for the event container to load
    // await page.waitForSelector(site.selectors.event);
    //
    // const results = await page.$$eval(
    //   site.selectors.event,
    //   (elements, selectors) => {
    //     const out = elements.map((el) => {
    //       const out = {
    //         name: el.querySelector(selectors.name)?.textContent?.trim(),
    //         date: el.querySelector(selectors.date)?.textContent?.trim(),
    //         // Cannot use `isTwoPageSiteSelector` here because it is not
    //         // available in the browser.
    //         detailLink: (selectors as any).detailLink
    //           ? el
    //               .querySelector((selectors as any).detailLink)
    //               ?.getAttribute("href")
    //           : null,
    //         // Cannot use `isTwoPageSiteSelector` here because it is not
    //         // available in the browser.
    //         description: (selectors as any).detailLink
    //           ? null
    //           : el?.textContent?.trim(),
    //         relevance: null,
    //       };
    //       return out;
    //     });
    //     return out;
    //   },
    //   site.selectors,
    // );

    output.events = results;
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
) {
  if (!eventSummaries.events?.length) {
    spinner.info(
      `No events found for site ${chalk.yellow(eventSummaries.url)}`,
    );
    return { site: eventSummaries, count: 0, errorCount: 0 };
  }

  const offset = eventSummaries.events.findIndex((e) => e.relevance == null);
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
    `Fetching details for events ${chalk.green(offset)} - ${chalk.green(end)} from ${chalk.yellow(eventSummaries.url)}`,
  );

  for (let index = offset; index < end; index++) {
    const event = eventSummaries.events![index];
    if (!event) throw new Error("Event not found for index " + index);
    // If it's a two page selector, we need to load the detail page to get the
    // event description.
    if (isTwoPageSiteSelector(websiteConfig.selectors)) {
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
          continue;
        }

        spinner.start(`Retrieving event ${chalk.green(event.name)}`);
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
          spinner.info(`Retrieved event ${chalk.green(event.name)}`);
          continue;
        } else {
          errorCount++;
          eventSummaries.errors = [
            ...(eventSummaries.errors ?? []),
            `No description found for event (${index}) ${event.name} on ${event.date} at ${eventSummaries.url}`,
          ];
          spinner.fail(
            `No description found for event ${chalk.red(event.name)}`,
          );
          continue;
        }
      } catch (error) {
        errorCount++;
        eventSummaries.errors = [
          ...(eventSummaries.errors ?? []),
          `Error fetching event (${index}) ${event.name} on ${event.date} at ${eventSummaries.url}: ${error}`,
        ];
        spinner.fail(
          `Error fetching event ${chalk.red(event.name)} (see errors below)`,
        );
        continue;
      }
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
) {
  const sites: EventsResult[] = [];
  for (const site of websiteConfigs) {
    const prev = previous.find((s) => s.url === site.url);

    spinner.start(`Fetching events from: ${chalk.green(site.url)}`);
    const data = await getEventSummariesFromWebsite(browser, site, prev);
    sites.push(data);
    spinner.succeed(`Fetched events from: ${chalk.green(site.url)}`);
  }
  console.log(util.inspect(sites, { colors: true, depth: null }));

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

    const r = await getEventDetails(browser, c, site, band, limit, timeout);
    detailCount += r.count;
  }
  spinner.succeed(`${chalk.green(detailCount)} Event details fetched`);
}
