/**
 * Curated news and advisory feeds. `country` is where the *publishing organisation* is based
 * (its headquarters, or the issuing government for advisories). It is shown as
 * "publisher country", never as the location of the events an article describes.
 * Every entry must be verifiable from the outlet's own "about"/imprint page (`countryRef`).
 */
export interface FeedConfig {
  id: string;
  name: string;
  url: string;
  homepage: string;
  /** Country name as used by the map (Natural Earth names or a known alias). */
  country: string;
  /** Where the publisher's country can be checked. */
  countryRef: string;
  category: 'security-news' | 'advisory' | 'tech-news' | 'ai';
  language: string;
}

export const FEEDS: FeedConfig[] = [
  // Security news
  { id: 'bleepingcomputer', name: 'BleepingComputer', url: 'https://www.bleepingcomputer.com/feed/', homepage: 'https://www.bleepingcomputer.com/', country: 'United States', countryRef: 'https://www.bleepingcomputer.com/about/', category: 'security-news', language: 'en' },
  { id: 'the-record', name: 'The Record by Recorded Future News', url: 'https://therecord.media/feed', homepage: 'https://therecord.media/', country: 'United States', countryRef: 'https://therecord.media/about', category: 'security-news', language: 'en' },
  { id: 'securityweek', name: 'SecurityWeek', url: 'https://www.securityweek.com/feed/', homepage: 'https://www.securityweek.com/', country: 'United States', countryRef: 'https://www.securityweek.com/about-us/', category: 'security-news', language: 'en' },
  { id: 'krebsonsecurity', name: 'Krebs on Security', url: 'https://krebsonsecurity.com/feed/', homepage: 'https://krebsonsecurity.com/', country: 'United States', countryRef: 'https://krebsonsecurity.com/about/', category: 'security-news', language: 'en' },
  { id: 'the-register-security', name: 'The Register — Security', url: 'https://www.theregister.com/security/headlines.atom', homepage: 'https://www.theregister.com/security/', country: 'United Kingdom', countryRef: 'https://www.theregister.com/about/company/', category: 'security-news', language: 'en' },
  { id: 'infosecurity-magazine', name: 'Infosecurity Magazine', url: 'https://www.infosecurity-magazine.com/rss/news/', homepage: 'https://www.infosecurity-magazine.com/', country: 'United Kingdom', countryRef: 'https://www.infosecurity-magazine.com/about-us/', category: 'security-news', language: 'en' },
  { id: 'helpnetsecurity', name: 'Help Net Security', url: 'https://www.helpnetsecurity.com/feed/', homepage: 'https://www.helpnetsecurity.com/', country: 'Croatia', countryRef: 'https://www.helpnetsecurity.com/about-us/', category: 'security-news', language: 'en' },
  { id: 'heise-security', name: 'heise Security', url: 'https://www.heise.de/security/rss/news-atom.xml', homepage: 'https://www.heise.de/security/', country: 'Germany', countryRef: 'https://www.heise.de/impressum.html', category: 'security-news', language: 'de' },
  // Government advisories (country = issuing agency)
  { id: 'cisa-advisories', name: 'CISA Cybersecurity Advisories', url: 'https://www.cisa.gov/cybersecurity-advisories/all.xml', homepage: 'https://www.cisa.gov/news-events/cybersecurity-advisories', country: 'United States', countryRef: 'https://www.cisa.gov/about', category: 'advisory', language: 'en' },
  { id: 'ncsc-uk', name: 'UK National Cyber Security Centre', url: 'https://www.ncsc.gov.uk/api/1/services/v1/all-rss-feed.xml', homepage: 'https://www.ncsc.gov.uk/', country: 'United Kingdom', countryRef: 'https://www.ncsc.gov.uk/section/about-ncsc/what-we-do', category: 'advisory', language: 'en' },
  { id: 'cert-fr', name: 'CERT-FR (ANSSI)', url: 'https://www.cert.ssi.gouv.fr/feed/', homepage: 'https://www.cert.ssi.gouv.fr/', country: 'France', countryRef: 'https://cyber.gouv.fr/', category: 'advisory', language: 'fr' },
  { id: 'cccs', name: 'Canadian Centre for Cyber Security', url: 'https://www.cyber.gc.ca/api/cccs/rss/v1/get?feed=alerts_advisories&lang=en', homepage: 'https://www.cyber.gc.ca/en/alerts-advisories', country: 'Canada', countryRef: 'https://www.cyber.gc.ca/en/about-cyber-centre', category: 'advisory', language: 'en' },
  // Technology and AI
  { id: 'bbc-technology', name: 'BBC News — Technology', url: 'https://feeds.bbci.co.uk/news/technology/rss.xml', homepage: 'https://www.bbc.co.uk/news/technology', country: 'United Kingdom', countryRef: 'https://www.bbc.co.uk/aboutthebbc', category: 'tech-news', language: 'en' },
  { id: 'ars-technica', name: 'Ars Technica — Technology Lab', url: 'https://feeds.arstechnica.com/arstechnica/technology-lab', homepage: 'https://arstechnica.com/', country: 'United States', countryRef: 'https://arstechnica.com/contact-us/', category: 'tech-news', language: 'en' },
  { id: 'golem', name: 'Golem.de', url: 'https://rss.golem.de/rss.php?feed=ATOM1.0', homepage: 'https://www.golem.de/', country: 'Germany', countryRef: 'https://www.golem.de/sonstiges/impressum.html', category: 'tech-news', language: 'de' },
  { id: 'itnews-au', name: 'iTnews', url: 'https://www.itnews.com.au/RSS/rss.ashx', homepage: 'https://www.itnews.com.au/', country: 'Australia', countryRef: 'https://www.itnews.com.au/about-us', category: 'tech-news', language: 'en' },
  { id: 'techcrunch-ai', name: 'TechCrunch — AI', url: 'https://techcrunch.com/category/artificial-intelligence/feed/', homepage: 'https://techcrunch.com/category/artificial-intelligence/', country: 'United States', countryRef: 'https://techcrunch.com/about-techcrunch/', category: 'ai', language: 'en' },
];
