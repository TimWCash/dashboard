import type { Place } from './types';

// Well-known Irish places. Used when no places API key is configured, for quick picks, and in tests.
export interface KnownPlace extends Place {
  id: string;
  group: string;
}

export const PLACES: KnownPlace[] = [
  // Each terminal's taxi rank, so two strangers have one exact place to meet.
  { id: 'dub', group: 'Airports', label: 'Dublin Airport T1 (taxi rank)', lat: 53.4273, lng: -6.2436 },
  { id: 'dub-t2', group: 'Airports', label: 'Dublin Airport T2 (taxi rank)', lat: 53.4265, lng: -6.2389 },
  { id: 'cork-airport', group: 'Airports', label: 'Cork Airport', lat: 51.8472, lng: -8.4911 },
  { id: 'shannon', group: 'Airports', label: 'Shannon Airport', lat: 52.702, lng: -8.9248 },

  { id: 'spire', group: 'Dublin city', label: "O'Connell Street (Spire)", lat: 53.3498, lng: -6.2603 },
  { id: 'trinity', group: 'Dublin city', label: 'Trinity College', lat: 53.3438, lng: -6.2546 },
  { id: 'stephens-green', group: 'Dublin city', label: "St Stephen's Green", lat: 53.3382, lng: -6.2591 },
  { id: 'temple-bar', group: 'Dublin city', label: 'Temple Bar', lat: 53.3454, lng: -6.2644 },
  { id: 'heuston', group: 'Dublin city', label: 'Heuston Station', lat: 53.3462, lng: -6.2925 },
  { id: 'connolly', group: 'Dublin city', label: 'Connolly Station', lat: 53.3518, lng: -6.2497 },
  { id: 'smithfield', group: 'Dublin city', label: 'Smithfield', lat: 53.348, lng: -6.2781 },
  { id: 'grand-canal', group: 'Dublin city', label: 'Grand Canal Dock', lat: 53.3398, lng: -6.2381 },
  { id: '3arena', group: 'Dublin city', label: '3Arena', lat: 53.3475, lng: -6.2285 },
  { id: 'aviva', group: 'Dublin city', label: 'Aviva Stadium', lat: 53.3352, lng: -6.2285 },
  { id: 'croke-park', group: 'Dublin city', label: 'Croke Park', lat: 53.3607, lng: -6.2511 },

  { id: 'ranelagh', group: 'Dublin suburbs', label: 'Ranelagh', lat: 53.3262, lng: -6.2564 },
  { id: 'rathmines', group: 'Dublin suburbs', label: 'Rathmines', lat: 53.322, lng: -6.265 },
  { id: 'drumcondra', group: 'Dublin suburbs', label: 'Drumcondra', lat: 53.3697, lng: -6.259 },
  { id: 'dcu', group: 'Dublin suburbs', label: 'DCU Glasnevin', lat: 53.3853, lng: -6.2566 },
  { id: 'ucd', group: 'Dublin suburbs', label: 'UCD Belfield', lat: 53.307, lng: -6.223 },
  { id: 'dundrum', group: 'Dublin suburbs', label: 'Dundrum', lat: 53.2869, lng: -6.2416 },
  { id: 'sandyford', group: 'Dublin suburbs', label: 'Sandyford', lat: 53.2767, lng: -6.22 },
  { id: 'dun-laoghaire', group: 'Dublin suburbs', label: 'Dún Laoghaire', lat: 53.294, lng: -6.134 },
  { id: 'swords', group: 'Dublin suburbs', label: 'Swords', lat: 53.4597, lng: -6.2181 },
  { id: 'blanchardstown', group: 'Dublin suburbs', label: 'Blanchardstown', lat: 53.3925, lng: -6.392 },
  { id: 'tallaght', group: 'Dublin suburbs', label: 'Tallaght', lat: 53.2876, lng: -6.373 },
  { id: 'howth', group: 'Dublin suburbs', label: 'Howth', lat: 53.3875, lng: -6.066 },

  { id: 'cork-city', group: 'Cork', label: 'Cork city (Patrick St)', lat: 51.8985, lng: -8.474 },
  { id: 'kent', group: 'Cork', label: 'Kent Station', lat: 51.9017, lng: -8.4583 },
  { id: 'ucc', group: 'Cork', label: 'UCC', lat: 51.893, lng: -8.492 },

  { id: 'eyre-square', group: 'Galway', label: 'Eyre Square', lat: 53.2745, lng: -9.049 },
  { id: 'salthill', group: 'Galway', label: 'Salthill', lat: 53.259, lng: -9.078 },
  { id: 'uni-galway', group: 'Galway', label: 'University of Galway', lat: 53.279, lng: -9.061 },

  { id: 'limerick', group: 'Limerick', label: "Limerick (O'Connell St)", lat: 52.6617, lng: -8.63 },
  { id: 'ul', group: 'Limerick', label: 'University of Limerick', lat: 52.6739, lng: -8.5717 },
];

export const placeById = (id: string) => PLACES.find((p) => p.id === id);

const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

// Simple offline search over the known places, best matches first.
export function searchKnownPlaces(query: string, limit = 8): KnownPlace[] {
  const q = fold(query.trim());
  if (!q) return PLACES.slice(0, limit);
  return PLACES.map((p) => {
    const label = fold(p.label);
    const score = label.startsWith(q) ? 0 : label.split(/[\s(]+/).some((w) => w.startsWith(q)) ? 1 : label.includes(q) ? 2 : fold(p.group).includes(q) ? 3 : 9;
    return { p, score };
  })
    .filter((x) => x.score < 9)
    .sort((a, b) => a.score - b.score)
    .slice(0, limit)
    .map((x) => x.p);
}
