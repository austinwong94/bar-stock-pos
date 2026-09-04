import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, MessageCircle, SkipForward } from 'lucide-react';
import { PageHeader, Stat } from '../../components/Page';
import { buttonClass, secondaryButtonClass } from '../../components/Form';
import { useToast } from '../../components/Toast';
import { supabase } from '../../lib/supabase';
import { useAccess } from '../../lib/access';
import { readErrorMessage } from '../../lib/opsData';
import type { NotificationRule, OutboundMessage } from '../../lib/platformTypes';

export default function MessageOutbox() {
  const toast = useToast();
  const { can, reloadBadges } = useAccess();
  const [messages, setMessages] = useState<OutboundMessage[]>([]);
  const [rules, setRules] = useState<NotificationRule[]>([]);
  const [showSent, setShowSent] = useState(false);
  const [loading, setLoading] = useState(true);

  const canSend = can('ops.messages.send');
  const canManage = can('ops.messages.manage');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [messageResult, ruleResult] = await Promise.all([
        supabase.from('outbound_messages').select('*').order('created_at', { ascending: false }).limit(100),
        supabase.from('notification_rules').select('*').order('sort_order'),
      ]);
      if (messageResult.error) throw messageResult.error;
      setMessages((messageResult.data ?? []) as OutboundMessage[]);
      setRules((ruleResult.data ?? []) as NotificationRule[]);
    } catch (error) {
      toast.error(readErrorMessage(error, 'Could not load the outbox.'));
    }
    setLoading(false);
  }, [toast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function toggleRule(rule: NotificationRule, enabled: boolean) {
    setRules((rows) => rows.map((row) => (row.code === rule.code ? { ...row, enabled } : row)));
    const { error } = await supabase.rpc('set_notification_rule', { p_code: rule.code, p_enabled: enabled });
    if (error) { toast.error(error.message); void refresh(); return; }
    toast.success(`${rule.name} ${enabled ? 'will be sent' : 'will not be sent'}.`);
  }

  async function setStatus(message: OutboundMessage, status: 'sent' | 'skipped') {
    const { error } = await supabase.rpc('mark_outbound_sent', {
      p_message_id: message.id,
      p_status: status,
      p_note: null,
    });
    if (error) { toast.error(error.message); return; }
    void refresh();
    void reloadBadges();
  }

  function openWhatsApp(message: OutboundMessage) {
    // Opens WhatsApp with the text already written. The person picks the
    // group and taps send, which is the only route that does not need an
    // always-on server or break WhatsApp's rules.
    window.open(`https://wa.me/?text=${encodeURIComponent(message.body)}`, '_blank', 'noopener');
  }

  async function copy(message: OutboundMessage) {
    try {
      await navigator.clipboard.writeText(message.body);
      toast.success('Message copied. Paste it into the group.');
    } catch {
      toast.error('Could not copy. Select the text and copy it by hand.');
    }
  }

  const queued = messages.filter((message) => message.status === 'queued');
  const visible = showSent ? messages : queued;

  return (
    <>
      <PageHeader
        title="Message Outbox"
        subtitle="Every announcement the system has prepared. Send it to the group, then mark it done."
        actions={
          <label className="flex items-center gap-2 rounded-2xl border border-line bg-white/90 px-3 py-2 text-sm font-black">
            <input type="checkbox" checked={showSent} onChange={(e) => setShowSent(e.target.checked)} />
            Show sent
          </label>
        }
      />

      <div className="mb-3 grid gap-2 sm:grid-cols-3">
        <Stat label="Waiting to be sent" value={String(queued.length)} tone={queued.length ? 'warn' : 'good'} />
        <Stat label="Rules switched on" value={String(rules.filter((rule) => rule.enabled).length)} />
        <Stat label="Rules switched off" value={String(rules.filter((rule) => !rule.enabled).length)} />
      </div>

      {canManage ? (
        <section className="mb-3 rounded-2xl border border-line bg-white/85 p-3 shadow-soft">
          <h2 className="mb-1 text-sm font-black">Which sections send a message</h2>
          <p className="mb-2 text-xs font-semibold text-neutral-600">
            Switching one off stops the message being created at all, so nothing piles up while it is off.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {rules.map((rule) => (
              <label
                key={rule.code}
                className={`flex cursor-pointer items-start gap-2.5 rounded-xl border p-2.5 ${
                  rule.enabled ? 'border-accent bg-shell' : 'border-line bg-white'
                }`}
              >
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4"
                  checked={rule.enabled}
                  onChange={(e) => toggleRule(rule, e.target.checked)}
                />
                <span className="min-w-0">
                  <span className="block text-sm font-black">{rule.name}</span>
                  <span className="block text-xs font-semibold text-neutral-600">{rule.description}</span>
                  {rule.target_label ? (
                    <span className="mt-1 inline-block rounded bg-white px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wide text-neutral-500">
                      {rule.target_label}
                    </span>
                  ) : null}
                </span>
              </label>
            ))}
          </div>
        </section>
      ) : null}

      {loading ? <p className="p-4 font-bold">Loading...</p> : null}

      <div className="grid gap-3">
        {visible.map((message) => (
          <article key={message.id} className="rounded-2xl border border-line bg-white/85 p-3 shadow-soft">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-black">
                {message.title}
                <span
                  className={`ml-2 rounded-lg px-2 py-0.5 text-xs ${
                    message.status === 'queued'
                      ? 'bg-amber-50 text-amber-800'
                      : message.status === 'sent'
                        ? 'bg-shell text-accent'
                        : 'bg-neutral-100 text-neutral-600'
                  }`}
                >
                  {message.status === 'queued' ? 'Waiting' : message.status}
                </span>
              </p>
              <span className="text-xs font-semibold text-neutral-500">
                {new Date(message.created_at).toLocaleString('en-GB', { timeZone: 'Asia/Kuala_Lumpur' })}
              </span>
            </div>

            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-shell/70 p-3 text-xs font-semibold leading-relaxed text-ink">
{message.body}
            </pre>

            {canSend && message.status === 'queued' ? (
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" className={buttonClass} onClick={() => openWhatsApp(message)}>
                  <MessageCircle className="h-4 w-4" /> Open in WhatsApp
                </button>
                <button type="button" className={secondaryButtonClass} onClick={() => copy(message)}>
                  <Copy className="h-4 w-4" /> Copy
                </button>
                <button type="button" className={secondaryButtonClass} onClick={() => setStatus(message, 'sent')}>
                  <Check className="h-4 w-4" /> Mark sent
                </button>
                <button type="button" className={secondaryButtonClass} onClick={() => setStatus(message, 'skipped')}>
                  <SkipForward className="h-4 w-4" /> Skip
                </button>
              </div>
            ) : null}
          </article>
        ))}
        {!loading && visible.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-line p-6 text-center text-sm font-bold text-neutral-500">
            Nothing waiting to be sent.
          </p>
        ) : null}
      </div>
    </>
  );
}
