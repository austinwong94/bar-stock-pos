import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { todayIso } from '../lib/opsData';
import { useLanguage } from '../lib/language';
import { sheetDateLabel, shiftSheetDate, sheetWeekStart } from '../lib/bookingSheetView';
import '../service-date.css';

type Props = {
  date: string;
  onDate: (date: string) => void;
  period?: 'day' | 'week';
  onPeriod?: (period: 'day' | 'week') => void;
  disabled?: boolean;
  allDates?: boolean;
};

export function BookingDateNavigation({ date, onDate, period = 'day', onPeriod, disabled = false, allDates = false }: Props) {
  const { text: t } = useLanguage();
  const ref = useRef<HTMLElement>(null);
  const [anchor, setAnchor] = useState(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem('service-date-window') || 'null');
      if (saved?.today === todayIso() && /^\d{4}-\d{2}-\d{2}$/.test(saved.anchor) && saved.anchor <= date && date <= shiftSheetDate(saved.anchor, 6)) return saved.anchor as string;
    } catch { /* Navigation also works without stored preferences. */ }
    return date >= todayIso() && date <= shiftSheetDate(todayIso(), 6) ? todayIso() : date;
  });
  const start = period === 'week' ? sheetWeekStart(date) : date < anchor || date > shiftSheetDate(anchor, 6) ? date : anchor;

  useEffect(() => {
    setAnchor(start);
    try { sessionStorage.setItem('service-date-window', JSON.stringify({ anchor: start, today: todayIso() })); } catch { /* This is a tab-local view preference. */ }
  }, [start]);

  // The sheet toolbar sticks below this bar, including after resizing.
  useLayoutEffect(() => {
    const element = ref.current, parent = element?.parentElement;
    if (!element || !parent) return;
    const update = () => parent.style.setProperty('--service-date-height', `${element.getBoundingClientRect().height}px`);
    const observer = new ResizeObserver(update);
    observer.observe(element); update();
    return () => { observer.disconnect(); parent.style.removeProperty('--service-date-height'); };
  }, []);

  function moveWeek(offset: number) {
    setAnchor(shiftSheetDate(start, offset));
    onDate(shiftSheetDate(date, offset));
  }

  return <section ref={ref} className="service-date-navigation no-print" aria-label="Service Date Navigation">
    <div className="service-date-heading">
      {onPeriod ? <div className="service-date-period" role="group" aria-label="Booking Period">
        {(['day', 'week'] as const).map(value => <button type="button" key={value} disabled={disabled} aria-pressed={period === value} onClick={() => onPeriod(value)}>{value === 'day' ? t('Daily', 'Harian') : t('Weekly', 'Mingguan')}</button>)}
      </div> : <span className="service-date-label">{allDates ? t('All Dates', 'Semua Tarikh') : t('Service Date', 'Tarikh Lawatan')}</span>}
      <div className="service-date-jump">
        <input aria-label="Service Date" title={t('Service Date', 'Tarikh Lawatan')} type="date" value={date} disabled={disabled} onChange={event => { if (event.target.value) onDate(event.target.value); }} />
        <button type="button" className="service-date-today" title={t('Today', 'Hari Ini')} aria-label="Today" disabled={disabled} onClick={() => { setAnchor(todayIso()); onDate(todayIso()); }}>{t('Today', 'Hari Ini')}</button>
      </div>
    </div>
    <div className="service-date-week">
      <button type="button" className="service-date-icon" title={t('Previous Seven Days', 'Tujuh Hari Sebelumnya')} aria-label="Previous Seven Days" disabled={disabled} onClick={() => moveWeek(-7)}><ChevronLeft size={17} /></button>
      <div className="service-date-tabs" role="group" aria-label="Seven Days">
        {Array.from({ length: 7 }, (_, index) => {
          const day = shiftSheetDate(start, index);
          const active = !allDates && (period === 'day' ? date === day : sheetWeekStart(day) === sheetWeekStart(date));
          return <button type="button" key={day} disabled={disabled} aria-label={sheetDateLabel(day, 'EEEE, d MMMM yyyy')} title={sheetDateLabel(day, 'EEEE, d MMMM yyyy')} aria-pressed={active} aria-current={!allDates && date === day ? 'date' : undefined} className={!allDates && date === day ? 'date-focused' : ''} onClick={() => onDate(day)}>
            <span>{sheetDateLabel(day, 'EEE')}</span><strong><span>{sheetDateLabel(day, 'd')}</span><span className="service-date-month"> {sheetDateLabel(day, 'MMM')}</span></strong>
          </button>;
        })}
      </div>
      <button type="button" className="service-date-icon" title={t('Next Seven Days', 'Tujuh Hari Seterusnya')} aria-label="Next Seven Days" disabled={disabled} onClick={() => moveWeek(7)}><ChevronRight size={17} /></button>
    </div>
  </section>;
}
