import type { ILoadOptionsFunctions, INodeListSearchResult } from 'n8n-workflow';
import { WaxumV3 } from './WaxumV3.node';
import { apiBase, object } from './transport';
import { languageParameter, portuguese } from './localization';

async function searchSessions(this: ILoadOptionsFunctions, filter = ''): Promise<INodeListSearchResult> {
  const credentials = await this.getCredentials('waxumApi');
  const url = apiBase(String(credentials.baseUrl)) + '/sessions';
  const response = object(await this.helpers.httpRequestWithAuthentication.call(this, 'waxumApi', {
    method: 'GET', url, json: true, timeout: 10000, disableFollowRedirect: true,
  }));
  const parameters = this.getCurrentNodeParameters?.();
  const isPortuguese = parameters?.[languageParameter] === portuguese;
  if (!Array.isArray(response.sessions)) throw new Error(isPortuguese
    ? 'O Waxum não retornou a lista de sessões.'
    : 'Waxum did not return a session list.');
  const channel = typeof parameters?.resource === 'string'
    ? parameters.resource.split(':')[0] : parameters?.apiChannel;
  const query = filter.trim().toLowerCase();
  const results: INodeListSearchResult['results'] = [];
  for (const row of response.sessions) {
    const { id, name, provider, is_logged_in: connected } = object(row);
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) continue;
    if (channel === 'web' && provider !== 'whatsapp_web' || channel === 'cloud' && provider !== 'whatsapp_cloud') continue;
    const label = typeof name === 'string' && name.trim() ? name.trim() : id;
    if (query && !label.toLowerCase().includes(query) && !id.toLowerCase().includes(query)) continue;
    results.push({
      value: id,
      name: label === id ? label : `${label} · ${id}`,
      description: isPortuguese
        ? connected === true ? 'Conectada' : 'Desconectada'
        : connected === true ? 'Connected' : 'Disconnected',
    });
  }
  results.sort((a, b) => a.name.localeCompare(b.name, isPortuguese ? portuguese : 'en'));
  return {results};
}

export class WaxumV4 extends WaxumV3 {
  methods = {listSearch: {searchSessions}};

  constructor() {
    super();
    this.description = {
      ...this.description,
      version: 4,
      properties: this.description.properties.map(property => property.name === 'sessionId'
        ? {...property, type: 'resourceLocator', default: {__rl: true, mode: 'list', value: ''},
            description: 'Select an authorized session or enter its ID', modes: [
              {displayName: 'From List', name: 'list', type: 'list',
                typeOptions: {searchListMethod: 'searchSessions', searchable: true}},
              {displayName: 'By ID', name: 'id', type: 'string', placeholder: 'my-session'},
            ]}
        : property),
    };
  }
}
