import type { Booking } from '../lib/platformTypes';
import { useLanguage } from '../lib/language';

type PassengerCounts = Pick<Booking, 'pax_adults' | 'pax_children' | 'pax_elderly' | 'pax_assisted' | 'pax_infants' | 'pax_tour_leaders' | 'pax_tour_guides'>;

export default function PassengerBreakdown({ counts }: { counts: PassengerCounts }) {
  const { text: t } = useLanguage();
  const groups = [
    { key: 'adults', count: counts.pax_adults + (counts.pax_elderly || 0), label: t(counts.pax_adults + (counts.pax_elderly || 0) === 1 ? 'Adult' : 'Adults', 'Dewasa') },
    { key: 'children', count: counts.pax_children, label: t(counts.pax_children === 1 ? 'Child' : 'Children', 'Kanak-kanak') },
    { key: 'infants', count: counts.pax_infants || 0, label: t('Infant', 'Bayi') },
    { key: 'tour_leaders', count: counts.pax_tour_leaders || 0, label: t('TL (Local)', 'TL (Tempatan)') },
    { key: 'tour_guides', count: counts.pax_tour_guides || 0, label: t('TG (China)', 'TG (China)') },
  ];
  return (
    <div data-passenger-breakdown className="min-w-0 text-xs leading-5">
      <div className="flex flex-wrap gap-x-3 gap-y-0.5" aria-label={t('Passenger Breakdown', 'Pecahan Penumpang')}>
        {groups.filter(group => ['adults','children'].includes(group.key) || group.count > 0).map(group => (
          <span key={group.key} data-passenger-kind={group.key} className="whitespace-nowrap text-muted">
            <strong className="font-semibold tabular text-ink">{group.count}</strong> {group.label}
          </span>
        ))}
      </div>
      {counts.pax_assisted > 0 ? (
        <p data-passenger-kind="assistance" className="text-alert">
          <strong className="font-semibold tabular">{counts.pax_assisted}</strong> {t('Needs Assistance (Included)', 'Perlu Bantuan (Termasuk)')}
        </p>
      ) : null}
    </div>
  );
}
