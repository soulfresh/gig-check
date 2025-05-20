import chalk from "chalk";
import { constants } from "fs";
import { access, readFile, writeFile } from "fs/promises";
import util from "node:util";
import puppeteer from "puppeteer";

import type { Event, BandConfig, EventsResult } from "./types";
import { getRelevanceForEvents, loadAllEventSummaries } from "./scraper";
import { countEvents, normalizeWhitespace } from "./util";
import { spinner } from "./spinner";

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
        event.errors = previousEvent.errors;
        // } else {
        //   console.log("unable to find previous event for ", event);
      }
    }
  }
}

/**
 * Load the data containing the gig data from previous runs.
 */
async function getPreviousData(file: string) {
  spinner.start("Loading previous gigs");
  let previous: EventsResult[] = [];
  try {
    await access(file, constants.F_OK);
    const data = await readFile(file, "utf-8");
    previous = JSON.parse(data) as EventsResult[];
  } catch (err) {
    previous = [] as EventsResult[];
  }

  spinner.succeed(`${chalk.green(countEvents(previous))} previous gigs loaded`);
  return previous;
}

function cleanUpEventSummary(event: Event) {
  return {
    ...event,
    name: normalizeWhitespace(event.name ?? ""),
    date: normalizeWhitespace(event.date ?? ""),
  };
}

/**
 * Clean up the event summar so that event fields can be matched against the
 * previous run. This is because we need to compare things like the event
 * name and date which may contain extra whitespace or other formatting that
 * we remove before writing the event data. This is easier to do in the node
 * thread so we don't have to pass a function to the browser context.
 */
function cleanUpEventSummaries(sites: EventsResult[]) {
  return sites.map((site) => {
    return {
      ...site,
      events: site.events?.map((event) => {
        return cleanUpEventSummary(event);
      }),
    };
  });
}

/**
 * Remove intermediary data from the events before they are written to storage.
 * This includes removing the description field and normalizing the whitespace.
 */
function cleanUpEventsToWrite(sites: EventsResult[]) {
  return sites.map((site) => {
    return {
      ...site,
      events: site.events?.map((event) => {
        const out = cleanUpEventSummary(event);
        // Remove the description because we only needed it temporarily to
        // generate the relevance.
        delete out.description;
        return out;
      }),
    };
  });
}

/**
 * Compare the new sites to the previous sites and find any new events that
 * have are relevant to this band's genres.
 */
function determineNewEventsFound(
  sitesToWrite: EventsResult[],
  previous: EventsResult[],
  debug: boolean,
) {
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
  return newEvents;
}

/**
 * Report on any errors that were found while loading the events.
 */
function reportErrors(sitesToWrite: EventsResult[]) {
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
}

/**
 * Save the events retrieved to the specified file.
 */
async function saveEvents(sitesToWrite: EventsResult[], file: string) {
  spinner.start(`Writing results to ${chalk.green(file)}`);
  try {
    await writeFile(file, JSON.stringify(sitesToWrite, null, 2));
    spinner.succeed(`${chalk.green(countEvents(sitesToWrite))} events saved`);
  } catch (e) {
    spinner.fail(`Error writing file`);
    console.error(e);
  }
}

/**
 * Find new events for a band.
 */
export async function search(
  band: BandConfig,
  file: string,
  limit = 5,
  timeout = 10000,
  debug = false,
) {
  console.log(chalk.blue("Starting gig search..."));
  console.log(
    util.inspect(
      { band: band.name, sites: band.sites, file, limit, timeout },
      { colors: true, depth: null },
    ),
  );

  // Get the data from the previous runs.
  const previous = await getPreviousData(file);

  const browser = await puppeteer.launch({
    headless: !debug,
    devtools: debug,
    protocolTimeout: 1000000,
  });

  // Get the summaries of all events
  const sites = await loadAllEventSummaries(
    band.websiteConfigs,
    previous,
    browser,
    timeout,
  );

  // Clean up the event summar so that event fields can be matched against the
  // previous run. This is because we need to compare things like the event
  // name and date which may contain extra whitespace or other formatting that
  // we remove before writing the event data.
  // TODO Pass some utility functions like trimWhitespace to the browser context
  // so we can do this in the browser.
  // const sites = cleanUpEventSummaries(rawEvents);

  // Transfer the previously discovered relevance scores to the new data.
  // This will also remove any expired events.
  updateRelevance(sites, previous);

  // Calculate the relevance of any events that don't have that data yet (ie.
  // new events we just found and any events that were skipped on the last run
  // due to the limit or errors)
  await getRelevanceForEvents(sites, band, browser, limit, timeout);

  // Clean up the output
  const sitesToWrite = cleanUpEventsToWrite(sites);

  // Find the events that haven't been seen before
  const newEvents = determineNewEventsFound(sitesToWrite, previous, debug);

  // Report any errors
  reportErrors(sitesToWrite);

  // Write the newest remote results to the file. This should remove any out of
  // date events.
  await saveEvents(sitesToWrite, file);

  // Return the new events so we can notify about them.
  return newEvents;
}
