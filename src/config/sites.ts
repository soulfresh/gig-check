import { WebsiteConfig } from "../types";

export const websiteConfig: Record<string, WebsiteConfig> = {
  commetPingPong: {
    url: "https://www.cometpingpong.com/livemusic",
    selectors: {
      event: "article",
      date: "time",
      name: ".dice_event-title",
    },
  },
  quarryHouseTavern: {
    url: "https://www.quarryhousetavern.com/music",
    selectors: {
      event: "article",
      date: "time",
      name: ".dice_event-title",
    },
  },
  unionStage: {
    url: "https://www.unionstagepresents.com",
    selectors: {
      event: "[data-venue]",
      date: ".date",
      name: "a h4",
      detailLink: ".card-body > a",
      description: [
        {
          domain: "unionstagepresents.com",
          description: ".about-show",
        },
        {
          domain: "ticketweb.com",
          description: ".event-detail",
        },
        {
          domain: "eventbrite.com",
          description: ".event-details",
        },
      ],
    },
  },
  madamsOrgan: {
    url: "https://www.madamsorgan.com/events/",
    selectors: {
      event: "article",
      date: ".mec-date-details",
      name: ".mec-event-title",
      detailLink: ".mec-booking-button",
      loadMoreLink: ".mec-load-more-button",
      description: [
        {
          domain: "madamsorgan.com",
          description: "article",
        },
      ],
    },
  },
  ramsHead: {
    url: "https://www.ramsheadonstage.com/events",
    selectors: {
      event: "#eventsList .entry",
      name: ".title",
      date: ".date",
      detailLink: ".title a",
      loadMoreLink: "#loadMoreEvents",
      description: [
        {
          domain: "ramsheadonstage.com",
          description: ".event_detail",
        },
      ],
    },
  },
  dc9: {
    // TODO The details page contains a lineup list where each artist has a link
    // to the artist bio. Will need to click into the bio to get their
    // description.
    url: "https://dc9.club/events/",
    selectors: {
      event: ".listing__details",
      name: ".listing__title",
      date: ".listingDateTime",
      detailLink: ".listing__titleLink",
      loadMoreLink: "a.pagination-next",
      loadMoreLoader: ".listings-block .loading",
      description: [
        {
          domain: "dc9.club",
          description: "section.singleListing",
          lineup: ".artistBlock a",
          artistDescription: ".artist",
        },
      ],
    },
  },
  // songbyrd
  // 9:30
  // blackcat
  // hank dietle's tavern
};
