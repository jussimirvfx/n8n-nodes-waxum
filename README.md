# Waxum for n8n

A community node for using your Waxum server from n8n. It groups 246 API operations into separate resources for WhatsApp Web and WhatsApp Cloud API.

Use **Language / Idioma** at the top of the node parameters to switch between **English** and **Português (Brasil)**. English is the default. The selector applies to the node's parameters, operation labels, and session list. The action picker used to add a node and the separate credential editor use English.

In the node panel, select a **Category** such as **Web · Groups** to narrow the **Operation** menu to that category. When you add a specific action from the n8n sidebar, the node opens with its category and operation already selected.

## Installation

After the package is published, open **Settings → Community Nodes → Install** in a self-hosted n8n instance that allows community nodes. Enter `n8n-nodes-waxum`. See [n8n's installation options](https://docs.n8n.io/integrations/community-nodes/installation-and-management/).

## Credentials

Create a **Waxum API** credential. Enter the HTTPS URL of your Waxum server, such as `https://waxum.example.com`, and its API token. The credential test requests the list of sessions that the token is allowed to access.

Use a token scoped to the sessions and operations that the workflow needs. Select a session from the list or enter its ID. Reuse a credential across sessions when the token authorizes all of them.

## Example workflows

- **Check a session.** Import [session-status.json](examples/session-status.json), select your Waxum credential, and replace `my-session` with your session ID. For WhatsApp Cloud API, choose its **Session status** operation in the node picker. This workflow reads the session status.
- **Send a text message.** Select **Send Text** under **WhatsApp Web → Validated Actions**. Set the session, recipient with country code, and message. Enable **Validate Only** to check the session and recipient before sending.
- **Process a received voice message.** Pass the received media metadata to **Download Received Media**. The node returns the audio in the `data` binary field by default. Connect a separate transcription node that reads that field if your workflow needs a transcript.

Other resources cover media, interactive messages, contacts, groups, webhooks, scheduling, bulk operations, and administration. Availability depends on the channel, the Waxum server version, and token permissions. Acceptance by the API is separate from delivery and read receipts. Check the conversation history before retrying an operation with an uncertain result.

## Development

```sh
npm ci --ignore-scripts
npm test
npm pack
```

The generated catalog uses the English console playground from [Waxum 0.16.1](https://github.com/imtaqin/waxum/tree/851bedf3189bda742433ef57bc06e75be590860b). To regenerate it from a compatible checkout, run `node scripts/sync-catalog.cjs /path/to/src/console/assets/playground.js` and rerun the tests.

## Contributors

- [@Brunozhz](https://github.com/Brunozhz) developed the Waxum integration for n8n.

Report bugs or suggest improvements in [GitHub Issues](https://github.com/jussimirvfx/n8n-nodes-waxum/issues), or open a [pull request](https://github.com/jussimirvfx/n8n-nodes-waxum/pulls) to propose a change.

## Publishing for self-hosted n8n

1. Push the reviewed source to the public repository named in `package.json`.
2. Configure npm publishing from GitHub Actions. For a package already registered with npm, set up a [trusted publisher](https://docs.npmjs.com/trusted-publishers/) for `publish.yml` with staging permission. For the first release, use the workflow's **First release** input with a short-lived, stage-only npm token stored as the `NPM_BOOTSTRAP_TOKEN` Actions secret. Revoke the bootstrap token and remove the secret after the first release.
3. Run **Stage npm release** manually in GitHub Actions. It builds and tests the package and stages it with provenance. Review the staged version in npm and approve it with two-factor authentication.
4. Install the published version in a self-hosted n8n instance and check the example workflow in both languages.

The bilingual edition is for self-hosted n8n. The [verification guidelines](https://docs.n8n.io/connect/create-nodes/build-your-node/reference/verification-guidelines.md#use-english-language-only) require English-only interfaces and documentation for the verified catalog.

This independent community node is available under the [MIT license](LICENSE). The Waxum catalog retains its upstream [license notice](LICENSE-WAXUM).
