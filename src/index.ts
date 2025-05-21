import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { config as moongold } from "./config/moongold";
import { websiteConfig } from "./config/sites";
import { list, search } from "./gig-check";
import { BandBaseConfiguration } from "./types";

function configFactory(band: BandBaseConfiguration) {
  return {
    ...band,
    websiteConfigs: band.sites
      .map((website) => {
        const site = websiteConfig[website];
        if (!site)
          console.warn(
            `Unable to find ${band.name} website config for ${website}`,
          );
        return site;
      })
      .filter((c) => !!c),
  };
}

/**
 * Load the config for the specified band.
 */
function getBandConfig(band: string) {
  switch (band) {
    case "moongold":
      return configFactory(moongold);
    default:
      throw new Error(`No config found for band ${band}`);
  }
}

yargs(hideBin(process.argv))
  .usage("Usage: $0 <command> [options]")
  .command(
    ["search <band>", "$0"],
    "Search for interesting events.",
    (yargs) => {
      return yargs
        .positional("band", {
          describe: "The name of the band to search for.",
          type: "string",
          demandOption: true,
          required: true,
        })
        .option("file", {
          alias: "f",
          type: "string",
          default: "./gigs.json",
          description: "Path to the file containing the list of gigs.",
        })
        .option("timeout", {
          alias: "t",
          type: "number",
          default: 10000,
          description: "Timeout in milliseconds for page loads.",
        })
        .option("limit", {
          alias: "l",
          type: "number",
          default: 40,
          description: "Limit the number of gig details to check.",
        })
        .option("debug", {
          alias: "d",
          type: "boolean",
          description: "Enable debug mode (non-headless browsing).",
        });
    },
    async (argv) => {
      try {
        const config = getBandConfig(argv.band);
        await search(config, argv.file, argv.limit, argv.timeout, argv.debug);
        process.exit(0);
      } catch (e) {
        console.error("Error:", e);
        process.exit(1);
      }
    },
  )
  .command(
    "list <band>",
    "List relevant events from previous runs.",
    (yargs) => {
      return yargs
        .positional("band", {
          describe: "The name of the band to list events for.",
          type: "string",
          demandOption: true,
          required: true,
        })
        .option("file", {
          alias: "f",
          type: "string",
          default: "./gigs.json",
          description: "Path to the file containing the list of gigs.",
        });
    },
    (argv) => {
      try {
        const config = getBandConfig(argv.band);
        list(config, argv.file);
      } catch (e) {
        console.error("Error:", e);
        process.exit(1);
      }
    },
  )
  .demandCommand(1, "You need to specify at least one command.")
  .help()
  .parse();

// const argv = yargs(hideBin(process.argv))
//   .usage("Usage: $0 [options]\n\nCheck available gigs in a specified location.")
//   .option("band", {
//     alias: "b",
//     demandOption: true,
//     type: "string",
//     description:
//       "The name of the band to search for. This must match the name of a band file in the config folder.",
//   })
//   .option("file", {
//     alias: "f",
//     demandOption: false,
//     type: "string",
//     default: "./gigs.json",
//     normalize: true,
//     description:
//       "Path to the file containing the list of gigs from previous runs.",
//   })
//   .option("timeout", {
//     alias: "t",
//     demandOption: false,
//     type: "number",
//     default: 10000,
//     description:
//       "Timeout in milliseconds for the browser to wait for each page to load.",
//   })
//   .option("limit", {
//     alias: "l",
//     demandOption: false,
//     type: "number",
//     default: 40,
//     description: "Limit the number of gig details to check for each site.",
//   })
//   .option("debug", {
//     alias: "d",
//     demandOption: false,
//     type: "boolean",
//     description:
//       "Disable headless browsing and pausing on debugger statements in the browser code.",
//   })
//   // .help()
//   .parseSync();
//
// (async () => {
//   try {
//     const config = getBandConfig(argv.band);
//     await search(config, argv.file, argv.limit, argv.timeout, argv.debug);
//     process.exit(0);
//   } catch (e) {
//     console.error("Error:", e);
//     process.exit(1);
//   }
// })();
