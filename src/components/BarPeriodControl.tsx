import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useLanguage } from '../lib/language';
import { ViewChoices } from './ViewChoices';

export function BarPeriodControl<T extends 'day' | 'week' | 'month' | 'custom'>({
  period, onPeriod, value, onValue, onShift, custom,
}: {
  period: T; onPeriod: (value: T) => void; value: string;
  onValue: (value: string) => void; onShift: (direction: -1 | 1) => void;
  custom?: { start: string; end: string; onStart: (value: string) => void; onEnd: (value: string) => void };
}) {
  const { text } = useLanguage();
  const choices = [
    { value: 'day', label: text('Day', 'Hari') },
    { value: 'week', label: text('Week', 'Minggu') },
    { value: 'month', label: text('Month', 'Bulan') },
    ...(custom ? [{ value: 'custom', label: text('Range', 'Julat') }] : []),
  ];
  return <div className={`bar-period ${custom ? '' : 'bar-period-short'}`}>
    <ViewChoices label={text('Report Period', 'Tempoh Laporan')} value={period} onChange={next => onPeriod(next as T)} items={choices} />
    {period === 'custom' && custom ? <div className="bar-date-range">
      <input type="date" aria-label={text('Start Date', 'Tarikh Mula')} value={custom.start} onChange={event => { if (event.target.value) custom.onStart(event.target.value); }} />
      <input type="date" aria-label={text('End Date', 'Tarikh Akhir')} value={custom.end} onChange={event => { if (event.target.value) custom.onEnd(event.target.value); }} />
    </div> : <div className="bar-date-stepper">
      <button type="button" aria-label={text('Previous Period', 'Tempoh Sebelumnya')} title={text('Previous Period', 'Tempoh Sebelumnya')} onClick={() => onShift(-1)}><ChevronLeft size={16} /></button>
      <input aria-label={text('Report Date', 'Tarikh Laporan')} type={period === 'day' ? 'date' : period === 'week' ? 'week' : 'month'} value={value} onChange={event => { if (event.target.value) onValue(event.target.value); }} />
      <button type="button" aria-label={text('Next Period', 'Tempoh Seterusnya')} title={text('Next Period', 'Tempoh Seterusnya')} onClick={() => onShift(1)}><ChevronRight size={16} /></button>
    </div>}
  </div>;
}
