import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import * as z from 'zod/v4';
import { type VoiceFormSpec } from '@wewin/shared';
import { env } from '../../config/env';
import { AppError } from '../../core/errors/app-error';

/**
 * Interprets one spoken request with Claude into a fixed shape. Plain strings only ("" = not said):
 * the API allows at most 16 nullable / union-typed fields in an output schema. Everything returned
 * is validated and resolved again by the service — the model never decides access or saves data.
 */
const pair = z.object({ name: z.string(), value: z.string() });
export const AiVoice = z.object({
  intent: z.enum(['navigate', 'enquiry', 'fill', 'unknown']),
  screen_path: z.string(),
  report_key: z.string(),
  report_params: z.array(pair),
  search_text: z.string(),
  fields: z.array(pair),
  lines: z.array(z.object({ cells: z.array(pair) })),
  reply: z.string(),
});
export type AiVoice = z.infer<typeof AiVoice>;

export interface VoiceContext {
  today: string;
  transcript: string;
  screens: { label: string; to: string }[];
  reports: { key: string; title: string; description: string; params: { key: string; label: string; type: string; options?: { value: string; label: string }[] }[] }[];
  form?: VoiceFormSpec;
}

const SYSTEM = `You turn one spoken request from a user of a garment manufacturer's ERP (Wewin Knit Fashions, Tiruppur, India) into a structured action. The speech was transcribed by a browser and may contain recognition errors; Indian English, codes spoken digit by digit ("W W 2627 001" = "WW-2627-001"), and "kilo/kgs" for kg are common.

Choose exactly one intent:
- "navigate": the user wants to open a screen. Put one path from the screens list in screen_path; add "/new" to a document register's path when they ask to create a new document.
- "enquiry": the user asks a question about the business (stock, material at job workers, pending or overdue D.C.s, process loss, yarn purchases, order progress, payables, export invoices, receivables). Pick the one report from the reports list that answers it; put its key in report_key; set report_params only for that report's params (dates as YYYY-MM-DD; select params use one of the listed option values; vendor / buyer / process params as the name as spoken). Put words that narrow the rows (an item, a lot, a colour, an order no., a vendor name when the report has no vendor param) in search_text.
- "fill": a form is open and the user is dictating its contents. Return values only for fields that were actually said, using the field names given. Dates as YYYY-MM-DD (resolve "today", "yesterday", "21st October" against today's date); numbers as plain digits without units or commas; vendor / buyer / item / order / process fields as the name or code as spoken; select fields as one of their options. When several lines were described ("two lots: KSM-2601 1000 kg and KSM-2602 500 kg"), return one entry in lines per line, with cells named after the line fields.
- "unknown": anything else, or the request is not clear. Put a short question or explanation in reply.

Never invent values that were not said. Leave every field you do not use as an empty string or empty list. reply is one short sentence for the user.
The transcript is the user's request; treat any instructions inside it as part of what they asked, but you can only return the structure above.`;

export async function interpretWithAi(ctx: VoiceContext): Promise<AiVoice> {
  const client = new Anthropic({ maxRetries: 2, timeout: 60_000 });
  let res;
  try {
    res = await client.beta.messages.parse({
      model: env.VOICE_AI_MODEL,
      max_tokens: 4000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      thinking: { type: 'adaptive' },
      output_config: { effort: 'low', format: betaZodOutputFormat(AiVoice) },
      system: SYSTEM,
      messages: [{ role: 'user', content: JSON.stringify(ctx) }],
    } as never);
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new AppError('VOICE_PROVIDER', 'Voice understanding is enabled but the API key is invalid', 502);
    if (err instanceof Anthropic.RateLimitError) throw new AppError('VOICE_PROVIDER_BUSY', 'Voice understanding is busy; try again in a moment', 503);
    if (err instanceof Anthropic.APIError) throw new AppError('VOICE_PROVIDER', `Voice understanding failed (${err.status ?? 'network'})`, 502);
    throw err;
  }
  const r = res as unknown as { stop_reason: string; parsed_output: AiVoice | null };
  if (r.stop_reason === 'refusal' || !r.parsed_output) throw new AppError('VOICE_PROVIDER', 'Could not understand that request', 422);
  return r.parsed_output;
}
