import { sleep as n8nSleep } from 'n8n-workflow';
export type Json = Record<string, unknown>;
export type Request = (method: 'GET' | 'POST', path: string, body?: Json) => Promise<unknown>;
export interface SendInput {
  sessionId: string;
  to: string;
  text: string;
  operation?: 'text' | 'document' | 'check';
  media?: string;
  fileName?: string;
  caption?: string;
  options?: { validationOnly?: boolean; expectedSenderPhone?: string; delayMs?: number; linkPreview?: boolean };
}

export class WaxumError extends Error {
  constructor(public readonly code: string, message: string, public readonly uncertain = false) {
    super(message);
    this.name = 'WaxumError';
  }
}

export function object(value: unknown): Json {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Json : {};
}

export function fail(code: string, message: string, uncertain = false): never { throw new WaxumError(code, message, uncertain); }

export function sessionPath(sessionId: string): string {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(sessionId)) fail('INVALID_SESSION', 'Enter a Waxum session ID containing only ASCII letters, numbers, hyphens, or underscores.');
  return '/sessions/' + encodeURIComponent(sessionId);
}

export async function checkSession(sessionId: string, expectedPhone: string | undefined, request: Request, requireConnected = true): Promise<Json> {
  let session: Json;
  try { session = object(await request('GET', sessionPath(sessionId))); }
  catch (error) {
    if (error instanceof WaxumError) return fail(error.code, error.message, error.uncertain);
    return fail('SESSION_CHECK_FAILED', 'The session check failed. No message was sent.');
  }
  if (session.id !== sessionId || (requireConnected && (session.status !== 'logged_in' || session.is_logged_in !== true))) {
    fail('SESSION_DISCONNECTED', 'The session is disconnected. Connect WhatsApp before sending.');
  }
  if (expectedPhone && (requireConnected || session.is_logged_in === true)) {
    const expected = recipient(expectedPhone);
    if (expected.group || phoneKey(String(session.phone_number ?? '')) !== phoneKey(expected.to)) {
      fail('SENDER_MISMATCH', 'The connected phone number does not match the expected sender. No message was sent.');
    }
  }
  return session;
}

export async function resolveTarget(target: { to: string; group: boolean }, path: string, request: Request, allowUnregistered = false): Promise<{ canonicalTo: string; exists: boolean }> {
  if (target.group || target.to.endsWith('@lid')) return { canonicalTo: target.to, exists: true };
  let lookup: Json;
  try { lookup = object(await request('POST', path + '/contacts/check', { phones: [target.to] })); }
  catch { return fail('RECIPIENT_CHECK_FAILED', 'The recipient check failed. No message was sent.'); }
  const hits = lookup.results;
  if (allowUnregistered && Array.isArray(hits) && hits.length === 1 && object(hits[0]).is_registered === false) {
    return { canonicalTo: target.to, exists: false };
  }
  if (!Array.isArray(hits) || hits.length !== 1 || object(hits[0]).is_registered !== true) {
    fail('RECIPIENT_UNREGISTERED', 'WhatsApp did not confirm the recipient. No message was sent.');
  }
  const hit = object(hits[0]);
  const canonicalTo = String(hit.jid || hit.phone || '').replace(/@s\.whatsapp\.net$/, '');
  if (!/^\d{10,15}$/.test(canonicalTo) || phoneKey(canonicalTo) !== phoneKey(target.to)) {
    fail('RECIPIENT_MISMATCH', 'The lookup returned a different recipient. No message was sent.');
  }
  return { canonicalTo, exists: true };
}

export function phoneKey(value: string): string {
  let digits = value.replace(/\D/g, '');
  if (digits.startsWith('55') && digits.length === 13 && digits[4] === '9') {
    digits = digits.slice(0, 4) + digits.slice(5);
  }
  return digits;
}

export function apiBase(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { return fail('INVALID_URL', 'Enter a valid API URL.'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) ||
      url.username || url.password || url.search || url.hash ||
      !['', '/', '/api/v1', '/api/v1/'].includes(url.pathname)) {
    return fail('INVALID_URL', 'Enter the Waxum HTTPS URL without credentials, query parameters, or extra path segments.');
  }
  return url.origin + '/api/v1';
}

export function recipient(value: string): { to: string; group: boolean } {
  const input = value.trim();
  if (/^\d{5,30}(?:-\d{5,20})?@g\.us$/.test(input)) return { to: input, group: true };
  const phone = input.replace(/@(c\.us|s\.whatsapp\.net)$/, '');
  if (!/^\+?[\d\s().-]+$/.test(phone)) return fail('INVALID_RECIPIENT', 'Enter a phone number with its country code or a group ID.');
  const digits = phone.replace(/\D/g, '');
  if (!/^\d{10,15}$/.test(digits)) return fail('INVALID_RECIPIENT', 'Enter a phone number with a country code and 10 to 15 digits.');
  return { to: digits, group: false };
}

/** No message POST is retried: a lost response can still mean WhatsApp accepted the send. */
export async function sendText(input: SendInput, request: Request, sleep = n8nSleep): Promise<Json> {
  const sessionId = input.sessionId.trim();
  const path = sessionPath(sessionId);
  const target = recipient(input.to);
  const operation = input.operation ?? 'text';
  if (!['text', 'document', 'check'].includes(operation)) fail('INVALID_OPERATION', 'Select a valid Waxum operation.');
  if (operation === 'text' && !input.text.trim()) fail('EMPTY_MESSAGE', 'Enter a message.');
  if (operation === 'check' && target.group) fail('INVALID_CHECK_RECIPIENT', 'Checking a number requires an individual phone number.');
  if (operation === 'document') {
    let url: URL;
    try { url = new URL(input.media ?? ''); } catch { return fail('INVALID_DOCUMENT_URL', 'Enter the HTTP or HTTPS URL of the document.'); }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) fail('INVALID_DOCUMENT_URL', 'Enter a valid document URL.');
  }
  const options = input.options ?? {};
  const delayMs = options.delayMs ?? 0;
  if (!Number.isFinite(delayMs) || delayMs < 0 || delayMs > 10000) fail('INVALID_DELAY', 'Enter a delay from 0 to 10,000 ms.');
  await checkSession(sessionId, options.expectedSenderPhone, request);
  const { canonicalTo, exists } = await resolveTarget(target, path, request, operation === 'check');
  if (operation === 'check') {
    return { success: true, provider: 'waxum', data: [{ exists, jid: canonicalTo + '@s.whatsapp.net', number: target.to }] };
  }
  if (options.validationOnly === true) {
    return { success: true, provider: 'waxum', dryRun: true, messagesSent: 0,
      sessionId, sessionConnected: true, recipientResolved: true,
      preview: { to: target.to, canonicalTo, text: input.text, operation,
        ...(operation === 'document' ? { media: input.media, fileName: input.fileName, caption: input.caption } : {}) } };
  }
  if (delayMs) await sleep(delayMs);
  let response: Json;
  const body = operation === 'document'
    ? { to: canonicalTo, document: { url: input.media }, filename: input.fileName || 'document.pdf', caption: input.caption || '' }
    : { to: canonicalTo, text: input.text, link_preview: options.linkPreview === true };
  try { response = object(await request('POST', path + '/messages/' + operation, body)); }
  catch {
    fail('SEND_UNCERTAIN', 'Waxum did not confirm the send. Check the history and receipts before retrying to avoid duplicates.', true);
  }
  if (response.status !== 'sent' || typeof response.message_id !== 'string' || !response.message_id.trim()) {
    fail('SEND_UNCONFIRMED', 'Waxum did not confirm acceptance. Check the history before retrying.', true);
  }
  return { success: true, provider: 'waxum', accepted: true, deliveryStatus: 'unconfirmed',
    data: { key: { id: response.message_id, fromMe: true, remoteJid: target.group ? target.to : target.to + '@s.whatsapp.net' },
      message: operation === 'text' ? { conversation: input.text } : { documentMessage: { fileName: input.fileName, caption: input.caption } }, messageTimestamp: response.timestamp ?? null,
      status: 'PENDING', waxum: response }, waxum: { sessionId, canonicalTo } };
}
