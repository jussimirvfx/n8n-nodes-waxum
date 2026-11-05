import type { IAuthenticate, ICredentialTestRequest, ICredentialType, INodeProperties } from 'n8n-workflow';
import { apiBase, fail } from '../nodes/Waxum/transport';

export class WaxumApi implements ICredentialType {
  name = 'waxumApi';
  displayName = 'Waxum API';
  documentationUrl = 'https://github.com/jussimirvfx/n8n-nodes-waxum#credentials';
  icon = 'file:../nodes/Waxum/waxum.svg' as const;
  properties: INodeProperties[] = [
    { displayName: 'Waxum URL', name: 'baseUrl', type: 'string', default: '', placeholder: 'https://waxum.example.com', required: true, description: 'HTTPS URL of your Waxum server' },
    { displayName: 'API Token', name: 'apiToken', type: 'string', typeOptions: { password: true }, default: '', required: true },
  ];
  authenticate: IAuthenticate = async (credentials, request) => {
    const base = apiBase(String(credentials.baseUrl));
    const target = new URL(request.url, request.baseURL || base);
    if (target.origin !== new URL(base).origin || target.username || target.password) {
      fail('INVALID_URL', 'The request must use the configured Waxum server.');
    }
    return {
      ...request,
      headers: {...request.headers, Authorization: 'Bearer ' + credentials.apiToken},
      disableFollowRedirect: true,
    };
  };

  test: ICredentialTestRequest = {
    request: {
      method: 'GET',
      url: '={{ $credentials.baseUrl.trim().replace(/(?:\\/api\\/v1)?\\/?$/, "") + "/api/v1/sessions" }}',
      timeout: 10000,
      disableFollowRedirect: true,
    },
  };
}
