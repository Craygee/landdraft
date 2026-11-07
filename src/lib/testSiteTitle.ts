/**
 * The shared test site runs the same build as landdraft.net, so its browser tabs and bookmarks
 * would otherwise look identical. On the test site's host only, every page title gets a "Test-"
 * prefix. Production hosts never match, so landdraft.net is unchanged.
 */

export const TEST_TITLE_PREFIX = "Test-";

/** The landdraft-test Worker's workers.dev host, e.g. landdraft-test.<account>.workers.dev. */
export function isTestSiteHost(hostname: string) {
  return /^landdraft-test\.[^.]+\.workers\.dev$/i.test(hostname);
}

export function testSiteTitle(title: string) {
  return title.startsWith(TEST_TITLE_PREFIX) ? title : `${TEST_TITLE_PREFIX}${title}`;
}

type TitleDocument = { title: string; head: Node };
type ObserverFactory = (callback: () => void) => Pick<MutationObserver, "observe" | "disconnect">;

/**
 * Prefixes the title now and again whenever the router changes it on navigation.
 * Returns a cleanup function; does nothing (and returns a no-op) off the test site.
 */
export function installTestSiteTitle(
  hostname: string,
  doc: TitleDocument,
  createObserver: ObserverFactory = (callback) => new MutationObserver(callback),
) {
  if (!isTestSiteHost(hostname)) return () => {};
  const apply = () => {
    const next = testSiteTitle(doc.title);
    // Only write when needed, so our own change does not trigger an endless loop.
    if (next !== doc.title) doc.title = next;
  };
  apply();
  const observer = createObserver(apply);
  observer.observe(doc.head, { subtree: true, childList: true, characterData: true });
  return () => observer.disconnect();
}
