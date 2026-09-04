/**
 * A three-day test dataset: yesterday finished, today half-run, tomorrow
 * still to plan. Around 85-95 guests a day, which is enough load for the
 * boat board, the pickup planner and the capacity limits to behave the way
 * they will in real use.
 *
 * Generated from fixed lists with a seeded shuffle, so the demo looks the
 * same every time it is opened and screenshots stay comparable.
 */
export type AgeBandSeed = 'adult' | 'child' | 'infant' | 'elderly';

const FIRST = [
  'Wei Ming', 'Siew Lan', 'Jun Hao', 'Xin Yi', 'Ah Ma', 'Kok Wah', 'Mei Ling', 'Zi Xuan',
  'Hans', 'Anna', 'Lukas', 'Marie', 'Greta', 'Johan', 'Elke', 'Stefan',
  'Minh', 'Lan', 'Bao', 'Duc', 'Hoa', 'Nam', 'Thuy', 'Khanh',
  'James', 'Emily', 'Oliver', 'Charlotte', 'Harry', 'Sophie', 'Jack', 'Amelia',
  'Ji Woo', 'Seo Yeon', 'Min Jun', 'Ha Eun', 'Do Yun', 'Ye Jin',
  'Aiko', 'Haruto', 'Yuki', 'Sakura', 'Ren', 'Hina',
  'Arun', 'Priya', 'Vikram', 'Divya', 'Rahul', 'Anjali',
  'Nurul', 'Faiz', 'Aisyah', 'Hakim', 'Farah', 'Zul',
  'Pierre', 'Camille', 'Lucas', 'Chloe', 'Hugo', 'Manon',
];

const LAST = [
  'Tan', 'Lim', 'Wong', 'Chen', 'Lee', 'Ng', 'Goh', 'Teo',
  'Schmidt', 'Müller', 'Weber', 'Fischer', 'Becker',
  'Nguyen', 'Tran', 'Pham', 'Vo', 'Le',
  'Walker', 'Brooks', 'Hayes', 'Carter', 'Bennett',
  'Kim', 'Park', 'Choi', 'Jung',
  'Tanaka', 'Sato', 'Suzuki',
  'Sharma', 'Patel', 'Nair',
  'Abdullah', 'Ibrahim', 'Rahman',
  'Dubois', 'Moreau', 'Laurent',
];

const NATIONALITIES = [
  'Malaysian', 'Singaporean', 'German', 'Vietnamese', 'British', 'Korean',
  'Japanese', 'Indian', 'French', 'Australian', 'Chinese', 'Dutch',
];

type SourceSeed = { source: string; agency: string | null; createdBy: string; weight: number };

const SOURCES: SourceSeed[] = [
  { source: 'agent', agency: 'ag-blue', createdBy: 'u-agent-blue', weight: 4 },
  { source: 'agent', agency: 'ag-red', createdBy: 'u-agent-red', weight: 3 },
  { source: 'ota', agency: 'ag-ota', createdBy: 'u-coord', weight: 4 },
  { source: 'in_house', agency: null, createdBy: 'u-coord', weight: 3 },
  { source: 'walk_in', agency: null, createdBy: 'u-coord', weight: 1 },
];

const HOTELS = [
  { id: 'pl-marina', name: 'Hotel Marina Bay', area: 'Marina', lat: 5.41, lng: 100.33, weight: 4 },
  { id: 'pl-suites', name: 'Marina Suites', area: 'Marina', lat: 5.412, lng: 100.331, weight: 3 },
  { id: 'pl-sunset', name: 'Sunset Beach Villa', area: 'Sunset Bay', lat: 5.47, lng: 100.29, weight: 3 },
  { id: 'pl-town', name: 'Town Backpackers', area: 'Old Town', lat: 5.42, lng: 100.34, weight: 3 },
  { id: 'pl-hill', name: 'Hillview Resort', area: 'Hillside', lat: 5.395, lng: 100.305, weight: 2 },
  { id: 'pl-pier', name: 'Pier Lodge', area: 'Jetty', lat: 5.421, lng: 100.341, weight: 2 },
];

// A small deterministic generator: the same dataset every time.
function makeRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

function weighted<T extends { weight: number }>(items: T[], random: () => number): T {
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  let roll = random() * total;
  for (const item of items) {
    roll -= item.weight;
    if (roll <= 0) return item;
  }
  return items[items.length - 1];
}

export type GeneratedBooking = {
  id: string;
  booking_ref: string;
  service_date: string;
  source_type: string;
  agency_id: string | null;
  created_by: string;
  lead_name: string;
  lead_phone: string;
  hotel: (typeof HOTELS)[number];
  pickup_required: boolean;
  people: Array<{ name: string; band: AgeBandSeed; assist: boolean; phone: string | null }>;
};

/** Roughly 85-95 guests, in groups the size real bookings actually come in. */
export function generateDay(date: string, dayIndex: number, targetPax = 88): GeneratedBooking[] {
  const random = makeRandom(9021 + dayIndex * 7717);
  const bookings: GeneratedBooking[] = [];
  let pax = 0;
  let index = 0;

  while (pax < targetPax) {
    index += 1;
    // Couples and small families dominate; the occasional coach party.
    const roll = random();
    const size = roll < 0.28 ? 2 : roll < 0.5 ? 4 : roll < 0.68 ? 3 : roll < 0.82 ? 5 : roll < 0.92 ? 6 : roll < 0.97 ? 8 : 12;
    const source = weighted(SOURCES, random);
    const hotel = weighted(HOTELS, random);
    const surname = LAST[Math.floor(random() * LAST.length)];

    const people = Array.from({ length: size }, (_, personIndex) => {
      const bandRoll = random();
      const band: AgeBandSeed =
        size > 2 && personIndex >= 2 && bandRoll < 0.42
          ? bandRoll < 0.08 ? 'infant' : 'child'
          : bandRoll > 0.93
            ? 'elderly'
            : 'adult';
      return {
        name: `${FIRST[Math.floor(random() * FIRST.length)]} ${surname}`,
        band,
        // Roughly one guest in twenty needs a hand boarding.
        assist: band === 'elderly' ? random() < 0.45 : random() < 0.02,
        phone: personIndex === 0 ? `+60 1${Math.floor(random() * 9)}-${Math.floor(random() * 900 + 100)} ${Math.floor(random() * 9000 + 1000)}` : null,
      };
    });

    bookings.push({
      id: `bk-${dayIndex}-${index}`,
      booking_ref: `LP-${date.replace(/-/g, '').slice(2)}-${String(index).padStart(3, '0')}`,
      service_date: date,
      source_type: source.source,
      agency_id: source.agency,
      created_by: source.createdBy,
      lead_name: size > 4 ? `${surname} Group` : size > 2 ? `${surname} Family` : `${people[0].name}`,
      lead_phone: people[0].phone ?? '',
      hotel,
      // Most guests are collected; some arrange their own way to the jetty.
      pickup_required: random() < 0.72,
      people,
    });
    pax += size;
  }

  return bookings;
}

export const NATIONALITY_FOR = (index: number) => NATIONALITIES[index % NATIONALITIES.length];
