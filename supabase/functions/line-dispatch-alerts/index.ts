// FinAnalytics v1.7.1 LINE Alert Dispatcher Edge Function
// Reads pending alert_events and sends them through LINE Messaging API.
// Secrets required:
// - LINE_CHANNEL_ACCESS_TOKEN
// - SUPABASE_URL
// - SUPABASE_SERVICE_ROLE_KEY
// Required when deployed with --no-verify-jwt:
// - ALERT_DISPATCH_SECRET

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const LINE_PUSH_ENDPOINT = 'https://api.line.me/v2/bot/message/push';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-dispatch-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function getEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing required secret: ${name}`);
  return value;
}

function isAuthorized(req: Request): boolean {
  const secret = Deno.env.get('ALERT_DISPATCH_SECRET');
  // Fail closed because this function is deployed with --no-verify-jwt.
  if (!secret) return false;
  const headerSecret = req.headers.get('x-dispatch-secret');
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  return headerSecret === secret || bearer === secret;
}

function eventFlagName(eventType: string): string | null {
  const type = String(eventType || '').toLowerCase();
  if (type.includes('import_success')) return 'notify_import_success';
  if (type.includes('import_failed') || type.includes('parser_failed')) return 'notify_import_failed';
  if (type.includes('mapping_review')) return 'notify_mapping_review';
  if (type.includes('data_quality')) return 'notify_data_quality_warning';
  if (type.includes('rollback') || type.includes('superseded')) return 'notify_rollback';
  if (type.includes('mapping_changed') || type.includes('account_mapping')) return 'notify_mapping_change';
  if (type.includes('permission') || type.includes('role_changed')) return 'notify_permission_change';
  if (type.includes('daily_summary')) return 'notify_daily_summary';
  return null;
}

function formatThaiDate(value: string | null) {
  if (!value) return '-';
  try {
    return new Intl.DateTimeFormat('th-TH', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Asia/Bangkok',
    }).format(new Date(value));
  } catch (_) {
    return value;
  }
}

function severityIcon(severity: string, eventType: string) {
  const type = String(eventType || '').toLowerCase();
  if (severity === 'critical' || type.includes('failed')) return '🚨';
  if (severity === 'warning') return '⚠️';
  if (severity === 'security') return '🔐';
  if (severity === 'success' || type.includes('success')) return '✅';
  if (severity === 'summary') return '📊';
  return '🔔';
}

function formatAlertMessage(alert: any): string {
  const company = alert.companies || {};
  const metadata = alert.metadata || {};
  const companyName = company.ticker_symbol || company.name_th || metadata.company || '-';
  const actor = alert.actor_name || alert.actor_email || metadata.actor || '-';
  const file = metadata.file_name || metadata.fileName || metadata.file || '-';
  const fiscalYear = metadata.fiscal_year || metadata.fiscalYear || '-';
  const rows = metadata.total_rows ?? metadata.rows ?? '-';
  const review = metadata.review_count ?? metadata.reviewCount ?? '-';
  const batchId = alert.import_batch_id || metadata.batch_id || '-';
  const icon = severityIcon(alert.severity, alert.event_type);

  const lines = [
    `${icon} ${alert.title || 'FinAnalytics Alert'}`,
    '',
    `ผู้ดำเนินการ: ${actor}`,
    `บริษัท: ${companyName}`,
  ];

  if (fiscalYear !== '-') lines.push(`ปีงบ: ${fiscalYear}`);
  if (file !== '-') lines.push(`ไฟล์: ${file}`);
  if (rows !== '-') lines.push(`แถวที่อ่านได้: ${rows}`);
  if (review !== '-') lines.push(`ต้องตรวจสอบ: ${review}`);
  if (alert.message) lines.push('', String(alert.message));
  lines.push(`เวลา: ${formatThaiDate(alert.created_at)}`);
  if (batchId !== '-') lines.push(`Batch: ${String(batchId).slice(0, 8)}...`);

  return lines.join('\n').slice(0, 5000);
}

async function sendLinePush(token: string, to: string, text: string) {
  const response = await fetch(LINE_PUSH_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      to,
      messages: [{ type: 'text', text }],
    }),
  });

  const responseText = await response.text();
  if (!response.ok) throw new Error(`LINE push failed ${response.status}: ${responseText}`);
  return responseText ? JSON.parse(responseText) : {};
}

async function getRecipient(supabase: any, alert: any) {
  if (alert.recipient_id) {
    return { recipientId: alert.recipient_id, setting: null, skipReason: null };
  }

  if (!alert.company_id) return { recipientId: null, setting: null, skipReason: 'missing_company_id' };

  const { data, error } = await supabase
    .from('line_alert_settings')
    .select('*')
    .eq('company_id', alert.company_id)
    .maybeSingle();

  if (error) return { recipientId: null, setting: null, skipReason: error.message };
  if (!data?.is_enabled) return { recipientId: null, setting: data, skipReason: 'line_disabled' };
  if (!data.recipient_id) return { recipientId: null, setting: data, skipReason: 'missing_recipient_id' };

  const flag = eventFlagName(alert.event_type);
  if (flag && data[flag] === false) return { recipientId: null, setting: data, skipReason: `disabled_${flag}` };

  return { recipientId: data.recipient_id, setting: data, skipReason: null };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (!['POST', 'GET'].includes(req.method)) return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
  if (!isAuthorized(req)) return new Response('Unauthorized', { status: 401, headers: corsHeaders });

  try {
    const token = getEnv('LINE_CHANNEL_ACCESS_TOKEN');
    const supabase = createClient(getEnv('SUPABASE_URL'), getEnv('SUPABASE_SERVICE_ROLE_KEY'));
    const url = new URL(req.url);
    const limit = Math.min(Number(url.searchParams.get('limit') || 20), 50);

    const { data: alerts, error } = await supabase
      .from('alert_events')
      .select('*,companies(name_th,name_en,ticker_symbol)')
      .eq('delivery_channel', 'line')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(limit);

    if (error) throw error;

    const results = [];
    for (const alert of alerts || []) {
      try {
        const { recipientId, skipReason } = await getRecipient(supabase, alert);
        if (!recipientId) {
          await supabase.from('alert_events').update({
            status: 'failed',
            updated_at: new Date().toISOString(),
            metadata: { ...(alert.metadata || {}), line_skip_reason: skipReason },
          }).eq('id', alert.id);
          results.push({ id: alert.id, ok: false, skipped: true, reason: skipReason });
          continue;
        }

        await sendLinePush(token, recipientId, formatAlertMessage(alert));
        await supabase.from('alert_events').update({
          status: 'sent',
          sent_at: new Date().toISOString(),
          recipient_id: recipientId,
          updated_at: new Date().toISOString(),
        }).eq('id', alert.id);
        results.push({ id: alert.id, ok: true });
      } catch (sendError) {
        await supabase.from('alert_events').update({
          status: 'failed',
          updated_at: new Date().toISOString(),
          metadata: { ...(alert.metadata || {}), line_error: String(sendError?.message || sendError) },
        }).eq('id', alert.id);
        results.push({ id: alert.id, ok: false, error: String(sendError?.message || sendError) });
      }
    }

    return new Response(JSON.stringify({ ok: true, processed: results.length, results }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error(error);
    return new Response(JSON.stringify({ ok: false, error: String(error?.message || error) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
