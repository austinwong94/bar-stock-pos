import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { CircleHelp, ZoomIn } from 'lucide-react';
import { Modal } from './Modal';
import { iconButtonClass } from './Form';
import { useLanguage } from '../lib/language';
import { barGuide, kitchenGuide, type GuideLanguage } from '../lib/workflowGuides';

export function WorkflowHelp({ area }: { area: 'kitchen' | 'bar' }) {
  const { language, text } = useLanguage();
  const location = useLocation();
  const topics = area === 'kitchen' ? kitchenGuide : barGuide;
  const [open, setOpen] = useState(false);
  const [zoom, setZoom] = useState(false);
  const [locale, setLocale] = useState<GuideLanguage>(language);
  const [selected, setSelected] = useState(topics[0].id);
  const title = area === 'kitchen' ? text('Kitchen Guide', 'Panduan Dapur') : text('Bar Guide', 'Panduan Bar');
  const topic = topics.find(item => item.id === selected) ?? topics[0];
  const screenshot = `${import.meta.env.BASE_URL}guides/${topic.id}-${locale === 'en' ? 'en' : 'ms'}.png`;
  function show() {
    const view = new URLSearchParams(location.search).get('view');
    setSelected(area === 'bar'
      ? location.pathname.includes('closing') ? 'closing' : location.pathname.includes('stock') ? 'bar-stock' : 'sell'
      : location.pathname.includes('finance') ? 'finance' : location.pathname.includes('purchases') ? 'receipts' : location.pathname.endsWith('/stock')
        ? view === 'arrivals' ? 'arrivals' : view === 'count' || view === 'history' ? 'count' : view === 'out' ? 'waste' : 'usage' : 'requests');
    setLocale(language); setZoom(false); setOpen(true);
  }
  return <>
    <button type="button" className={iconButtonClass + ' !h-11 !w-11 shrink-0'} title={title} aria-label={title} onClick={show}><CircleHelp size={18} /></button>
    {open ? <Modal title={area === 'kitchen' ? locale === 'en' ? 'Kitchen Guide' : 'Panduan Dapur' : locale === 'en' ? 'Bar Guide' : 'Panduan Bar'} onClose={() => setOpen(false)}>
      <div className="workflow-guide">
        <div className="grid grid-cols-3 gap-1" role="group" aria-label="Guide Language">
          {([['en', 'English'], ['ms', 'Bahasa Melayu'], ['id', 'Indonesia']] as const).map(([value, label]) => <button type="button" key={value} aria-pressed={locale === value} onClick={() => setLocale(value)} className={`min-h-11 rounded-md px-1 text-xs font-semibold ${locale === value ? 'bg-accent text-white' : 'bg-shell text-ink'}`}>{label}</button>)}
        </div>
        <div className="mt-3 flex flex-wrap gap-1 border-b border-line pb-3" role="group" aria-label={locale === 'en' ? 'Guide Topics' : 'Topik Panduan'}>
          {topics.map(item => <button type="button" key={item.id} aria-pressed={selected === item.id} onClick={() => setSelected(item.id)} className={`min-h-11 rounded-md px-3 text-xs font-semibold ${selected === item.id ? 'bg-accent/10 text-accent' : 'text-muted hover:bg-shell'}`}>{item.title[locale]}</button>)}
        </div>
        <h3 className="my-3 text-sm font-bold">{topic.title[locale]}</h3>
        <div className="grid items-start gap-4 sm:grid-cols-[220px_minmax(0,1fr)]">
          <div>
            <button type="button" onClick={() => setZoom(true)} className="relative mx-auto block w-full overflow-hidden rounded-md border border-line bg-shell" aria-label={locale === 'en' ? 'Enlarge Screenshot' : locale === 'ms' ? 'Besarkan Gambar' : 'Perbesar Gambar'}>
              <img src={screenshot} width={430} height={760} className="mx-auto h-[220px] w-auto sm:h-auto sm:w-full" alt={topic.title[locale]} />
              <span className="absolute right-2 top-2 grid h-11 w-11 place-items-center rounded-md border border-line bg-surface shadow-sm"><ZoomIn size={18} /></span>
            </button>
            <p className="mt-2 text-center text-xs text-muted">{locale === 'en' ? 'Sample screen. Tap to enlarge.' : locale === 'ms' ? 'Skrin contoh. Tekan untuk besarkan.' : 'Contoh layar Bahasa Melayu. Ketuk untuk memperbesar.'}</p>
          </div>
          <ol className="grid gap-3">{topic.steps.map((step, index) => <li key={index} className="flex gap-3 text-sm leading-6"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent/10 font-bold text-accent">{index + 1}</span><span className="min-w-0">{step[locale]}</span></li>)}</ol>
        </div>
        <p className="mt-4 border-l-2 border-accent pl-3 text-sm leading-6 text-muted">{topic.note[locale]}</p>
      </div>
      {zoom ? <Modal title={topic.title[locale]} onClose={() => setZoom(false)} wide><div className="overflow-auto"><img src={screenshot} alt={topic.title[locale]} width={430} height={760} className="mx-auto w-[430px] max-w-none" /></div></Modal> : null}
    </Modal> : null}
  </>;
}
