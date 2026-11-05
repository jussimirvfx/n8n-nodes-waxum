import type { IDataObject, IExecuteFunctions, INodeExecutionData, INodeType, INodeTypeDescription } from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import { apiBase, sendText, WaxumError, type SendInput } from './transport';

export class WaxumLegacy implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Waxum', name: 'waxum', icon: 'file:waxum.svg', group: ['output'], version: [1, 2], defaultVersion: 2,
    subtitle: '={{$parameter["operation"]}}',
    description: 'Send WhatsApp messages and check phone numbers in Waxum', defaults: { name: 'Waxum' },
    usableAsTool: true, inputs: [NodeConnectionTypes.Main], outputs: [NodeConnectionTypes.Main],
    credentials: [{ name: 'waxumApi', required: true }],
    properties: [
      { displayName: 'Operation', name: 'operation', type: 'options', noDataExpression: true, default: 'text', options: [
        { name: 'Send Text', value: 'text', action: 'Send text' },
        { name: 'Send Document', value: 'document', action: 'Send document' },
        { name: 'Check Phone Number', value: 'check', action: 'Check phone number' },
      ], displayOptions: { show: { '@version': [2] } } },
      { displayName: 'Session', name: 'sessionId', type: 'string', default: '', required: true, placeholder: 'my-session', description: 'ID of the connected Waxum session' },
      { displayName: 'Recipient', name: 'to', type: 'string', default: '', required: true, placeholder: '5547999999999', description: 'Phone number with country code or group ID ending in @g.us' },
      { displayName: 'Message', name: 'text', type: 'string', typeOptions: { rows: 5 }, default: '', required: true, displayOptions: { hide: { operation: ['document', 'check'] } } },
      { displayName: 'Document URL', name: 'media', type: 'string', default: '', required: true, displayOptions: { show: { operation: ['document'] } } },
      { displayName: 'File Name', name: 'fileName', type: 'string', default: '', displayOptions: { show: { operation: ['document'] } } },
      { displayName: 'Caption', name: 'caption', type: 'string', typeOptions: { rows: 4 }, default: '', displayOptions: { show: { operation: ['document'] } } },
      { displayName: 'Options', name: 'options', type: 'collection', placeholder: 'Add Option', default: {}, options: [
        { displayName: 'Validate Only', name: 'validationOnly', type: 'boolean', default: false, description: 'Whether to check the session and recipient without sending a message' },
        { displayName: 'Expected Sender Phone Number', name: 'expectedSenderPhone', type: 'string', default: '', description: 'Phone number that must be connected to the session' },
        { displayName: 'Delay Before Sending (Ms)', name: 'delayMs', type: 'number', typeOptions: { minValue: 0, maxValue: 10000 }, default: 0 },
        { displayName: 'Link Preview', name: 'linkPreview', type: 'boolean', default: false, description: 'Whether to include a link preview in the message' },
      ] },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const result: INodeExecutionData[] = [];
    const credential = await this.getCredentials('waxumApi');
    const base = apiBase(String(credential.baseUrl));
    // Runtime retries may duplicate accepted messages, even when the HTTP response was lost.
    if (this.getNode().retryOnFail) {
      throw new NodeOperationError(this.getNode(), 'Turn off Retry On Fail to avoid duplicate messages.');
    }
    for (let i = 0; i < items.length; i++) {
      try {
        const input: SendInput = {
          sessionId: String(this.getNodeParameter('sessionId', i, '') ?? ''),
          to: String(this.getNodeParameter('to', i, '') ?? ''),
          text: String(this.getNodeParameter('text', i, '') ?? ''),
          operation: this.getNodeParameter('operation', i, 'text') as SendInput['operation'],
          media: String(this.getNodeParameter('media', i, '') ?? ''),
          fileName: String(this.getNodeParameter('fileName', i, '') ?? ''),
          caption: String(this.getNodeParameter('caption', i, '') ?? ''),
          options: this.getNodeParameter('options', i, {}) as SendInput['options'],
        };
        const output = await sendText(input, async (method, path, body) => this.helpers.httpRequestWithAuthentication.call(this, 'waxumApi', {
          method, url: base + path, ...(body ? { body: body as IDataObject } : {}),
          json: true, timeout: 45000, disableFollowRedirect: true,
        }));
        if (output.waxum && typeof output.waxum === 'object') {
          output.waxum = { ...output.waxum as IDataObject, sourceWorkflowId: this.getWorkflow().id,
            sourceExecutionId: this.getExecutionId(), sourceNodeId: this.getNode().id };
        }
        result.push({ json: output as IDataObject, pairedItem: { item: i } });
      } catch (error) {
        const message = error instanceof WaxumError ? error.message : 'The Waxum request failed. Check the node settings.';
        if (this.continueOnFail()) {
          result.push({ json: { success: false, error: message,
            code: error instanceof WaxumError ? error.code : 'WAXUM_ERROR',
            uncertain: error instanceof WaxumError && error.uncertain }, pairedItem: { item: i },
            // n8n recognizes rich error envelopes on its error output through this marker.
            ...(this.getNode().onError === 'continueErrorOutput' ? {
              error: new NodeOperationError(this.getNode(), message, { itemIndex: i }),
            } : {}) });
        } else {
          throw new NodeOperationError(this.getNode(), message, { itemIndex: i,
            description: error instanceof WaxumError ? error.code : 'WAXUM_ERROR' });
        }
      }
    }
    return [result];
  }
}
