import nodemailer, { type Transporter } from 'nodemailer';
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
  readonly name: 'IN_APP' | 'WHATSAPP' | 'EMAIL';
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

let transport: Transporter | null = null;
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const absolute = (link: string) => (/^https?:\/\//.test(link) ? link : env.APP_URL ? `${env.APP_URL.replace(/\/$/, '')}${link}` : null);

/** Plain text + simple HTML body for an email notification (the body's lines become a list). */
export function emailContent(msg: Pick<OutboundMessage, 'title' | 'body' | 'link'>) {
  const url = msg.link ? absolute(msg.link) : null;
  const lines = msg.body.split('\n').filter(Boolean);
  const text = [msg.title, '', ...lines, ...(url ? ['', `Open: ${url}`] : []), '', '— Wewin ERP'].join('\n');
  const html =
    `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#0f172a">` +
    `<h2 style="font-size:16px;margin:0 0 8px">${escapeHtml(msg.title)}</h2>` +
    `<ul style="padding-left:18px;margin:0 0 12px">${lines.map((l) => `<li style="margin:2px 0">${escapeHtml(l)}</li>`).join('')}</ul>` +
    (url ? `<p><a href="${escapeHtml(url)}" style="color:#ea580c">Open in Wewin ERP</a></p>` : '') +
    `<p style="color:#64748b;font-size:12px">Sent automatically by Wewin ERP.</p></div>`;
  return { text, html };
}

/** Email over SMTP (accounts feed, Q-064). Only active when SMTP_HOST and SMTP_FROM are set. */
export const emailChannel: NotificationChannel = {
  name: 'EMAIL',
  isConfigured: () => !!(env.SMTP_HOST && env.SMTP_FROM),
  async send(msg) {
    if (!this.isConfigured()) throw new Error('Email (SMTP) not configured');
    transport ??= nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
      connectionTimeout: 15_000,
    });
    const { text, html } = emailContent(msg);
    const info = await transport.sendMail({ from: env.SMTP_FROM, to: msg.to, subject: msg.title, text, html });
    return { providerMessageId: info.messageId };
  },
};
