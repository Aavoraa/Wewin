import { env } from '../../config/env';

export interface OutboundMessage {
  to: string;
  title: string;
  body: string;
  link?: string | null;
}

export interface SendResult {
  providerMessageId?: string;
}

/** Provider-independent delivery channel (A7). */
export interface NotificationChannel {
  readonly name: 'IN_APP' | 'WHATSAPP';
  isConfigured(): boolean;
  send(msg: OutboundMessage): Promise<SendResult>;
}

/** In-app: the notification row itself is the delivery. */
export const inAppChannel: NotificationChannel = {
  name: 'IN_APP',
  isConfigured: () => true,
  send: async () => ({}),
};

/**
 * WhatsApp via a generic HTTPS provider endpoint (later feature, A§11). Only active when
 * WHATSAPP_PROVIDER, WHATSAPP_API_URL and WHATSAPP_API_TOKEN are set; secrets stay server-side.
 * A delivery is marked SENT only when the provider accepts the request.
 */
export const whatsAppChannel: NotificationChannel = {
  name: 'WHATSAPP',
  isConfigured: () => !!(env.WHATSAPP_PROVIDER && env.WHATSAPP_API_URL && env.WHATSAPP_API_TOKEN),
  async send(msg) {
    if (!this.isConfigured()) throw new Error('WhatsApp provider not configured');
    const res = await fetch(env.WHATSAPP_API_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${env.WHATSAPP_API_TOKEN}` },
      body: JSON.stringify({ provider: env.WHATSAPP_PROVIDER, to: msg.to, text: `${msg.title}\n${msg.body}` }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Provider responded ${res.status}`);
    const body = (await res.json().catch(() => ({}))) as { id?: string; messageId?: string };
    return { providerMessageId: body.id ?? body.messageId };
  },
};
