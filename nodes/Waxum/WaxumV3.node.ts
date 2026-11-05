import type { IDataObject, IExecuteFunctions, INodeExecutionData, INodeType, INodeTypeDescription } from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import { apiBase, object, fail, WaxumError, type Json, type Request } from './transport';
import { MAX_BINARY_BYTES, MEDIA_OPERATIONS, decodedMedia, mediaFileInfo, mediaMetadata, required, runAction, type ActionInput } from './actions';
import { properties } from './properties';

const FIELD_DEFAULTS: Json = {ptt: false, selectableCount: 1, limit: 50, offset: 0};
const FIELD_NAMES = ['media', 'fileName', 'caption', 'ptt', 'contactName', 'contactPhone', 'latitude', 'longitude', 'locationName', 'address', 'pollName', 'pollOptions', 'selectableCount', 'buttons', 'messageId', 'emoji', 'messageIds', 'chatState', 'presenceState', 'limit', 'offset', 'query', 'chatJid', 'mediaMetadata'];

function sizedBuffer(buffer: Buffer): Buffer {
  if (!buffer.length || buffer.length > MAX_BINARY_BYTES) fail('MEDIA_SIZE_LIMIT', 'Provide a non-empty file up to 16 MiB.');
  return buffer;
}

function validMime(value: string): string {
  if (!/^[\w.+-]+\/[\w.+-]+(?:;\s*codecs=[\w-]+)?$/.test(value)) fail('INVALID_MIME', 'Enter a valid MIME type, such as audio/ogg or image/jpeg.');
  return value;
}

async function binaryInput(context: IExecuteFunctions, index: number): Promise<{buffer: Buffer; fileName: string; mimeType: string}> {
  const property = String(context.getNodeParameter('binaryProperty', index, 'data'));
  const meta = context.helpers.assertBinaryData(index, property);
  const buffer = sizedBuffer(await context.helpers.getBinaryDataBuffer(index, property));
  const guessed = mediaFileInfo(buffer, meta.mimeType?.startsWith('audio/') ? 'audio' : 'file');
  return {buffer, fileName: meta.fileName || guessed.fileName, mimeType: validMime(meta.mimeType || guessed.mimeType)};
}

export class WaxumV3 implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Waxum', name: 'waxum', icon: 'file:waxum.svg', group: ['output'], version: 3,
    subtitle: '={{$parameter["operation"]}}',
    description: 'Work with WhatsApp messages, media, contacts, and sessions in Waxum', defaults: {name: 'Waxum'},
    usableAsTool: true, inputs: [NodeConnectionTypes.Main], outputs: [NodeConnectionTypes.Main],
    credentials: [{name: 'waxumApi', required: true}], properties,
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const result: INodeExecutionData[] = [];
    const usesSessionLocator = this.getNode().typeVersion >= 4;
    const credentialType = 'waxumApi';
    if (this.getNode().retryOnFail) throw new NodeOperationError(this.getNode(), 'Turn off Retry On Fail to avoid duplicate messages or actions.');
    for (let i = 0; i < this.getInputData().length; i++) {
      try {
        const parameter = (name: string, fallback: unknown = '') => this.getNodeParameter(name, i, fallback as never);
        const operation = String(parameter('operation', 'text'));
        const options = object(parameter('options', {})) as ActionInput['options'];
        let base = '';
        const request: Request = async (method, path, body) => {
          if (!base) base = apiBase(String((await this.getCredentials(credentialType)).baseUrl));
          return this.helpers.httpRequestWithAuthentication.call(this, credentialType, {method, url: base + path,
            ...(body ? {body: body as IDataObject} : {}), json: true, timeout: 45000, disableFollowRedirect: true});
        };
        let binary: INodeExecutionData['binary'];
        const session = parameter('sessionId');
        const sessionId = usesSessionLocator && typeof session !== 'string' ? object(session).value ?? '' : session;
        const input: ActionInput = {operation, sessionId: String(sessionId), to: String(parameter('to')),
          text: String(parameter('text')), fields: Object.fromEntries(FIELD_NAMES.map(key => [key, parameter(key, FIELD_DEFAULTS[key] ?? '')])), options};
        if (MEDIA_OPERATIONS.includes(operation)) {
          const source = String(parameter('mediaSource', 'url'));
          if (source === 'binary') {
            const file = await binaryInput(this, i);
            input.mediaData = {data: file.buffer.toString('base64'), mimetype: file.mimeType};
            if (!input.fields.fileName) input.fields.fileName = file.fileName;
          } else if (source === 'base64') {
            const value = required(parameter('mediaBase64'), 'Base64 Content', Math.ceil(MAX_BINARY_BYTES / 3) * 4 + 4);
            const buffer = Buffer.from(value, 'base64'); sizedBuffer(buffer);
            if (buffer.toString('base64') !== value) fail('INVALID_BASE64', 'Enter the file as a valid Base64 string.');
            input.mediaData = {data: value, mimetype: validMime(String(parameter('mimeType')))};
          } else if (source !== 'url') fail('INVALID_MEDIA_SOURCE', 'Select a valid media source.');
        }
        const output = await runAction(input, request);
        if (operation === 'downloadMedia' && !options.validationOnly) {
          const buffer = decodedMedia(output.data), metadata = mediaMetadata(input.fields.mediaMetadata);
          const kind = String(metadata.media_type), file = mediaFileInfo(buffer, kind);
          const property = required(parameter('outputBinaryProperty', 'data'), 'Output Binary Field', 100);
          binary = {[property]: await this.helpers.prepareBinaryData(buffer, file.fileName, file.mimeType)};
          output.data = {size: buffer.length, mediaType: kind, binaryProperty: property};
        }
        output.waxum = {...object(output.waxum), sourceWorkflowId: this.getWorkflow().id, sourceExecutionId: this.getExecutionId(), sourceNodeId: this.getNode().id};
        result.push({json: output as IDataObject, pairedItem: {item: i}, ...(binary ? {binary} : {})});
      } catch (error) {
        const message = error instanceof WaxumError ? error.message : 'The action failed. Check the input fields and selected credentials.';
        if (!this.continueOnFail()) throw new NodeOperationError(this.getNode(), message, {itemIndex: i, description: error instanceof WaxumError ? error.code : 'WAXUM_ERROR'});
        result.push({json: {success: false, error: message, code: error instanceof WaxumError ? error.code : 'WAXUM_ERROR', uncertain: error instanceof WaxumError && error.uncertain}, pairedItem: {item: i},
          ...(this.getNode().onError === 'continueErrorOutput' ? {error: new NodeOperationError(this.getNode(), message, {itemIndex: i})} : {})});
      }
    }
    return [result];
  }
}
