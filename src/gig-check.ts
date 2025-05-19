import chalk from "chalk";
import { constants } from "fs";
import { access, readFile, writeFile } from "fs/promises";
import util from "node:util";
import ora from "ora";
import puppeteer, { Browser, Page } from "puppeteer";

type Nilable<T> = T | null | undefined;

interface WebsiteContentSelector {
  domain: string;
  selector: string;
}

/**
 * The config for a website that includes all necessary information on the first
 * page.
 */
interface SinglePageSiteSelector {
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
   * A link to load additional events.
   */
  loadMore?: string;
}

/**
 * Te config for a website that requires visiting an event detail page to get
 * the event description.
 */
interface TwoPageSiteSelector extends SinglePageSiteSelector {
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

type Selectors = SinglePageSiteSelector | TwoPageSiteSelector;

function isTwoPageSiteSelector(
  selectors: Selectors,
): selectors is TwoPageSiteSelector {
  return (selectors as any).detailLink != null;
}

interface Config {
  /**
   * The website where we will search for gig opportunities.
   */
  url: string;
  /**
   * The list of CSS selectors used to find events and information about those
   * events.
   */
  selectors: Selectors;
  /**
   * Group any events that are on the same date.
   */
  mergeEvents?: (events: Event[]) => Event[];
  /**
   * Convert the date string into separate date and time strings.
   */
  normalizeDate?: (date: string) => [string, string];
}

interface Event {
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
}

interface EventsResult {
  url: string;
  events?: Event[];
  errors?: unknown[];
}

const config: Config[] = [
  // {
  //   url: "https://www.cometpingpong.com/livemusic",
  //   selectors: {
  //     event: "article",
  //     date: "time",
  //     name: ".dice_event-title",
  //   },
  // },
  // {
  //   url: "https://www.quarryhousetavern.com/music",
  //   selectors: {
  //     event: "article",
  //     date: "time",
  //     name: ".dice_event-title",
  //   },
  // },
  // {
  //   url: "https://www.unionstagepresents.com",
  //   selectors: {
  //     event: "[data-venue]",
  //     date: ".date",
  //     name: "a h4",
  //     detailLink: ".card-body > a",
  //     description: [
  //       {
  //         domain: "unionstagepresents.com",
  //         selector: ".about-show",
  //       },
  //       {
  //         domain: "ticketweb.com",
  //         selector: ".event-detail",
  //       },
  //       {
  //         domain: "eventbrite.com",
  //         selector: ".event-details",
  //       },
  //     ],
  //   },
  // },
  // {
  //   url: "https://www.madamsorgan.com/events/",
  //   selectors: {
  //     event: "article",
  //     date: ".mec-date-details",
  //     name: ".mec-event-title",
  //     detailLink: ".mec-booking-button",
  //     loadMore: ".mec-load-more-button",
  //     description: [
  //       {
  //         domain: "madamsorgan.com",
  //         selector: "article",
  //       },
  //     ],
  //   },
  // },
  // {
  //   url: "https://www.ramsheadonstage.com/events",
  //   selectors: {
  //     event: "#eventsList .entry",
  //     name: ".title",
  //     date: ".date",
  //     detailLink: ".title a",
  //     loadMore: "#loadMoreEvents",
  //     description: [
  //       {
  //         domain: "ramsheadonstage.com",
  //         selector: ".event_detail",
  //       },
  //     ],
  //   },
  // },
  // {
  //   // TODO The details page contains a line list where each artist has a link
  //   // to the artist bio. Will need to click into the bio to get their
  //   // description.
  //   url: "https://dc9.club/events/",
  //   selectors: {
  //     event: ".listing__details",
  //     name: ".listing__title",
  //     date: ".listingDateTime",
  //     detailLink: ".listing__titleLink",
  //     description: [
  //       {
  //         domain: "dc9.club",
  //         selector: ".singleListing__lineupListGrid",
  //       },
  //     ],
  //   },
  // },
];

const spinner = ora();
type Spinner = typeof spinner;

function determineShowRelevance(description: string) {
  return findTextSnippets(description, ["funk", "soul", "blues", "jazz"], 50);
}

/**
 * Replace multiple whitespace characters with a single space and trim it.
 */
function normalizeWhitespace(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

/**
 * Search the given string for the given search terms and return snippets of
 * text that contain those search terms.
 */
function findTextSnippets(
  text: string,
  searchTerms: string[],
  contextLength: number,
): string[] {
  const snippets: string[] = [];

  for (const term of searchTerms) {
    let startIndex = 0;

    while ((startIndex = text.indexOf(term, startIndex)) !== -1) {
      const snippetStart = Math.max(0, startIndex - contextLength);
      const snippetEnd = Math.min(
        text.length,
        startIndex + term.length + contextLength,
      );

      const prefix = snippetStart > 0 ? "..." : "";
      const suffix = snippetEnd < text.length ? "..." : "";

      const snippet =
        `${prefix}${text.slice(snippetStart, snippetEnd)}${suffix}`.replaceAll(
          "\n",
          " ",
        );
      snippets.push(normalizeWhitespace(snippet));

      startIndex += term.length; // Move past the current match
    }
  }

  return snippets;
}

/**
 * Find events that we haven't seen before across all the sites we've checked.
 */
function findNewEvents(newest: EventsResult[], previous: EventsResult[]) {
  return newest.map((site) => {
    // find the matching site from the previous data
    const previousSite = previous.find((prev) => prev.url === site.url);

    const uniqueEvents = !previousSite
      ? site.events
      : // Remove duplicates from the events for this site
        site.events?.filter((event) => {
          // Check if the event is in the previous data
          const isInPrevious = previousSite.events?.some(
            (prevEvent) =>
              prevEvent.name === event.name &&
              prevEvent.date === event.date &&
              prevEvent.detailLink === event.detailLink,
          );
          return !isInPrevious;
        });

    const out = {
      ...site,
      events: uniqueEvents ?? [],
    };
    return out;
  });
}

/**
 * Load the next page of events using the provided selector to determine if the
 * page is loaded.
 */
async function loadNextPage(page: Page, site: Config, loadedSelector: string) {
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
  site: Config,
  previous: Nilable<EventsResult>,
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
  c: Config,
  site: EventsResult,
  spinner: Spinner,
  limit = 5,
  timeout = 10000,
) {
  if (!site.events?.length) {
    spinner.info(`No events found for site ${chalk.yellow(site.url)}`);
    return { site, count: 0, errorCount: 0 };
  }

  const offset = site.events.findIndex((e) => e.relevance == null);
  if (offset == -1) {
    spinner.info(
      `All events already have relevance scores for site ${chalk.yellow(site.url)}`,
    );
    return { site, count: 0, errorCount: 0 };
  }

  const remaining = site.events.length - offset;
  const count = isTwoPageSiteSelector(c.selectors)
    ? Math.min(limit, remaining)
    : remaining;
  const end = offset + count;
  let errorCount = 0;

  spinner.info(
    `Fetching details for events ${chalk.green(offset)} - ${chalk.green(end)} from ${chalk.yellow(site.url)}`,
  );

  for (let index = offset; index < end; index++) {
    const event = site.events?.[index];
    if (!event) throw new Error("Event not found for index " + index);
    if (isTwoPageSiteSelector(c.selectors)) {
      try {
        // Find the selector for the given link.
        const selector = c.selectors.description.find((s) =>
          event.detailLink?.includes(s.domain),
        );

        if (!selector) {
          site.errors = [
            ...(site.errors ?? []),
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
        await page.waitForSelector(selector.selector, { timeout });

        const description = await page.$eval(
          selector.selector,
          (el: Element, selectors) => {
            const out = el.textContent?.trim();
            console.log("selectors", selectors);
            debugger;
            return out;
          },
          c.selectors,
        );

        if (description) {
          event.relevance = determineShowRelevance(description);
          spinner.info(`Retrieved event ${chalk.green(event.name)}`);
          continue;
        } else {
          errorCount++;
          site.errors = [
            ...(site.errors ?? []),
            `No description found for event (${index}) ${event.name} on ${event.date} at ${site.url}`,
          ];
          spinner.fail(
            `No description found for event ${chalk.red(event.name)}`,
          );
          continue;
        }
      } catch (error) {
        errorCount++;
        site.errors = [
          ...(site.errors ?? []),
          `Error fetching event (${index}) ${event.name} on ${event.date} at ${site.url}: ${error}`,
        ];
        spinner.fail(
          `Error fetching event ${chalk.red(event.name)} (see errors below)`,
        );
        continue;
      }
    } else if (event.description) {
      event.relevance = determineShowRelevance(event.description);
    } else {
      errorCount++;
      site.errors = [
        ...(site.errors ?? []),
        `No detail link found for event (${index}) ${event.name} on ${event.date} at ${site.url}`,
      ];
      spinner.fail(`No detail link found for event ${chalk.red(event.name)}`);
      continue;
    }
  }

  return {
    site,
    count,
    errorCount,
  };
}

/**
 * Transfer the relevance scores from the previous data to the new data.
 */
function updateRelevance(sites: EventsResult[], previous: EventsResult[]) {
  for (const site of sites) {
    const previousSite = previous.find((prev) => prev.url === site.url);
    if (!previousSite) continue;

    for (const event of site.events ?? []) {
      const previousEvent = previousSite.events?.find(
        (prevEvent) =>
          prevEvent.name === event.name &&
          prevEvent.date === event.date &&
          prevEvent.detailLink === event.detailLink,
      );
      if (previousEvent) {
        event.relevance = previousEvent.relevance;
      }
    }
  }
}

async function getPreviousData(file: string) {
  try {
    await access(file, constants.F_OK);
    const data = await readFile(file, "utf-8");
    return JSON.parse(data) as EventsResult[];
  } catch (err) {
    return [] as EventsResult[];
  }
}

function countEvents(events: EventsResult[]) {
  return events.reduce((acc, site) => {
    const count = site.events?.length ?? 0;
    return acc + count;
  }, 0);
}

export async function search(
  file: string,
  limit = 5,
  timeout = 10000,
  debug = false,
) {
  console.log(chalk.blue("Starting gig search..."));

  spinner.start("Loading previous gigs");
  const previous = await getPreviousData(file);
  spinner.succeed(`${chalk.green(countEvents(previous))} previous gigs loaded`);

  const browser = await puppeteer.launch({
    headless: !debug,
    devtools: debug,
    protocolTimeout: 1000000,
  });

  // Get the summaries of all events
  const sites: EventsResult[] = [];
  for (const site of config) {
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

  // Transfer the previously discovered relevance scores to the new data.
  // This will also remove any expired events.
  updateRelevance(sites, previous);

  // Calculate the relevance of each new event.
  let detailCount = 0;
  for (const site of sites) {
    const c = config.find((c) => c.url === site.url);

    if (!c) {
      site.errors = [
        ...(site.errors ?? []),
        `Unable to find config for site ${site.url}`,
      ];
      spinner.fail(`Unable to find config for site ${chalk.red(site.url)}`);
      continue;
    }

    const r = await getEventDetails(browser, c, site, spinner, limit, timeout);
    detailCount += r.count;
  }
  spinner.succeed(`${chalk.green(detailCount)} Event details fetched`);

  // Clean up the output
  const sitesToWrite = sites.map((site) => {
    return {
      ...site,
      events: site.events?.map((event) => {
        const out = {
          ...event,
          name: normalizeWhitespace(event.name ?? ""),
          date: normalizeWhitespace(event.date ?? ""),
        };
        // Remove the description because we only needed it temporarily to
        // generate the relevance.
        delete out.description;
        return out;
      }),
    };
  });

  // Find the events that haven't been seen before
  let newEvents = findNewEvents(sitesToWrite, previous);
  spinner.succeed(`${chalk.green(countEvents(newEvents))} new events found`);
  if (debug)
    console.log(util.inspect(newEvents, { colors: true, depth: null }));

  const relevantEvents = sitesToWrite.reduce((acc, site) => {
    return [
      ...(acc ?? []),
      ...(site.events?.filter((e) => e.relevance?.length ?? 0) ?? []).map(
        (e) => ({ ...e, url: site.url }),
      ),
    ];
  }, [] as Event[]);

  if (relevantEvents.length > 0) {
    spinner.succeed(
      `Found ${chalk.green(relevantEvents.length)} relevant events:`,
    );
    console.log(util.inspect(relevantEvents, { colors: true, depth: null }));
  } else {
    spinner.info("No relevant events found");
  }

  // Report any errors
  const errorCount = sitesToWrite.reduce(
    (count, site) => count + (site.errors?.length ?? 0),
    0,
  );
  if (errorCount) {
    spinner.fail(`${chalk.red(errorCount)} errors found`);
    console.log(
      util.inspect(
        sitesToWrite.flatMap((s) => s.errors),
        { colors: true, depth: null },
      ),
    );
  }

  // Write the newest remote results to the file. This should remove any out of
  // date events.
  spinner.start(`Writing results to ${chalk.green(file)}`);
  try {
    await writeFile(file, JSON.stringify(sitesToWrite, null, 2));
    spinner.succeed(`${chalk.green(countEvents(sitesToWrite))} events saved`);
  } catch (e) {
    spinner.fail(`Error writing file`);
    console.error(e);
  }

  // Return the new events so we can notify about them.
  return newEvents;
}
