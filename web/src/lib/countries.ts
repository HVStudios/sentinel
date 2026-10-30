/**
 * Maps country names as written by sources (e.g. GDELT `sourcecountry`) to the names used by
 * Natural Earth / world-atlas 1:110m. Names not present at that scale (small states such as
 * Singapore or Malta) stay unmapped and are reported to the user instead of being guessed.
 */
const ALIASES: Record<string, string> = {
  'united states': 'United States of America',
  usa: 'United States of America',
  us: 'United States of America',
  'czech republic': 'Czechia',
  'bosnia and herzegovina': 'Bosnia and Herz.',
  'bosnia-herzegovina': 'Bosnia and Herz.',
  'democratic republic of the congo': 'Dem. Rep. Congo',
  'congo, democratic republic of the': 'Dem. Rep. Congo',
  'republic of the congo': 'Congo',
  'central african republic': 'Central African Rep.',
  'dominican republic': 'Dominican Rep.',
  'equatorial guinea': 'Eq. Guinea',
  'south sudan': 'S. Sudan',
  'ivory coast': "Côte d'Ivoire",
  "cote d'ivoire": "Côte d'Ivoire",
  'north macedonia': 'Macedonia',
  swaziland: 'eSwatini',
  eswatini: 'eSwatini',
  'east timor': 'Timor-Leste',
  burma: 'Myanmar',
  'korea, south': 'South Korea',
  'republic of korea': 'South Korea',
  'korea, north': 'North Korea',
  "democratic people's republic of korea": 'North Korea',
  'russian federation': 'Russia',
  'falkland islands': 'Falkland Is.',
  'solomon islands': 'Solomon Is.',
  'western sahara': 'W. Sahara',
  'occupied palestinian territory': 'Palestine',
  'gaza strip': 'Palestine',
  'west bank': 'Palestine',
  turkiye: 'Turkey',
  'türkiye': 'Turkey',
  'viet nam': 'Vietnam',
  'lao pdr': 'Laos',
  "lao people's democratic republic": 'Laos',
  'syrian arab republic': 'Syria',
  'iran, islamic republic of': 'Iran',
  'united republic of tanzania': 'Tanzania',
  'bahamas, the': 'Bahamas',
  'gambia, the': 'Gambia',
};

export function createCountryResolver(atlasNames: Iterable<string>) {
  const byLower = new Map<string, string>();
  for (const name of atlasNames) byLower.set(name.toLowerCase(), name);
  return (sourceName: string): string | null => {
    const key = sourceName.trim().toLowerCase();
    if (byLower.has(key)) return byLower.get(key)!;
    const alias = ALIASES[key];
    return alias && byLower.has(alias.toLowerCase()) ? alias : null;
  };
}
