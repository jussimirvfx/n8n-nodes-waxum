import { VersionedNodeType } from 'n8n-workflow';
import type { INodeTypeBaseDescription } from 'n8n-workflow';
import { WaxumLegacy } from './WaxumV1.node';
import { WaxumV3 } from './WaxumV3.node';
import { WaxumV4 } from './WaxumV4';
import { WaxumV5 } from './WaxumV5';
import { addLanguageSelector } from './localization';

/** Keep saved nodes on their original fields and response contract. */
export class Waxum extends VersionedNodeType {
  constructor() {
    const description: INodeTypeBaseDescription = {
      displayName: 'Waxum', name: 'waxum', icon: 'file:waxum.svg', group: ['output'],
      description: 'Work with WhatsApp messages, media, contacts, and sessions in Waxum',
      defaultVersion: 6, usableAsTool: true,
    };
    super({
      1: addLanguageSelector(new WaxumLegacy()),
      2: addLanguageSelector(new WaxumLegacy()),
      3: addLanguageSelector(new WaxumV3()),
      4: addLanguageSelector(new WaxumV4()),
      5: addLanguageSelector(new WaxumV5()),
      6: addLanguageSelector(new WaxumV5(6)),
    }, description);
  }
}
