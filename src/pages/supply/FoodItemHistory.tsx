import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Modal } from '../../components/Modal';
import { secondaryButtonClass } from '../../components/Form';
import { useLanguage } from '../../lib/language';
import { supabase } from '../../lib/supabase';
import { readErrorMessage } from '../../lib/opsData';
import { countOutcome, foodMovementName, movementAmount, type FoodItemHistoryPage } from '../../lib/foodItemHistory';
import { historyPageSize, type HistoryCursor } from '../../lib/foodStockHistory';
import type { IngredientMovement } from '../../lib/types';

export type ItemHistorySelection = { itemId: string; name: string; anchorId?: string };

export default function FoodItemHistory({ selection, onClose }: { selection: ItemHistorySelection; onClose: () => void }) {
  const { text: t } = useLanguage();
  const [page, setPage] = useState<FoodItemHistoryPage | null>(null);
  const [rows, setRows] = useState<IngredientMovement[]>([]);
  const [next, setNext] = useState<HistoryCursor | null>(null);
  const [loading, setLoading] = useState(true), [loadingMore, setLoadingMore] = useState(false), [error, setError] = useState('');
  const busy = useRef(false), generation = useRef(0);
  const load = useCallback(async (cursor: HistoryCursor | null = null) => {
    if (cursor && busy.current) return;
    const ticket = ++generation.current;
    busy.current = true; setError('');
    if (cursor) setLoadingMore(true);
    else { setLoading(true); setLoadingMore(false); setPage(null); setRows([]); setNext(null); }
    try {
      const result = await supabase.rpc('read_food_item_history', {
        p_ingredient_id: selection.itemId, p_anchor_id: selection.anchorId ?? null, p_limit: historyPageSize,
        p_before_created_at: cursor?.created_at ?? null, p_before_id: cursor?.id ?? null,
      });
      if (result.error) throw result.error;
      const data = result.data as FoodItemHistoryPage;
      if (!data || data.item?.id !== selection.itemId || !Array.isArray(data.rows)
        || data.rows.some(row => row.ingredient_id !== selection.itemId)
        || (selection.anchorId && data.anchor?.id !== selection.anchorId)) throw new Error(t('Item history could not be verified. Retry.', 'Sejarah item tidak dapat disahkan. Cuba lagi.'));
      if (ticket !== generation.current) return;
      if (!cursor) setPage(data);
      setRows(old => cursor ? [...old, ...data.rows.filter(row => !old.some(r => r.id === row.id))] : data.rows);
      setNext(data.next);
    } catch (e) {
      if (ticket === generation.current) setError(typeof e === 'object' && e !== null && 'code' in e && e.code === 'PGRST202'
        ? t('Item history needs the latest database update.', 'Sejarah item memerlukan kemas kini pangkalan data terkini.')
        : readErrorMessage(e, t('Could not load item history.', 'Sejarah item tidak dapat dimuatkan.')));
    } finally {
      if (ticket === generation.current) { busy.current = false; setLoading(false); setLoadingMore(false); }
    }
  }, [selection.itemId, selection.anchorId, t]);
  useEffect(() => { void load(); return () => { generation.current++; busy.current = false; }; }, [load]);

  const date = (value: string) => new Date(value).toLocaleString(t('en-MY', 'ms-MY'), { timeZone: 'Asia/Kuala_Lumpur', dateStyle: 'medium', timeStyle: 'short' });
  const anchor = page?.anchor, counted = anchor?.movement_type === 'count';
  const first = anchor ?? page?.rows[0];
  return <Modal title={t('Item History', 'Sejarah Item')} onClose={onClose}>
    <div className="item-history-heading">
      <div><h3>{page?.item.kitchen_label || page?.item.name || selection.name}</h3><p>{t('Recorded Time (Malaysia)', 'Masa Direkod (Malaysia)')}</p></div>
      <button type="button" className={secondaryButtonClass + ' !h-11 !w-11 !p-0 shrink-0'} title={t('Refresh Item History', 'Muat Semula Sejarah Item')} aria-label={t('Refresh Item History', 'Muat Semula Sejarah Item')} disabled={loading || loadingMore} onClick={() => void load()}><RefreshCw size={16}/></button>
    </div>
    {first && !loading ? <>
      {counted ? <dl className="item-count-summary">
        <div><dt>{t('Expected', 'Dijangka')}</dt><dd>{movementAmount(anchor, anchor.quantity_before)}</dd></div>
        <div><dt>{t('Counted', 'Dikira')}</dt><dd>{movementAmount(anchor, anchor.quantity_after)}</dd></div>
        <div><dt>{countOutcome(anchor, t)}</dt><dd className={Number(anchor.quantity_change) < 0 ? 'text-danger' : Number(anchor.quantity_change) > 0 ? 'text-warning' : 'text-palm'}>{movementAmount(anchor, Math.abs(anchor.quantity_change))}</dd></div>
      </dl> : <p className="my-3 text-sm">{anchor ? t('Balance After Selected Record', 'Baki Selepas Rekod Dipilih') : t('Latest Recorded Balance', 'Baki Direkod Terkini')}: <strong>{movementAmount(first, first.quantity_after)}</strong></p>}
      {anchor ? <p className="mb-3 text-xs text-muted">{t('Selected Record', 'Rekod Dipilih')} · {date(anchor.created_at)} · {anchor.entered_by || t('Staff Not Recorded', 'Staf Tidak Direkod')}</p> : null}
    </> : null}
    {error ? <p role="alert" className="my-3 text-sm text-danger">{error} <button className="underline" onClick={() => void load(next)}>{t('Retry', 'Cuba Lagi')}</button></p> : null}
    {loading ? <p role="status" className="py-4 text-sm text-muted">{t('Loading History...', 'Memuatkan Sejarah...')}</p> : <>
      {rows.length ? <div className="item-history-columns text-xs text-muted"><span>{t('Movement', 'Pergerakan')}</span><span>{t('Balance Change', 'Perubahan Baki')}</span></div> : null}
      <ol className="item-history-list" aria-label={t('Item Movements', 'Pergerakan Item')}>{rows.map(row => <li key={row.id} className={row.id === anchor?.id ? 'item-history-selected' : ''}>
        <div className="item-history-columns"><strong>{foodMovementName(row, t)}</strong><strong className={row.movement_type==='count'?(Number(row.quantity_change)<0?'text-danger':Number(row.quantity_change)>0?'text-warning':'text-palm'):(Number(row.quantity_change)<0?'text-warning':'text-palm')}>{Number(row.quantity_change) > 0 ? '+' : ''}{movementAmount(row, row.quantity_change)}</strong></div>
        <p className="text-xs text-muted">{date(row.created_at)} · <span className="text-ink">{row.entered_by || t('Staff Not Recorded', 'Staf Tidak Direkod')}</span></p>
        <p className="text-xs text-muted">{row.movement_type==='count'?t('Expected', 'Dijangka'):t('Before', 'Sebelum')} {movementAmount(row, row.quantity_before)} · {row.movement_type==='count'?t('Counted', 'Dikira'):t('After', 'Selepas')} {movementAmount(row, row.quantity_after)}{row.movement_type === 'count' ? ' · ' + countOutcome(row, t) : ''}</p>
        {row.notes ? <p className="text-xs text-muted">{row.notes}</p> : null}
      </li>)}</ol>
      {!rows.length && !error ? <p className="py-5 text-center text-sm text-muted">{t('No Recorded Movements', 'Tiada Pergerakan Direkod')}</p> : null}
      {rows.length ? <div className="item-history-end"><span>{rows.length} {t('records shown', 'rekod dipaparkan')}{!next ? ' · ' + t('End of History', 'Akhir Sejarah') : ''}</span>{next ? <button className={secondaryButtonClass} disabled={loadingMore} onClick={() => void load(next)}>{loadingMore ? t('Loading...', 'Memuatkan...') : t('Load Older Records', 'Muatkan Rekod Lebih Lama')}</button> : null}</div> : null}
    </>}
  </Modal>;
}
