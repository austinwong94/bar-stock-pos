import { useEffect, useRef, useState } from 'react';
import { todayIso } from './opsData';

// An open "today" view follows Malaysia's midnight; an explicitly selected past date stays put.
export function useBusinessDate(workflow?: string) {
  const [date, setDate] = useState(() => {
    if (workflow) try {
      const saved=JSON.parse(sessionStorage.getItem(`service-date:${workflow}`)||'null');
      if(saved?.openedOn===todayIso() && /^\d{4}-\d{2}-\d{2}$/.test(saved.date)
        && !Number.isNaN(Date.parse(saved.date)) && new Date(saved.date).toISOString().slice(0,10)===saved.date) return saved.date as string;
    } catch { /* Navigation still works without browser storage. */ }
    return todayIso();
  });
  const previousToday = useRef(todayIso());
  useEffect(() => {
    if(workflow) try { sessionStorage.setItem(`service-date:${workflow}`,JSON.stringify({date,openedOn:todayIso()})); } catch { /* This preference is tab-local. */ }
  }, [workflow,date]);
  useEffect(() => {
    const tick = () => {
      const today = todayIso();
      const previous = previousToday.current;
      previousToday.current = today;
      if (previous !== today) setDate((selected) => selected === previous ? today : selected);
    };
    const timer = window.setInterval(tick, 30000);
    window.addEventListener('focus', tick);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', tick); };
  }, []);
  return [date, setDate] as const;
}
