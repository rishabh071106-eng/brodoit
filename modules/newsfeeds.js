// Brodoit news sources — the RSS feeds behind the News tab, in one place.
//   server.js:  const NEWS_FEEDS = require('./modules/newsfeeds.js');
// Same shape as before: { tech, science, world, india, business } (arrays of feed URLs), v28 ai (its own list), plus the
// aliases technology / global. Extra helpers (SOURCE_NAMES, verify) are non-enumerable so
// `NEWS_FEEDS[cat]` lookups and key iteration in server.js see only the categories.
//
// Changes vs the old inline table (2026-10-18):
//   - feeds.reuters.com removed: Reuters stopped its public feeds in June 2020; the host no longer resolves.
//   - india gains NDTV (official FeedBurner feed, as listed on ndtv.com/rss) and Hindustan Times; drops Times of India.
//   - world gains The Guardian and Al Jazeera (both publisher-documented feeds); keeps BBC, NPR, NYT.
//   - tech: The Verge, TechCrunch (AI desk), Ars Technica, Wired, MIT Technology Review; VentureBeat dropped.
//   - business: Mint markets + companies, Economic Times, BBC Business, The Guardian Business (no paywalled FT/WSJ).
//   - science: BBC, Nature, ScienceDaily, Phys.org, The Guardian Science.
// v27 (2026-10-31): official, primary sources next to the newspapers, so a story can stand on the original
// announcement: the Reserve Bank of India, the UN, the WHO and NASA (checked from GitHub's runners on 31 Oct: all
// answer with items). The Press Information Bureau's feed answers only in Hindi whatever the Lang setting, and the
// desk writes from English reports, so it is not listed. The app marks a story backed by an official source.
//
// Verification note: the build sandbox's egress proxy answers 403 to every news host, so these URLs could not be
// curl-checked from there. Each one is the publisher's documented feed (its own RSS page, or the path already in
// production for months). To check them from a machine with open internet:
//   node -e "require('./modules/newsfeeds.js').verify()"
// which prints HTTP status, content type and item count per feed and exits non-zero if any feed is dead.
'use strict';

const NEWS_FEEDS = {
  india: [
    'https://www.thehindu.com/news/national/feeder/default.rss',       // The Hindu · National (thehindu.com/rssfeeds)
    'https://indianexpress.com/section/india/feed/',                    // Indian Express · India section
    'https://feeds.feedburner.com/ndtvnews-top-stories',                // NDTV · Top stories (ndtv.com/rss)
    'https://www.hindustantimes.com/feeds/rss/india-news/rssfeed.xml',  // Hindustan Times · India (hindustantimes.com/rss)
    'https://www.livemint.com/rss/news',                                // Mint · News
    'https://feeds.bbci.co.uk/news/world/asia/india/rss.xml',           // BBC · India
  ],
  world: [
    'https://feeds.bbci.co.uk/news/world/rss.xml',                      // BBC · World
    'https://www.theguardian.com/world/rss',                            // The Guardian · World (any section + /rss)
    'https://www.aljazeera.com/xml/rss/all.xml',                        // Al Jazeera English · All
    'https://feeds.npr.org/1004/rss.xml',                               // NPR · World
    'https://rss.nytimes.com/services/xml/rss/nyt/World.xml',           // The New York Times · World
    'https://news.un.org/feed/subscribe/en/news/all/rss.xml',           // UN News · All (official)
    'https://www.who.int/rss-feeds/news-english.xml',                   // WHO · News (official)
  ],
  // v28 (2026-10-31): AI is its own section. The labs' own announcements first (primary sources: what they released, in
  // their words), then the AI desks of the tech press and India's AI press. All checked from GitHub's runners on 31 Oct
  // (each answers with items dated this week). Microsoft (410), Anthropic and Meta (no feed), VentureBeat (429) are not.
  ai: [
    'https://openai.com/news/rss.xml',                                  // OpenAI · News (primary)
    'https://deepmind.google/blog/rss.xml',                             // Google DeepMind · Blog (primary)
    'https://blog.google/technology/ai/rss/',                           // Google · AI (primary)
    'https://huggingface.co/blog/feed.xml',                             // Hugging Face · Blog (primary)
    'https://blogs.nvidia.com/feed/',                                   // NVIDIA · Blog (primary)
    'https://news.mit.edu/topic/mitartificial-intelligence2-rss.xml',   // MIT News · Artificial intelligence
    'https://techcrunch.com/category/artificial-intelligence/feed/',    // TechCrunch · AI
    'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml', // The Verge · AI
    'https://arstechnica.com/ai/feed/',                                 // Ars Technica · AI
    'https://www.technologyreview.com/topic/artificial-intelligence/feed', // MIT Technology Review · AI
    'https://analyticsindiamag.com/feed/',                              // Analytics India Magazine (India's AI industry)
  ],
  tech: [
    'https://www.theverge.com/rss/index.xml',                           // The Verge · All
    'https://feeds.arstechnica.com/arstechnica/index',                  // Ars Technica · All
    'https://www.wired.com/feed/rss',                                   // Wired · Top stories
    'https://www.technologyreview.com/feed/',                           // MIT Technology Review
  ],
  business: [
    'https://www.livemint.com/rss/markets',                             // Mint · Markets
    'https://www.livemint.com/rss/companies',                           // Mint · Companies
    'https://economictimes.indiatimes.com/rssfeedstopstories.cms',      // The Economic Times · Top stories
    'https://feeds.bbci.co.uk/news/business/rss.xml',                   // BBC · Business
    'https://www.theguardian.com/business/rss',                         // The Guardian · Business
    'https://www.rbi.org.in/pressreleases_rss.xml',                     // Reserve Bank of India · Press releases (official)
  ],
  science: [
    'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml',    // BBC · Science & Environment
    'https://www.nature.com/nature.rss',                                // Nature · News
    'https://www.sciencedaily.com/rss/top/science.xml',                 // ScienceDaily · Top science (sciencedaily.com/newsfeeds.htm)
    'https://phys.org/rss-feed/breaking/',                              // Phys.org · Breaking
    'https://www.theguardian.com/science/rss',                          // The Guardian · Science
    'https://www.nasa.gov/news-release/feed/',                          // NASA · News releases (official)
  ],
};
NEWS_FEEDS.technology = NEWS_FEEDS.tech;
NEWS_FEEDS.global = NEWS_FEEDS.world;

// Hostname label → display name. Used by the reader (site fallback) and mirrored in app/news.js for story rows.
const SOURCE_NAMES = {
  thehindu: 'The Hindu', indianexpress: 'Indian Express', ndtv: 'NDTV', hindustantimes: 'Hindustan Times', livemint: 'Mint',
  economictimes: 'The Economic Times', timesofindia: 'Times of India', bbc: 'BBC', bbci: 'BBC', theguardian: 'The Guardian',
  aljazeera: 'Al Jazeera', npr: 'NPR', nytimes: 'The New York Times', theverge: 'The Verge', techcrunch: 'TechCrunch',
  arstechnica: 'Ars Technica', wired: 'Wired', technologyreview: 'MIT Technology Review', nature: 'Nature',
  sciencedaily: 'ScienceDaily', phys: 'Phys.org', openai: 'OpenAI', deepmind: 'Google DeepMind', huggingface: 'Hugging Face', nvidia: 'NVIDIA', mit: 'MIT News', analyticsindiamag: 'Analytics India Magazine', pib: 'PIB (Government of India)', rbi: 'Reserve Bank of India', un: 'UN News', who: 'WHO', nasa: 'NASA', reuters: 'Reuters', apnews: 'AP', venturebeat: 'VentureBeat', newscientist: 'New Scientist',
};

// Fetch every feed once and print a line per URL. Resolves to the list of failures.
async function verify(opts) {
  const timeout = (opts && opts.timeout) || 15000;
  const urls = [...new Set(['india', 'world', 'ai', 'tech', 'business', 'science'].flatMap(k => NEWS_FEEDS[k]))];
  const failures = [];
  for (const url of urls) {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), timeout);
    let line;
    try {
      const r = await fetch(url, { signal: ctrl.signal, redirect: 'follow', headers: { 'User-Agent': 'Brodoit/1.0 (+https://brodoit.com)', Accept: 'application/rss+xml,application/atom+xml,application/xml,text/xml,*/*' } });
      const text = await r.text();
      const items = (text.match(/<item[\s>]|<entry[\s>]/g) || []).length;
      const xml = /^\s*(<\?xml|<rss|<feed|<rdf)/i.test(text);
      const ok = r.ok && xml && items > 0;
      if (!ok) failures.push(url);
      line = `${ok ? 'OK  ' : 'FAIL'} ${r.status} ${String(r.headers.get('content-type') || '').split(';')[0].padEnd(24)} items=${String(items).padStart(3)} ${url}`;
    } catch (e) { failures.push(url); line = `FAIL --- ${String(e.message).slice(0, 40).padEnd(24)} items=  0 ${url}`; }
    finally { clearTimeout(t); }
    console.log(line);
  }
  console.log(failures.length ? `\n${failures.length} feed(s) failed` : '\nall feeds OK');
  if (require.main === module || (opts && opts.exit)) process.exitCode = failures.length ? 1 : 0;
  return failures;
}

Object.defineProperty(NEWS_FEEDS, 'SOURCE_NAMES', { value: SOURCE_NAMES, enumerable: false });
Object.defineProperty(NEWS_FEEDS, 'verify', { value: verify, enumerable: false });
module.exports = NEWS_FEEDS;

if (require.main === module) verify({ exit: true });
