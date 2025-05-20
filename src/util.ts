import { EventsResult, Nilable } from "./types";

/**
 * Replace multiple whitespace characters with a single space and trim it.
 */
export function normalizeWhitespace(input: Nilable<string>): string {
  if (typeof input === "string") {
    return input.replace(/\s+/g, " ").trim();
  } else {
    return "";
  }
}

export function countEvents(events: EventsResult[]) {
  return events.reduce((acc, site) => {
    const count = site.events?.length ?? 0;
    return acc + count;
  }, 0);
}

export function isElementVisible(element: Element): boolean {
  const o = window.getComputedStyle(element).opacity;
  if (typeof o === "string") {
    return parseFloat(o) > 10;
  } else {
    return true;
  }
}

/**
 * Search the given string for the given search terms and return snippets of
 * text that contain those search terms.
 */
export function findTextSnippets(
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
