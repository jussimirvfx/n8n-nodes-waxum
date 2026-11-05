import type { IDataObject, IExecuteFunctions, INodeExecutionData, INodeProperties, INodePropertyOptions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { WaxumV4 } from './WaxumV4';
import { actions, categories } from './catalog.generated';
import type { ApiChannel, CatalogAction, CatalogField } from './catalog-types';
import { MAX_BINARY_BYTES, OPERATIONS, destination, jsonField, replyButtonItems, required } from './actions';
import { apiBase, fail, object, resolveTarget, sessionPath, WaxumError } from './transport';

const channels = [
  {name: 'WhatsApp Web (Unofficial)', value: 'web'},
  {name: 'WhatsApp Cloud API (Official)', value: 'cloud'},
] as const;
const validatedCategory = 'validated';
const validatedOptions = OPERATIONS.map(([value, name]) => ({value, name, action: name}));
const byId = new Map(actions.map(action => [action.id, action]));
const globalActions = actions.filter(action => !action.path.includes('{sid}')).map(action => action.id);
const isAvailable = (action: CatalogAction, channel: ApiChannel) => !action.channel || action.channel === channel;
const argName = (field: CatalogField) => 'arg_' + field.name;
const resourceId = (channel: ApiChannel, group: string) => channel + ':' + group;

function operationFields(action: CatalogAction): INodeProperties[] {
  return action.fields.map(field => {
    const type = {text: 'string', textarea: 'string', file: 'string', checkbox: 'boolean',
      number: 'number', json: 'json', select: 'options'}[field.type] as INodeProperties['type'];
    const defaultValue = field.default ?? (field.type === 'checkbox' ? false
      : field.type === 'select' ? field.options?.[0] ?? '' : field.type === 'file' ? 'data' : '');
    return {
      name: argName(field), displayName: field.label || field.name, type,
      default: defaultValue, required: field.required || field.in_path,
      displayOptions: {show: {operation: [action.id]}},
      placeholder: field.placeholder,
      ...(field.type === 'select' ? {options: field.options?.map(option => ({name: option, value: option}))} : {}),
      ...(field.type === 'textarea' ? {typeOptions: {rows: 4}} : {}),
      ...(field.type === 'file' ? {description: 'Name of the input binary field containing the file'} : {}),
      ...(/(?:^|_)(?:token|secret|password|pin|media_key)(?:$|_)/i.test(field.name)
        ? {typeOptions: {password: true}} : {}),
    };
  });
}

function catalogProperties(legacy: INodeProperties[], version: 5 | 6): INodeProperties[] {
  const resources: INodePropertyOptions[] = [];
  const nativeResources = version === 6;
  const properties: INodeProperties[] = [nativeResources
    ? {displayName: 'Category', name: 'resource', type: 'options',
        default: 'web:info', noDataExpression: true, options: resources}
    : {displayName: 'Channel', name: 'apiChannel', type: 'hidden', default: 'web',
        noDataExpression: true, options: [...channels]}];
  for (const {value: channel} of channels) {
    const available = actions.filter(action => isAvailable(action, channel));
    const groups = new Map<string, INodePropertyOptions[]>();
    for (const action of available) {
      const options = groups.get(action.group) ?? [];
      options.push({name: action.label, value: action.id, action: action.label});
      groups.set(action.group, options);
    }
    if (channel === 'web') groups.set(validatedCategory, validatedOptions);
    const optionsByGroup = Array.from(groups, ([group, options]) => ({
      name: (categories[group] ?? 'Validated Actions') +
        ' (' + options.length + ')', value: group,
    }));
    if (!nativeResources) properties.push({
      displayName: 'Category', name: 'category', type: 'hidden', noDataExpression: true,
      default: 'info', displayOptions: {show: {apiChannel: [channel]}},
      options: optionsByGroup,
    });
    for (const option of optionsByGroup) {
      const group = option.value;
      const options = groups.get(group)!;
      if (nativeResources) {
        const channelLabel = channel === 'web' ? 'Web' : 'Cloud API';
        resources.push({name: channelLabel + ' · ' + (categories[group] ?? 'Validated Actions'),
          value: resourceId(channel, group)});
      }
      properties.push({
        displayName: 'Operation', name: 'operation', type: 'options', noDataExpression: true,
        default: String(options[0].value), options,
        displayOptions: {show: nativeResources ? {resource: [resourceId(channel, group)]}
          : {apiChannel: [channel], category: [group]}},
      });
    }
  }
  const legacyVisibility = nativeResources
    ? {resource: ['web:validated']} : {apiChannel: ['web'], category: [validatedCategory]};
  for (const property of legacy) {
    if (property.name === 'sessionId') {
      properties.push({...property,
        ...(nativeResources ? {typeOptions: {...property.typeOptions, loadOptionsDependsOn: ['resource']}} : {}),
        displayOptions: {hide: {operation: globalActions}},
      });
      continue;
    }
    if (property.name !== 'operation') {
      properties.push({...property, displayOptions: {...property.displayOptions,
        show: {...property.displayOptions?.show, ...legacyVisibility}}});
    }
  }
  properties.push(...actions.flatMap(operationFields));
  properties.push({displayName: 'Confirm Sensitive Operation', name: 'confirmAction', type: 'boolean',
    default: false, noDataExpression: true,
    description: 'Whether to allow this operation, which can delete data, change access, or interrupt sessions',
    displayOptions: {show: {operation: actions.filter(action => action.confirm).map(action => action.id)}}});
  return properties;
}

async function requestParts(context: IExecuteFunctions, index: number, action: CatalogAction, sessionId: string, channel: ApiChannel) {
  const query = new URLSearchParams();
  const body: Record<string, unknown> = {};
  const files: Array<{name: string; file: Blob; fileName: string}> = [];
  let path = action.path.includes('{sid}') ? action.path.replace('{sid}', sessionPath(sessionId).slice('/sessions/'.length)) : action.path;
  const replyButtons = action.id === 'send/buttons';
  const quickReply = action.id === 'send/quick-reply' || (replyButtons && channel === 'web');
  // The Web transport adds interactive message metadata for native quick replies.
  if (replyButtons && quickReply) path = path.replace(/\/buttons$/, '/quick-reply');
  for (const field of action.fields) {
    const value = context.getNodeParameter(argName(field), index, field.type === 'checkbox' ? false : '');
    if (value === undefined || value === null || value === '') {
      if (field.required || field.in_path) fail('INVALID_FIELD', 'Enter ' + (field.label || field.name) + '.');
      continue;
    }
    if (field.type === 'file') {
      const property = required(value, 'Input Binary Field', 100);
      const metadata = context.helpers.assertBinaryData(index, property);
      const buffer = await context.helpers.getBinaryDataBuffer(index, property);
      if (!buffer.length || buffer.length > MAX_BINARY_BYTES) fail('MEDIA_SIZE_LIMIT', 'Provide a non-empty file up to 16 MiB.');
      files.push({name: field.name, file: new Blob([new Uint8Array(buffer)], {
        type: metadata.mimeType || 'application/octet-stream',
      }), fileName: metadata.fileName || 'file'});
      continue;
    }
    const parsed = field.type === 'json' ? jsonField(value, field.label || field.name) : value;
    if (field.in_path) {
      const segment = String(parsed);
      if (!segment.trim() || segment === '.' || segment === '..') fail('INVALID_FIELD', 'Invalid ID: ' + field.name + '.');
      path = path.replace('{' + field.name + '}', encodeURIComponent(segment));
    } else if (field.in_query || action.method === 'GET') query.set(field.name,
      parsed !== null && typeof parsed === 'object' ? JSON.stringify(parsed) : String(parsed));
    else {
      const name = field.name === 'text' && (replyButtons || quickReply)
        ? quickReply ? 'body_text' : 'content_text'
        : quickReply && field.name === 'footer' ? 'footer_text' : field.name;
      body[name] = quickReply && field.name === 'buttons' ? replyButtonItems(parsed) : parsed;
    }
  }
  const params = query.toString();
  if (params) path += '?' + params;
  if (files.length) {
    const form = new FormData();
    for (const [key, value] of Object.entries(body)) form.append(key,
      typeof value === 'object' ? JSON.stringify(value) : String(value));
    for (const {name, file, fileName} of files) form.append(name, file, fileName);
    return {path, body: form};
  }
  const content = action.rawBody ? body[action.rawBody] : Object.keys(body).length ? body : undefined;
  return {path, body: content as IDataObject | undefined};
}

export class WaxumV5 extends WaxumV4 {
  constructor(version: 5 | 6 = 5) {
    super();
    this.description = {...this.description, version, properties: catalogProperties(this.description.properties, version)};
  }

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    if (!this.getInputData().length) return [[]];
    const operation = String(this.getNodeParameter('operation', 0));
    const [channel, category] = this.getNode().typeVersion === 6
      ? String(this.getNodeParameter('resource', 0)).split(':')
      : [this.getNodeParameter('apiChannel', 0, 'web'), this.getNodeParameter('category', 0)];
    if (channel === 'web' && category === validatedCategory && validatedOptions.some(option => option.value === operation)) {
      return WaxumV4.prototype.execute.call(this);
    }
    if (this.getNode().retryOnFail) throw new NodeOperationError(this.getNode(),
      'Turn off Retry On Fail to avoid duplicate actions.');
    const action = byId.get(operation);
    if (!action || (channel !== 'web' && channel !== 'cloud') || !isAvailable(action, channel) || action.group !== category) {
      throw new NodeOperationError(this.getNode(), 'Select an operation available for the chosen resource and channel.');
    }
    const results: INodeExecutionData[] = [];
    for (let index = 0; index < this.getInputData().length; index++) {
      try {
        if (action.confirm && this.getNodeParameter('confirmAction', index, false) !== true) {
          fail('CONFIRM_ACTION', 'Enable Confirm Sensitive Operation to run this operation.');
        }
        const selected = this.getNodeParameter('sessionId', index, '');
        const sessionId = typeof selected === 'string' ? selected : String(object(selected).value ?? '');
        const parts = await requestParts(this, index, action, sessionId, channel);
        const credentials = await this.getCredentials('waxumApi');
        const base = apiBase(String(credentials.baseUrl));
        const request = this.helpers.httpRequestWithAuthentication.bind(this);
        const path = action.path.includes('{sid}') ? sessionPath(sessionId) : '';
        if (path) {
          const session = object(await request('waxumApi', {
            method: 'GET', url: base + path, json: true, timeout: 10000, disableFollowRedirect: true,
          }));
          const expectedProvider = channel === 'cloud' ? 'whatsapp_cloud' : 'whatsapp_web';
          if (session.id !== sessionId || session.provider !== expectedProvider) {
            fail('CHANNEL_MISMATCH', 'The selected session belongs to another channel.');
          }
        }
        if (parts.path === path + '/messages/quick-reply' && channel === 'web') {
          const body = object(parts.body);
          const target = destination(required(body.to, 'Recipient'));
          const resolved = await resolveTarget(target, path, (method, lookupPath, data) =>
            request('waxumApi', {method, url: base + lookupPath, body: data as IDataObject,
              json: true, timeout: 10000, disableFollowRedirect: true}));
          body.to = resolved.canonicalTo;
        }
        const response = await request('waxumApi', {
          method: action.method, url: base + parts.path, ...(parts.body !== undefined ? {body: parts.body} : {}),
          ...(action.download ? {encoding: 'arraybuffer' as const, returnFullResponse: true} : {json: true}),
          timeout: 45000, disableFollowRedirect: true,
        });
        let data = response === undefined || response === '' ? null : response;
        let binary: INodeExecutionData['binary'];
        if (action.download) {
          const reply = object(response);
          const buffer = Buffer.isBuffer(reply.body) ? reply.body : reply.body instanceof ArrayBuffer ? Buffer.from(reply.body) : null;
          if (!buffer?.length || buffer.length > MAX_BINARY_BYTES) fail('MEDIA_SIZE_LIMIT', 'The returned file must be no larger than 16 MiB.');
          const mimeType = String(object(reply.headers)['content-type'] ?? 'application/octet-stream').split(';')[0];
          const extension = action.id === 'info/export' ? 'zip' : (mimeType.split('/')[1] || 'bin').replace(/[^a-z0-9]/gi, '');
          binary = {data: await this.helpers.prepareBinaryData(buffer, 'waxum.' + (extension || 'bin'), mimeType)};
          data = {binaryProperty: 'data', size: buffer.length, mimeType};
        }
        const reply = object(data);
        const buttonAccepted = (operation === 'send/buttons' || operation === 'send/quick-reply') &&
          reply.status === 'sent' && typeof reply.message_id === 'string' && reply.message_id.length > 0;
        results.push({json: {success: true, provider: 'waxum', operation, data,
          ...(buttonAccepted ? {accepted: true, deliveryStatus: 'unconfirmed'} : {}),
          waxum: {sourceWorkflowId: this.getWorkflow().id, sourceExecutionId: this.getExecutionId(), sourceNodeId: this.getNode().id}},
          pairedItem: {item: index}, ...(binary ? {binary} : {})});
      } catch (error) {
        const code = error instanceof WaxumError ? error.code : 'WAXUM_API_ERROR';
        const status = Number(object(error).httpCode ?? object(error).statusCode);
        const message = error instanceof WaxumError ? error.message :
          status === 401 || status === 403 ? 'The Waxum credential does not have permission for this operation or session.' :
            Number.isInteger(status) && status >= 400 && status <= 599 ? 'Waxum returned HTTP ' + status + '.' :
              'Waxum did not confirm the operation. Check the result before retrying.';
        const detail = new NodeOperationError(this.getNode(), message, {itemIndex: index, description: code});
        if (!this.continueOnFail()) throw detail;
        results.push({json: {success: false, error: message, code}, pairedItem: {item: index},
          ...(this.getNode().onError === 'continueErrorOutput' ? {error: detail} : {})});
      }
    }
    return [results];
  }
}
