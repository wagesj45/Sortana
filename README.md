![logo](/resources/img/full-logo-white.png)

# Sortana

Sortana is an experimental Thunderbird add-on that integrates an AI-powered filter rule. 
It allows you to classify email messages by sending their contents to a configurable
HTTP endpoint. The endpoint should respond with JSON indicating whether the
message meets a specified criterion.

## Features

- **AI classification rule** – adds the "AI classification" term with
  `matches` and `doesn't match` operators.
- **Configurable endpoint** – set the classification service URL on the options page.
- **Prompt templates** – choose between several model formats or provide your own custom template.
- **Custom system prompts** – tailor the instructions sent to the model for more precise results.
- **Filter editor integration** – patches Thunderbird's filter editor to accept
  text criteria for AI classification.
- **Persistent result caching** – classification results are saved to disk so messages aren't re-evaluated across restarts.
- **Advanced parameters** – tune generation settings like temperature, top‑p and more from the options page.
- **Debug logging** – optional colorized logs help troubleshoot interactions with the AI service.
- **Automatic rules** – create rules that tag or move new messages based on AI classification.
- **Context menu** – apply AI rules to selected messages from the message list or display.
- **Packaging script** – `build-xpi.ps1` builds an XPI ready for installation.

## Architecture Overview

Sortana is implemented entirely with WebExtension scripts:

- `background.js` loads saved settings and listens for new messages.
- `modules/ExpressionSearchFilter.jsm` implements the AI filter and performs the
  HTTP request.
- `options/` contains the HTML and JavaScript for configuring the endpoint and
  rules.
- `_locales/` holds localized strings used throughout the UI.

### Key Files

| Path                                    | Purpose                                        |
| --------------------------------------- | ---------------------------------------------- |
| `manifest.json`                         | Extension manifest and entry points.           |
| `background.js`                         | Startup tasks and message handling.            |
| `modules/ExpressionSearchFilter.jsm`    | Custom filter term and AI request logic.       |
| `experiment/api.js`                     | Bridges WebExtension code with privileged APIs.|
| `content/filterEditor.js`               | Patches the filter editor interface.           |
| `options/options.html` and `options.js` | Endpoint and rule configuration UI. |
| `logger.js` and `modules/logger.jsm`    | Colorized logging with optional debug mode.    |

## Building

1. Ensure PowerShell is available (for Windows) or adapt the script for other
   environments.
2. Run `powershell ./build-xpi.ps1` from the repository root. The script reads
the version from `manifest.json` and creates an XPI in the `release` folder.
3. Install the generated XPI in Thunderbird via the Add-ons Manager. During
   development you can also load the directory as a temporary add-on.

## Usage

1. Open the add-on's options and set the URL of your classification service.
2. Use the **Classification Rules** section to add a criterion and optional
   actions such as tagging or moving a message when it matches.
3. Save your settings. New mail will be evaluated automatically using the
   configured rules.

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
triggering tags, moves, or actions based on the model's classification.

## Required Permissions

Sortana requests the following Thunderbird permissions:

- `storage` – store configuration and cached classification results.
- `messagesRead` – read message contents for classification.
- `messagesMove` – move messages when a rule specifies a target folder.
- `messagesUpdate` – change message properties such as tags and junk status.
- `messagesTagsList` – retrieve existing message tags for rule actions.
- `accountsRead` – list accounts and folders for move actions.
- `menus` – add context menu commands.

## License

This project is licensed under the terms of the GNU General Public License
version 3. See `LICENSE` for the full text.

## Acknowledgments

Sortana builds upon knowledge gained from open-source projects. In particular,
[FiltaQuilla](https://github.com/RealRaven2000/FiltaQuilla) and
[Expression-Search-NG](https://github.com/opto/expression-search-NG) clarified
how Thunderbird's WebExtension and experiment APIs can be extended. Their code
provided invaluable guidance during development.

