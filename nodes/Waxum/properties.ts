import type { INodeProperties } from 'n8n-workflow';
import { MEDIA_OPERATIONS, NO_DESTINATION, OPERATIONS } from './actions';

function field(displayName: string, name: string, type: INodeProperties['type'], value: unknown, operations: string[], extra: Partial<INodeProperties> = {}): INodeProperties {
  return {displayName, name, type, default: value as INodeProperties['default'], displayOptions: {show: {operation: operations}}, ...extra};
}

export const properties: INodeProperties[] = [
  {displayName: 'Operation', name: 'operation', type: 'options', noDataExpression: true, default: 'text',
    options: OPERATIONS.map(([value, name]) => ({name, value, action: name}))},
  {displayName: 'Session', name: 'sessionId', type: 'string', default: '', required: true,
    placeholder: 'my-session', description: 'ID of the authorized Waxum session'},
  {displayName: 'Recipient', name: 'to', type: 'string', default: '', required: true,
    placeholder: '5547999999999', description: 'Phone number with country code or a JID from the webhook, including group IDs and LIDs', displayOptions: {hide: {operation: NO_DESTINATION}}},
  field('Message', 'text', 'string', '', ['text', 'buttons', 'edit'], {required: true, typeOptions: {rows: 5}}),
  field('Media Source', 'mediaSource', 'options', 'url', MEDIA_OPERATIONS, {noDataExpression: true,
    options: [{name: 'HTTP or HTTPS URL', value: 'url'}, {name: 'N8n Binary File', value: 'binary'}, {name: 'Base64', value: 'base64'}]}),
  field('Media URL', 'media', 'string', '', MEDIA_OPERATIONS, {required: true, displayOptions: {show: {operation: MEDIA_OPERATIONS, mediaSource: ['url']}}}),
  field('Input Binary Field', 'binaryProperty', 'string', 'data', MEDIA_OPERATIONS, {required: true, displayOptions: {show: {operation: MEDIA_OPERATIONS, mediaSource: ['binary']}}}),
  field('Base64 Content', 'mediaBase64', 'string', '', MEDIA_OPERATIONS, {required: true, displayOptions: {show: {operation: MEDIA_OPERATIONS, mediaSource: ['base64']}}}),
  field('MIME Type', 'mimeType', 'string', '', MEDIA_OPERATIONS, {required: true, placeholder: 'image/jpeg', displayOptions: {show: {operation: MEDIA_OPERATIONS, mediaSource: ['base64']}}}),
  field('Caption', 'caption', 'string', '', ['image', 'video', 'document'], {typeOptions: {rows: 3}}),
  field('File Name', 'fileName', 'string', '', ['document'], {placeholder: 'proposal.pdf'}),
  field('Voice Message (PTT)', 'ptt', 'boolean', false, ['audio'], {description: 'Whether to send the audio as a voice message. Provide an OGG/Opus file.'}),
  field('Contact Name', 'contactName', 'string', '', ['contact'], {required: true}),
  field('Contact Phone Number', 'contactPhone', 'string', '', ['contact'], {required: true, placeholder: '5511999999999'}),
  field('Latitude', 'latitude', 'number', 0, ['location'], {required: true, typeOptions: {minValue: -90, maxValue: 90}}),
  field('Longitude', 'longitude', 'number', 0, ['location'], {required: true, typeOptions: {minValue: -180, maxValue: 180}}),
  field('Location Name', 'locationName', 'string', '', ['location']),
  field('Address', 'address', 'string', '', ['location']),
  field('Poll Question', 'pollName', 'string', '', ['poll'], {required: true}),
  field('Poll Options', 'pollOptions', 'json', '["Yes", "No"]', ['poll'], {required: true, description: 'JSON array of 2 to 12 distinct strings'}),
  field('Selectable Option Count', 'selectableCount', 'number', 1, ['poll'], {typeOptions: {minValue: 0, maxValue: 12}, description: 'Maximum number of choices a recipient can select. Zero allows all choices.'}),
  field('Buttons', 'buttons', 'json', '[{"button_id":"yes","display_text":"Yes"}]', ['buttons'], {required: true, description: 'Up to 3 buttons with button_id and display_text. Availability depends on WhatsApp and the channel.'}),
  field('Message ID', 'messageId', 'string', '', ['react', 'edit', 'receipts'], {required: true}),
  field('Emoji', 'emoji', 'string', '👍', ['react'], {required: true}),
  field('Message IDs', 'messageIds', 'json', '[]', ['read'], {required: true, description: 'JSON array of received message IDs'}),
  field('Chat State', 'chatState', 'options', 'composing', ['typing'], {options: [{name: 'Typing', value: 'composing'}, {name: 'Recording Audio', value: 'recording'}, {name: 'Paused', value: 'paused'}]}),
  field('Presence', 'presenceState', 'options', 'available', ['presence'], {options: [{name: 'Available', value: 'available'}, {name: 'Unavailable', value: 'unavailable'}]}),
  field('Limit', 'limit', 'number', 50, ['listContacts', 'listChats', 'searchMessages'], {typeOptions: {minValue: 1, maxValue: 200}}),
  field('Offset', 'offset', 'number', 0, ['listContacts'], {typeOptions: {minValue: 0, maxValue: 100000}}),
  field('Search Text', 'query', 'string', '', ['searchMessages'], {required: true}),
  field('Chat ID (JID)', 'chatJid', 'string', '', ['receipts'], {required: true, description: 'JID returned by Waxum, including @lid. For groups, the receipt summary covers at least one participant.'}),
  field('Received Media Metadata', 'mediaMetadata', 'json', '{}', ['downloadMedia'], {required: true, description: 'Object with direct_path, media_key, file_sha256, file_enc_sha256, file_length, and media_type'}),
  field('Output Binary Field', 'outputBinaryProperty', 'string', 'data', ['downloadMedia'], {required: true}),
  {displayName: 'Options', name: 'options', type: 'collection', placeholder: 'Add Option', default: {}, options: [
    {displayName: 'Delay Before Action (Ms)', name: 'delayMs', type: 'number', typeOptions: {minValue: 0, maxValue: 10000}, default: 0},
    {displayName: 'Expected Sender Phone Number', name: 'expectedSenderPhone', type: 'string', default: '', description: 'Phone number that must be connected to the session'},
    {displayName: 'Link Preview', name: 'linkPreview', type: 'boolean', default: false},
    {displayName: 'Reply to Message ID', name: 'replyTo', type: 'string', default: ''},
    {displayName: 'Validate Only', name: 'validationOnly', type: 'boolean', default: false, description: 'Whether to check inputs and connectivity without executing the operation'},
  ]},
];
