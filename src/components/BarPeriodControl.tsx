import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useLanguage } from '../lib/language';
import { ViewChoices } from './ViewChoices';
import { useId } from 'react';

export function BarPeriodControl<T extends 'day' | 'week' | 'month' | 'custom'>({
  period, onPeriod, value, onValue, onShift, custom, error, previousDisabled, nextDisabled,
}: {
  period: T; onPeriod: (value: T) => void; value: string;
  onValue: (value: string) => void; onShift: (direction: -1 | 1) => void;
  custom?: { start: string; end: string; onStart: (value: string) => void; onEnd: (value: string) => void };
  error?: string; previousDisabled?: boolean; nextDisabled?: boolean;
}) {
  const { text } = useLanguage();
  const errorId = useId();
  const choices = [
    { value: 'day', label: text('Day', 'Hari') },
    { value: 'week', label: text('Week', 'Minggu') },
    { value: 'month', label: text('Month', 'Bulan') },
    ...(custom ? [{ value: 'custom', label: text('Range', 'Julat') }] : []),
  ];
  return <><div className={`bar-period ${custom ? '' : 'bar-period-short'}`}>
    <ViewChoices label={text('Report Period', 'Tempoh Laporan')} value={period} onChange={next => onPeriod(next as T)} items={choices} />
    {period === 'custom' && custom ? <div className="bar-date-range">
      <label className="grid min-w-0 flex-1 gap-1 text-xs text-muted">{text('From', 'Dari')}<input type="date" aria-label={text('Start Date', 'Tarikh Mula')} aria-invalid={!!error} aria-describedby={error ? errorId : undefined} value={custom.start} onChange={event => custom.onStart(event.target.value)} /></label>
      <label className="grid min-w-0 flex-1 gap-1 text-xs text-muted">{text('To', 'Hingga')}<input type="date" aria-label={text('End Date', 'Tarikh Akhir')} aria-invalid={!!error} aria-describedby={error ? errorId : undefined} value={custom.end} onChange={event => custom.onEnd(event.target.value)} /></label>
    </div> : <div className="bar-date-stepper">
      <button type="button" className="disabled:opacity-40 disabled:cursor-not-allowed" disabled={previousDisabled} aria-label={text('Previous Period', 'Tempoh Sebelumnya')} title={text('Previous Period', 'Tempoh Sebelumnya')} onClick={() => onShift(-1)}><ChevronLeft size={16} /></button>
      <input aria-label={text('Report Date', 'Tarikh Laporan')} aria-invalid={!!error} aria-describedby={error ? errorId : undefined} type={period === 'day' ? 'date' : period === 'week' ? 'week' : 'month'} value={value} onChange={event => { if (event.target.value) onValue(event.target.value); }} />
      <button type="button" className="disabled:opacity-40 disabled:cursor-not-allowed" disabled={nextDisabled} aria-label={text('Next Period', 'Tempoh Seterusnya')} title={text('Next Period', 'Tempoh Seterusnya')} onClick={() => onShift(1)}><ChevronRight size={16} /></button>
    </div>}
  </div>{error ? <p id={errorId} role="alert" className="mb-3 text-sm text-danger">{error}</p> : null}</>;
}
