import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { search } from "./gig-check";

const argv = yargs(hideBin(process.argv))
  .usage("Usage: $0 [options]\n\nCheck available gigs in a specified location.")
  .option("file", {
    alias: "f",
    demandOption: false,
    type: "string",
    default: "./gigs.json",
    normalize: true,
    description:
      "Path to the file containing the list of gigs from previous runs.",
  })
  .option("timeout", {
    alias: "t",
    demandOption: false,
    type: "number",
    default: 10000,
    description:
      "Timeout in milliseconds for the browser to wait for each page to load.",
  })
  .option("limit", {
    alias: "l",
    demandOption: false,
    type: "number",
    default: 5,
    description: "Limit the number of gig details to check for each site.",
  })
  .option("debug", {
    alias: "d",
    demandOption: false,
    type: "boolean",
    description:
      "Disable headless browsing and pausing on debugger statements in the browser code.",
  })
  // .help()
  .parseSync();

(async () => {
  try {
    await search(argv.file, argv.limit, argv.timeout, argv.debug);
    process.exit(0);
  } catch (e) {
    console.error("Error:", e);
    process.exit(1);
  }
})();
