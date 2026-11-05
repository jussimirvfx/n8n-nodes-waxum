# Waxum for n8n

A community node for automating WhatsApp from n8n through your own [Waxum](https://github.com/imtaqin/waxum) server. Send interactive messages, route customer replies, or manage WhatsApp sessions with 246 API operations organized by category.

| Area | What you can do |
| --- | --- |
| Messaging | Send text, images, video, voice notes, documents, contacts, and locations. React to messages or mark them as read. |
| Interactive messages | Send reply buttons and list menus. Use polls or link buttons where the selected channel supports them. |
| WhatsApp Web | Link a device by QR code or pairing code. Work with groups, contacts, chat presence, and message history. |
| WhatsApp Cloud API | Use Meta's official channel for supported messaging, templates, Flows, media, and business account operations. |
| Automation and operations | Manage sessions and webhooks, schedule sends, and monitor bulk jobs and delivery status where supported. |

Availability depends on your channel, Waxum server version, and token permissions.

Use **Language / Idioma** at the top of the node parameters to switch between **English** and **Português (Brasil)**. English is the default. The selector applies to the node's parameters, operation labels, and session list. The action picker used to add a node and the separate credential editor use English.

In the node panel, select a **Category** such as **Web · Groups** to narrow the **Operation** menu to that category. When you add a specific action from the n8n sidebar, the node opens with its category and operation already selected.

## Installation

Open **Settings → Community Nodes → Install** in a self-hosted n8n instance that allows community nodes. Enter `n8n-nodes-waxum`. See [n8n's installation options](https://docs.n8n.io/integrations/community-nodes/installation-and-management/).

## Credentials

Create a **Waxum API** credential. Enter the HTTPS URL of your Waxum server, such as `https://waxum.example.com`, and its API token. The credential test requests the list of sessions that the token is allowed to access.

Use a token scoped to the sessions and operations that the workflow needs. Select a session from the list or enter its ID. Reuse a credential across sessions when the token authorizes all of them.

## Send WhatsApp reply buttons

Use the **Buttons** operation in the **Send** category for your channel. Select a connected Waxum session, fill in **To** and **Body text**, and paste one to three options into **Buttons (JSON)**.

```json
[
  { "button_id": "sales", "display_text": "Talk to sales" },
  { "button_id": "support", "display_text": "Get support" }
]
```

On a **WhatsApp Cloud API** session, Waxum sends the official Meta interactive reply buttons. On a **WhatsApp Web** session, the same node operation sends native quick replies through the linked device. Display on WhatsApp Web can vary by the recipient's client. Follow Meta's messaging rules when using the Cloud API.

To branch a workflow after a tap, register a Waxum webhook pointing to an n8n **Webhook** trigger. On supported Waxum versions, the reply payload includes the selected ID, such as `support`, which you can route with a **Switch** node. See **Button and list replies** in the [Waxum webhook reference](https://waxum.imtaqin.id/docs/api/webhooks/).

## Example workflows

- **Check a session.** Import [session-status.json](examples/session-status.json), select your Waxum credential, and replace `my-session` with your session ID. For WhatsApp Cloud API, choose its **Session status** operation in the node picker. This workflow reads the session status.
- **Send a text message.** Select **Send Text** under **WhatsApp Web → Validated Actions**. Set the session, recipient with country code, and message. Enable **Validate Only** to check the session and recipient before sending.
- **Process a received voice message.** If the workflow starts with a webhook, filter for incoming messages with audio before passing the media metadata to **Download Received Media**. A recording indicator is a presence event and carries no audio. The node returns the audio in the `data` binary field by default. Connect a separate transcription node that reads that field if your workflow needs a transcript.

Acceptance by the API is separate from delivery and read receipts. Check the conversation history before retrying an operation with an uncertain result.

## API documentation

- [Waxum API reference](https://waxum.imtaqin.id/docs/category/api-reference/) for endpoints and payloads.
- [Messages and interactive buttons](https://waxum.imtaqin.id/docs/api/messages/) for message types and quick replies.
- [WhatsApp Cloud API through Waxum](https://waxum.imtaqin.id/docs/api/cloud/) for Meta sessions, templates, Flows, and business operations.
- [Waxum webhooks](https://waxum.imtaqin.id/docs/api/webhooks/) for events, signatures, and replies.

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
