![logo](/resources/img/full-logo-white.png)

# Sortana

Sortana is an experimental Thunderbird add-on that integrates an AI-powered filter rule. 
It allows you to classify email messages by sending their contents to a configurable
HTTP endpoint. The endpoint should respond with JSON indicating whether the
message meets a specified criterion.

## Features

- **Configurable endpoint** – set the classification service URL on the options page.
- **Prompt templates** – choose between several model formats or provide your own custom template.
- **Custom system prompts** – tailor the instructions sent to the model for more precise results.
- **Persistent result caching** – classification results and reasoning are saved to disk so messages aren't re-evaluated across restarts.
- **Advanced parameters** – tune generation settings like temperature, top‑p and more from the options page.
- **Markdown conversion** – optionally convert HTML bodies to Markdown before sending them to the AI service.
- **Debug logging** – optional colorized logs help troubleshoot interactions with the AI service.
- **Debug tab** – view the last request payload and a diff between the unaltered message text and the final prompt.
- **Light/Dark themes** – automatically match Thunderbird's appearance with optional manual override.
- **Automatic rules** – create rules that tag, move, copy, forward, reply, delete, archive, mark read/unread or flag/unflag messages based on AI classification. Rules can optionally apply only to unread messages and can ignore messages outside a chosen age range.
- **Rule ordering** – drag rules to prioritize them and optionally stop processing after a match.
- **Rule enable/disable** – temporarily turn a rule off without removing it.
- **Account & folder filters** – limit rules to specific accounts or folders.
- **Context menu** – apply AI rules from the message list or the message display action button.
- **Status icons** – toolbar icons show when classification is in progress and briefly display success states. If a failure occurs the icon turns red until you dismiss the notification.
- **Error notification** – failed classification displays a notification with a button to clear the error and reset the icon.
- **View reasoning** – inspect why rules matched via the Details popup.
- **Cache management** – clear cached results from the context menu or options page.
- **Queue & timing stats** – monitor processing time on the Maintenance tab.
- **Packaging script** – `build-xpi.ps1` builds an XPI ready for installation.
- **Maintenance tab** – view rule counts, cache entries and clear cached results from the options page.

### Cache Storage

Classification results are stored under the `aiCache` key in extension storage.
Each entry maps a SHA‑256 hash of `"<message Message-ID>|<criterion>"` to an object
containing `matched` and `reason` fields. Older installations with a separate
`aiReasonCache` will be migrated automatically on startup.

## Architecture Overview

Sortana is implemented entirely with standard WebExtension scripts—no custom experiment code is required:

- `background.js` loads saved settings, manages the classification queue and listens for new messages.
- `modules/AiClassifier.js` implements the classification logic and cache handling.
- `options/` contains the HTML and JavaScript for configuring the endpoint and rules.
- `details.html` / `details.js` present cached reasoning for a message.
- `_locales/` holds localized strings used throughout the UI.

### Key Files

| Path                                    | Purpose                                        |
| --------------------------------------- | ---------------------------------------------- |
| `manifest.json`                         | Extension manifest and entry points. |
| `background.js`                         | Startup tasks and classification queue management. |
| `modules/AiClassifier.js`               | Core classification logic and cache handling. |
| `options/options.html` and `options.js` | Endpoint and rule configuration UI. |
| `details.html` and `details.js`         | View stored reasoning for a message. |
| `logger.js`                             | Colorized logging with optional debug mode. |

## Building

1. Ensure PowerShell is available (for Windows) or adapt the script for other
   environments.
2. The Bulma stylesheet (v1.0.3) is already included as `options/bulma.css`.
3. Run `powershell ./build-xpi.ps1` from the repository root. The script reads
   the version from `manifest.json` and creates an XPI in the `release` folder.
4. Install the generated XPI in Thunderbird via the Add-ons Manager. During
   development you can also load the directory as a temporary add-on.
5. To regenerate PNG icons from the SVG sources, run `resources/svg2img.ps1`.

## Usage

1. Open the add-on's options and set the URL of your classification service.
 2. Use the **Classification Rules** section to add a criterion and optional
   actions such as tagging, moving, copying, forwarding, replying,
   deleting or archiving a message when it matches. Drag rules to
   reorder them, check *Only apply to unread messages* to skip read mail,
   set optional minimum or maximum message age limits, select the accounts or
 folders a rule should apply to. Use the
 slashed-circle/check button to disable or re-enable a rule. The small
 circle buttons for optional conditions show a filled dot when active, and
 check *Stop after match* to halt further processing. Forward and reply actions
   open a compose window using the account that received the message.
3. Save your settings. New mail will be evaluated automatically using the
   configured rules.
4. If the toolbar icon shows a red X, click the notification's **Dismiss** button to clear the error.

### Example Filters

Here are some useful and fun example criteria you can use in your filters. Filters should be able to be answered as either `true` or `false`.

- **"Does this message require my attention, response, or decision soon?"**  
  Identify emails with deadlines, requests, or actionable items.

- **"Is this message spam, phishing, or irrelevant bulk mail?"**  
  Catch low-value or deceptive messages and sweep them into the junk folder.

- **"Is this email promotional, advertising a product or service, or part of a mass mailing?"**  
  Great for filtering out newsletters, deals, and marketing campaigns.

- **"Is this a personal message from a friend or family member?"**  
  Keep emotionally meaningful or social emails from getting lost.

- **"Is this message a receipt, invoice, or shipping notification?"**  
  Automatically tag or file transactional messages for easy lookup.

- **"Does this message relate to one of my current work projects?"**  
  Focus your inbox around what matters right now.

- **"Would I roll my eyes reading this email?"**  
  For when you're ready to filter based on vibes.

You can define as many filters as you'd like, each using a different prompt and
triggering tags, moves, copies, deletes, archives, read/unread changes or flag updates based on the model's classification.

## Required Permissions

Sortana requests the following Thunderbird permissions:

- `storage` – store configuration and cached classification results.
- `messagesRead` – read message contents for classification.
- `messagesMove` – move or copy messages when a rule specifies a target folder.
 - `messagesUpdate` – change message properties such as tags, junk status, read/unread state and flags.
- `messagesTagsList` – retrieve existing message tags for rule actions.
- `accountsRead` – list accounts and folders for move or copy actions.
- `menus` – add context menu commands.
- `tabs` – open new tabs and query the active tab.
- `notifications` – display error notifications.
- `compose` – create reply and forward compose windows for matching rules.

## Thunderbird Add-on Store Disclosures

The [Third Party Library Usage](https://extensionworkshop.com/documentation/publish/third-party-library-usage/) policy
requires disclosure of third party libraries that are included in the add-on. Even though
the disclosure is only required for add-on review, they'll be listed here as well. Sortana
uses the following third party libraries:

- [Bulma.css v1.0.3](https://github.com/jgthms/bulma/blob/1.0.3/css/bulma.css)
  - MIT License
- [turndown v7.2.0](https://github.com/mixmark-io/turndown/tree/v7.2.0)
  - MIT License
- [diff](https://github.com/google/diff-match-patch/blob/62f2e689f498f9c92dbc588c58750addec9b1654/javascript/diff_match_patch_uncompressed.js)
  -  Apache-2.0 license

## License

This project is licensed under the terms of the GNU General Public License
version 3. See `LICENSE` for the full text. Third party libraries are licensed seperately.

## Acknowledgments

Sortana builds upon knowledge gained from open-source projects. In particular,
[FiltaQuilla](https://github.com/RealRaven2000/FiltaQuilla) and
[Expression-Search-NG](https://github.com/opto/expression-search-NG) clarified
how Thunderbird's WebExtension and experiment APIs can be extended. Their code
provided invaluable guidance during development.

- Icons from [cc0-icons.jonh.eu](https://cc0-icons.jonh.eu/) are used under the CC0 license.

