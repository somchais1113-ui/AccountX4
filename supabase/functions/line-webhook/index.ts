// FinAnalytics v1.7.1 LINE Webhook Edge Function
// Receives LINE webhook events, verifies LINE signature, and helps capture userId/groupId/roomId.
// Secrets required:
// - LINE_CHANNEL_SECRET
// - LINE_CHANNEL_ACCESS_TOKEN
// - SUPABASE_URL
// - SUPABASE_SERVICE_ROLE_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const LINE_REPLY_ENDPOINT = 'https://api.line.me/v2/bot/message/reply';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-line-signature',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function getEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing required secret: ${name}`);
  return value;
}

function bytesToBase64(bytes: ArrayBuffer): string {
  let binary = '';
  const arr = new Uint8Array(bytes);
  for (const byte of arr) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function verifyLineSignature(rawBody: string, signature: string | null, channelSecret: string): Promise<boolean> {
  if (!signature) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(channelSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  return bytesToBase64(digest) === signature;
}

function getSource(event: any) {
  const source = event?.source || {};
  if (source.groupId) return { type: 'group', id: source.groupId };
  if (source.roomId) return { type: 'room', id: source.roomId };
  return { type: 'user', id: source.userId || null };
}

function parseRegisterCommand(text: string): string | null {
  const normalized = String(text || '').trim();
  const lower = normalized.toLowerCase();
  if (!lower.startsWith('register') && !normalized.startsWith('ลงทะเบียน')) return null;
  return normalized.replace(/^register/i, '').replace(/^ลงทะเบียน/i, '').trim() || null;
}

async function replyLine(replyToken: string, text: string, token: string) {
  if (!replyToken) return;
  await fetch(LINE_REPLY_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      replyToken,
      messages: [{ type: 'text', text: text.slice(0, 5000) }],
    }),
  });
}

async function logAlertEvent(supabase: any, payload: Record<string, unknown>) {
  await supabase.from('alert_events').insert({
    event_type: 'line_webhook_received',
    severity: 'info',
    status: 'sent',
    title: 'LINE webhook received',
    message: 'LINE webhook event was received by FinAnalytics.',
    metadata: payload,
    delivery_channel: 'line',
    sent_at: new Date().toISOString(),
  });
}

async function registerRecipientForCompany(supabase: any, companyQuery: string, recipientType: string, recipientId: string) {
  const q = String(companyQuery || '').trim();
  if (!q) return { ok: false, reason: 'missing_company' };

  const { data: companies, error } = await supabase
    .from('companies')
    .select('id,name_th,name_en,ticker_symbol')
    .or(`ticker_symbol.ilike.%${q}%,name_th.ilike.%${q}%,name_en.ilike.%${q}%`)
    .limit(2);

  if (error) return { ok: false, reason: error.message };
  if (!companies || companies.length === 0) return { ok: false, reason: `ไม่พบบริษัท: ${q}` };
  if (companies.length > 1) return { ok: false, reason: `พบมากกว่า 1 บริษัทสำหรับ: ${q}` };

  const company = companies[0];
  const { error: upsertError } = await supabase.from('line_alert_settings').upsert({
    company_id: company.id,
    is_enabled: true,
    recipient_type: recipientType,
    recipient_id: recipientId,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'company_id' });

  if (upsertError) return { ok: false, reason: upsertError.message };
  return { ok: true, company };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });

  try {
    const channelSecret = getEnv('LINE_CHANNEL_SECRET');
    const channelAccessToken = getEnv('LINE_CHANNEL_ACCESS_TOKEN');
    const supabase = createClient(getEnv('SUPABASE_URL'), getEnv('SUPABASE_SERVICE_ROLE_KEY'));

    const rawBody = await req.text();
    const signature = req.headers.get('x-line-signature');
    const isValid = await verifyLineSignature(rawBody, signature, channelSecret);
    if (!isValid) return new Response('Invalid signature', { status: 401, headers: corsHeaders });

    const body = JSON.parse(rawBody || '{}');
    const events = Array.isArray(body.events) ? body.events : [];

    for (const event of events) {
      const source = getSource(event);
      const messageText = event?.message?.type === 'text' ? event.message.text : '';
      const companyQuery = parseRegisterCommand(messageText);

      await logAlertEvent(supabase, {
        event_type: event.type,
        source_type: source.type,
        source_id: source.id,
        message_text: messageText,
        timestamp: event.timestamp,
      });

      if (companyQuery !== null && source.id) {
        if (companyQuery) {
          const result = await registerRecipientForCompany(supabase, companyQuery, source.type, source.id);
          if (result.ok) {
            await replyLine(event.replyToken, `✅ ลงทะเบียน LINE Alert สำเร็จ\nบริษัท: ${result.company.ticker_symbol || result.company.name_th}\nประเภทผู้รับ: ${source.type}\nRecipient ID: ${source.id}`, channelAccessToken);
          } else {
            await replyLine(event.replyToken, `⚠️ ลงทะเบียนไม่สำเร็จ\nเหตุผล: ${result.reason}\n\nตัวอย่าง: register MOSHI`, channelAccessToken);
          }
        } else {
          await replyLine(event.replyToken, `FinAnalytics Alert พร้อมใช้งาน\n\nประเภทผู้รับ: ${source.type}\nRecipient ID:\n${source.id}\n\nนำ ID นี้ไปใส่ในหน้า แจ้งเตือน > LINE Settings หรือพิมพ์ register MOSHI เพื่อลงทะเบียนบริษัท`, channelAccessToken);
        }
      }
    }

    return new Response(JSON.stringify({ ok: true, events: events.length }), {
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
