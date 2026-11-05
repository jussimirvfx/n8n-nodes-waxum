import { sleep as n8nSleep } from 'n8n-workflow';
import { checkSession, fail, object, recipient, resolveTarget, sessionPath, type Json, type Request } from './transport';

export const MAX_BINARY_BYTES = 16 * 1024 * 1024;
export const MEDIA_OPERATIONS = ['image', 'video', 'audio', 'sticker', 'document'];
export const NO_DESTINATION = ['sessionStatus', 'presence', 'listContacts', 'listChats', 'searchMessages', 'receipts', 'downloadMedia'];
export const STORED_OPERATIONS = ['sessionStatus', 'listContacts', 'listChats', 'searchMessages', 'receipts'];
export const OPERATIONS = [
  ['text', 'Send Text'], ['image', 'Send Image'], ['video', 'Send Video'],
  ['audio', 'Send Audio or Voice Message'], ['document', 'Send Document'], ['sticker', 'Send Sticker'],
  ['contact', 'Send Contact'], ['location', 'Send Location'], ['poll', 'Send Poll'], ['buttons', 'Send Buttons'],
  ['react', 'React to Message'], ['edit', 'Edit Sent Message'], ['read', 'Mark Messages as Read'],
  ['typing', 'Set Typing or Recording'], ['presence', 'Set Presence'], ['check', 'Check Phone Number'],
  ['contactInfo', 'Get Contact'], ['profilePicture', 'Get Contact Photo'],
  ['listContacts', 'List Contacts'], ['listChats', 'List Chats'], ['searchMessages', 'Search Messages'],
  ['receipts', 'Get Delivery and Read Receipts'], ['sessionStatus', 'Get Session Status'],
  ['downloadMedia', 'Download Received Media'],
] as const;

export interface ActionInput {
  operation: string; sessionId: string; to: string; text: string;
  fields: Json; mediaData?: Json;
  options: { validationOnly?: boolean; expectedSenderPhone?: string; delayMs?: number; linkPreview?: boolean; replyTo?: string };
}

export function required(value: unknown, label: string, max = 10000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail('INVALID_FIELD', 'Enter a valid value for ' + label + '.');
  return value;
}

export function boundedNumber(value: unknown, min: number, max: number, label: string, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    fail('INVALID_FIELD', label + ' must be between ' + min + ' and ' + max + '.');
  }
  return value as number;
}

export function jsonField(value: unknown, label: string): unknown {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return fail('INVALID_JSON', 'Invalid JSON in ' + label + '.'); }
}

export function replyButtonItems(value: unknown) {
  const items = jsonField(value, 'Buttons');
  if (!Array.isArray(items) || items.length < 1 || items.length > 3) {
    return fail('INVALID_BUTTONS', 'Provide 1 to 3 buttons.');
  }
  const buttons = items.map(item => {
    const button = object(item);
    return {id: required(button.button_id ?? button.id, 'Button ID', 100),
      display_text: required(button.display_text, 'Button Text', 40)};
  });
  if (new Set(buttons.map(button => button.id)).size !== buttons.length) {
    fail('INVALID_BUTTONS', 'Each button must have a unique ID.');
  }
  return buttons;
}

function enumField(value: unknown, choices: string[], label: string): string {
  if (typeof value !== 'string' || !choices.includes(value)) fail('INVALID_FIELD', label + ' is invalid.');
  return value as string;
}

export function chatJid(value: unknown): string {
  const input = required(value, 'Chat ID', 160).trim();
  if (/^\d{5,30}(?:-\d{5,20})?@(s\.whatsapp\.net|g\.us|lid)$/.test(input)) return input;
  const parsed = recipient(input);
  return parsed.group ? parsed.to : parsed.to + '@s.whatsapp.net';
}

export function destination(value: string): {to: string; group: boolean} {
  if (/^\d{5,30}@lid$/.test(value.trim())) return {to: value.trim(), group: false};
  return recipient(value);
}

function media(input: ActionInput): Json {
  if (input.mediaData) {
    const mime = String(input.mediaData.mimetype || '').toLowerCase();
    const expected = input.operation === 'audio' ? 'audio/' : input.operation === 'video' ? 'video/' : 'image/';
    if (input.operation !== 'document' && !mime.startsWith(expected)) fail('INVALID_MEDIA_TYPE', 'The file type does not match the selected operation.');
    if (input.operation === 'sticker' && mime !== 'image/webp') fail('INVALID_MEDIA_TYPE', 'Provide a WebP sticker.');
    return input.mediaData;
  }
  const url = required(input.fields.media, 'Media URL', 4096);
  let parsed: URL;
  try { parsed = new URL(url); } catch { return fail('INVALID_MEDIA_URL', 'Enter a valid media URL.'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.hash) {
    fail('INVALID_MEDIA_URL', 'Enter an HTTP or HTTPS media URL without credentials.');
  }
  // Waxum fetches the media through its own SSRF guard; its bearer token never goes to this URL.
  return {url};
}

export function mediaMetadata(value: unknown): Json {
  const data = object(jsonField(value, 'Received Media Metadata'));
  const length = boundedNumber(Number(data.file_length ?? data.fileLength), 1, MAX_BINARY_BYTES, 'Media Size', true);
  const type = enumField(data.media_type ?? data.mediaType, MEDIA_OPERATIONS, 'Media Type');
  return {
    direct_path: required(data.direct_path ?? data.directPath, 'Media Direct Path', 4096),
    media_key: required(data.media_key ?? data.mediaKey, 'Media Key', 256),
    file_sha256: required(data.file_sha256 ?? data.fileSha256, 'Media Hash', 256),
    file_enc_sha256: required(data.file_enc_sha256 ?? data.fileEncSha256, 'Encrypted Media Hash', 256),
    file_length: length, media_type: type,
  };
}

export function decodedMedia(response: unknown): Buffer {
  const result = object(response);
  const data = required(result.data, 'Media Content', Math.ceil(MAX_BINARY_BYTES / 3) * 4 + 4);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data) || data.length % 4 !== 0) fail('INVALID_MEDIA_RESPONSE', 'Waxum returned invalid media.');
  const buffer = Buffer.from(data, 'base64');
  if (!buffer.length || buffer.length > MAX_BINARY_BYTES || result.size !== buffer.length || buffer.toString('base64') !== data) {
    fail('INVALID_MEDIA_RESPONSE', 'The returned media has an invalid size.');
  }
  return buffer;
}

export function mediaFileInfo(buffer: Buffer, kind: string): {fileName: string; mimeType: string} {
  const start = buffer.subarray(0, 16), ascii = start.toString('ascii');
  let extension = 'bin', mime = 'application/octet-stream';
  if (ascii.startsWith('OggS')) {extension = 'ogg'; mime = 'audio/ogg';}
  else if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WAVE') {extension = 'wav'; mime = 'audio/wav';}
  else if (ascii.startsWith('ID3') || (start[0] === 0xff && ((start[1] ?? 0) & 0xe0) === 0xe0)) {extension = 'mp3'; mime = 'audio/mpeg';}
  else if (ascii.slice(4, 8) === 'ftyp') {extension = kind === 'audio' ? 'm4a' : 'mp4'; mime = kind === 'audio' ? 'audio/mp4' : 'video/mp4';}
  else if (start[0] === 0xff && start[1] === 0xd8) {extension = 'jpg'; mime = 'image/jpeg';}
  else if (start.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {extension = 'png'; mime = 'image/png';}
  else if (ascii.startsWith('GIF8')) {extension = 'gif'; mime = 'image/gif';}
  else if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP') {extension = 'webp'; mime = 'image/webp';}
  else if (ascii.startsWith('%PDF')) {extension = 'pdf'; mime = 'application/pdf';}
  return {fileName: 'midia.' + extension, mimeType: mime};
}

function bodyFor(input: ActionInput): Json {
  const f = input.fields, op = input.operation;
  const reply = input.options.replyTo ? {reply_to: required(input.options.replyTo, 'Replied Message ID', 200)} : {};
  if (MEDIA_OPERATIONS.includes(op)) {
    const body: Json = {[op]: media(input), ...reply};
    if (['image', 'video', 'document'].includes(op)) body.caption = String(f.caption ?? '');
    if (op === 'document') body.filename = required(f.fileName || 'document.pdf', 'File Name', 255);
    if (op === 'audio') body.ptt = f.ptt === true;
    return body;
  }
  switch (op) {
    case 'text': return {text: required(input.text, 'Message'), link_preview: input.options.linkPreview === true, ...reply};
    case 'contact': return {contact: {display_name: required(f.contactName, 'Contact Name', 200), phones: [{number: recipient(required(f.contactPhone, 'Contact Phone Number')).to, phone_type: 'CELL'}]}, ...reply};
    case 'location': return {latitude: boundedNumber(f.latitude, -90, 90, 'Latitude'), longitude: boundedNumber(f.longitude, -180, 180, 'Longitude'), name: String(f.locationName ?? ''), address: String(f.address ?? ''), ...reply};
    case 'poll': {
      const options = jsonField(f.pollOptions, 'Poll Options');
      if (!Array.isArray(options) || options.length < 2 || options.length > 12 || options.some(v => typeof v !== 'string' || !v.trim() || v.length > 100) || new Set(options).size !== options.length) fail('INVALID_POLL', 'Provide 2 to 12 distinct poll options.');
      return {name: required(f.pollName, 'Poll Question', 255), options, selectable_count: boundedNumber(f.selectableCount ?? 1, 0, options.length, 'Selectable Option Count', true), ...reply};
    }
    case 'buttons': {
      const buttons = replyButtonItems(f.buttons).map(({id, display_text}) => ({button_id: id, display_text}));
      return {content_text: required(input.text, 'Message'), buttons, ...reply};
    }
    case 'react': return {message_id: required(f.messageId, 'Message ID', 200), emoji: required(f.emoji, 'Emoji', 32)};
    case 'edit': return {message_id: required(f.messageId, 'Message ID', 200), text: required(input.text, 'Message')};
    case 'typing': return {state: enumField(f.chatState, ['composing', 'recording', 'paused'], 'Chat State')};
    case 'presence': return {status: enumField(f.presenceState, ['available', 'unavailable'], 'Presence')};
    case 'read': {
      const ids = jsonField(f.messageIds, 'Message IDs');
      if (!Array.isArray(ids) || !ids.length || ids.length > 100) fail('INVALID_MESSAGE_IDS', 'Provide 1 to 100 message IDs.');
      return {message_ids: ids.map(id => required(id, 'Message ID', 200))};
    }
    default: return {};
  }
}

export async function runAction(input: ActionInput, request: Request, sleep = n8nSleep): Promise<Json> {
  const op = input.operation;
  if (!OPERATIONS.some(([value]) => value === op)) fail('INVALID_OPERATION', 'Select a valid Waxum operation.');
  const sid = input.sessionId.trim(), path = sessionPath(sid), f = input.fields;
  // Validate all parameters before any request or effect.
  const target = NO_DESTINATION.includes(op) ? null : destination(input.to);
  if (target && (target.group || target.to.endsWith('@lid')) && ['check', 'contactInfo'].includes(op)) fail('INVALID_RECIPIENT', 'This lookup requires an individual phone number.');
  const body = bodyFor(input);
  let method: 'GET' | 'POST' = 'POST', suffix = '', payload: Json | undefined, storedJid = '';
  const limit = ['listContacts', 'listChats', 'searchMessages'].includes(op) ? boundedNumber(f.limit ?? 50, 1, 200, 'Limit', true) : 0;
  switch (op) {
    case 'listContacts': suffix = '/contacts?limit=' + limit + '&offset=' + boundedNumber(f.offset ?? 0, 0, 100000, 'Offset', true); method = 'GET'; break;
    case 'listChats': suffix = '/store/chats?limit=' + limit; method = 'GET'; break;
    case 'searchMessages': suffix = '/store/search?q=' + encodeURIComponent(required(f.query, 'Search Text', 500)) + '&limit=' + limit; method = 'GET'; break;
    case 'receipts': storedJid = chatJid(f.chatJid); suffix = '/store/chats/' + encodeURIComponent(storedJid) + '/messages/' + encodeURIComponent(required(f.messageId, 'Message ID', 200)) + '/receipts'; method = 'GET'; break;
    case 'downloadMedia': payload = mediaMetadata(f.mediaMetadata); suffix = '/media/download'; break;
    case 'presence': suffix = '/presence/set'; payload = body; break;
  }
  const delay = boundedNumber(input.options.delayMs ?? 0, 0, 10000, 'Delay Before Action', true);
  const session = await checkSession(sid, input.options.expectedSenderPhone, request, !STORED_OPERATIONS.includes(op));
  if (op === 'sessionStatus') return {success: true, provider: 'waxum', operation: op, data: session, waxum: {sessionId: sid}};
  let canonical = '';
  if (target) {
    const resolved = await resolveTarget(target, path, request, op === 'check'); canonical = resolved.canonicalTo;
    if (op === 'check') return {success: true, provider: 'waxum', data: [{exists: resolved.exists, jid: canonical.includes('@') ? canonical : canonical + '@s.whatsapp.net', number: target.to}], waxum: {sessionId: sid}};
    switch (op) {
      case 'contactInfo': suffix = '/contacts/info'; payload = {phones: [canonical]}; break;
      case 'profilePicture': suffix = '/contacts/' + encodeURIComponent(canonical.includes('@') ? canonical : canonical + '@s.whatsapp.net') + '/picture'; method = 'GET'; break;
      case 'typing': suffix = '/chatstate/send'; payload = {...body, to: canonical}; break;
      case 'read': suffix = '/messages/read'; payload = {...body, chat_jid: canonical.includes('@') ? canonical : canonical + '@s.whatsapp.net'}; break;
      default: suffix = '/messages/' + op; payload = {...body, to: canonical};
    }
  }
  const mutates = !['contactInfo', 'profilePicture', 'listContacts', 'listChats', 'searchMessages', 'receipts', 'downloadMedia'].includes(op);
  const sendsMessage = ['text', ...MEDIA_OPERATIONS, 'contact', 'location', 'poll', 'buttons', 'react', 'edit'].includes(op);
  if (input.options.validationOnly) return {success: true, provider: 'waxum', dryRun: true, messagesSent: 0, operation: op, sessionId: sid, sessionConnected: session.is_logged_in === true, recipientResolved: Boolean(target), preview: {method, path: path + suffix, canonicalTo: canonical || null}};
  if (mutates && delay) await sleep(delay);
  let response: unknown;
  try { response = await request(method, path + suffix, payload); }
  catch {
    if (mutates) fail('ACTION_UNCERTAIN', 'Waxum did not confirm the action. Check the history before retrying to avoid duplicates.', true);
    return fail('QUERY_FAILED', 'The Waxum lookup failed. Check the session and input fields.');
  }
  const result = object(response), context = {sessionId: sid, ...(canonical ? {canonicalTo: canonical} : {})};
  if (sendsMessage) {
    if (!result.message_id || typeof result.message_id !== 'string' || !result.message_id.trim() || (result.status !== undefined && result.status !== 'sent')) fail('SEND_UNCONFIRMED', 'Waxum did not confirm acceptance. Check the history before retrying.', true);
    return {success: true, provider: 'waxum', operation: op, accepted: true, deliveryStatus: 'unconfirmed', data: {key: {id: result.message_id, fromMe: true, remoteJid: canonical.includes('@') ? canonical : canonical + '@s.whatsapp.net'}, status: 'PENDING', messageTimestamp: result.timestamp ?? null, waxum: result}, waxum: context};
  }
  if (result.success === false) fail('ACTION_REJECTED', 'Waxum rejected the action. Check its configuration.');
  if (op === 'receipts') {
    if (!Array.isArray(response)) fail('INVALID_RECEIPTS', 'Waxum returned receipts in an unexpected format.');
    const statuses = response.map(value => Number(object(value).status)).filter(n => Number.isInteger(n) && n >= 0 && n <= 5);
    const rank = statuses.length ? Math.max(...statuses) : -1;
    return {success: true, provider: 'waxum', operation: op, deliveryStatus: rank >= 4 ? 'read' : rank === 3 ? 'delivered' : rank === 2 ? 'sent' : rank === 1 ? 'pending' : rank === 0 ? 'failed' : 'unconfirmed', deliveryScope: storedJid.endsWith('@g.us') ? 'at_least_one_participant' : 'recipient', data: response, waxum: context};
  }
  return {success: true, provider: 'waxum', operation: op, ...(mutates ? {actionAccepted: true} : {}), data: response, waxum: context};
}
