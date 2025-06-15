# Sortana

Sortana is an experimental Thunderbird add-on that integrates an AI-powered filter rule. 
It allows you to classify email messages by sending their contents to a configurable
HTTP endpoint. The endpoint should respond with JSON indicating whether the
message meets a specified criterion.

## Features

- **AI classification rule** – adds the "AI classification" term with
  `matches` and `doesn't match` operators.
- **Configurable endpoint** – set the classification service URL on the options page.
- **Filter editor integration** – patches Thunderbird's filter editor to accept
  text criteria for AI classification.
- **Result caching** – avoids duplicate requests for already-evaluated messages.
- **Packaging script** – `build-xpi.ps1` builds an XPI ready for installation.

## Architecture Overview

The extension relies on both WebExtension scripts and Thunderbird's experiment
APIs:

- `background.js` loads the saved endpoint, registers the UI patching script,
  and listens for test messages.
- `experiment/api.js` exposes the `aiFilter` namespace. It loads
  `modules/ExpressionSearchFilter.jsm` which implements the custom filter term
  and performs the HTTP request.
- `experiment/DomContentScript/` registers content scripts for Thunderbird
  windows; `content/filterEditor.js` modifies the filter editor UI.
- `options/` contains the HTML and JavaScript for the options page.
- `_locales/` holds localized strings used throughout the UI.

### Key Files

| Path                                    | Purpose                                        |
| --------------------------------------- | ---------------------------------------------- |
| `manifest.json`                         | Extension manifest and entry points.           |
| `background.js`                         | Startup tasks and message handling.            |
| `modules/ExpressionSearchFilter.jsm`    | Custom filter term and AI request logic.       |
| `experiment/api.js`                     | Bridges WebExtension code with privileged APIs.|
| `content/filterEditor.js`               | Patches the filter editor interface.           |
| `options/options.html` and `options.js` | Endpoint configuration UI.                     |

## Building

1. Ensure PowerShell is available (for Windows) or adapt the script for other
   environments.
2. Run `powershell ./build-xpi.ps1` from the repository root. The script reads
the version from `manifest.json` and creates an XPI in the `release` folder.
3. Install the generated XPI in Thunderbird via the Add-ons Manager. During
   development you can also load the directory as a temporary add-on.

## Usage

1. Open the add-on's options and set the URL of your classification service.
2. Create or edit a filter in Thunderbird and choose the **AI classification**
   term. Enter the desired criterion (for example, a short description of the
   messages you want to match).
3. When the filter runs, the add-on sends the message text to the service and
   checks the JSON response for a match.

## License

This project is licensed under the terms of the GNU General Public License
version 3. See `LICENSE` for the full text.

## Acknowledgments

Sortana builds upon knowledge gained from open-source projects. In particular,
[FiltaQuilla](https://github.com/RealRaven2000/FiltaQuilla) and
[Expression-Search-NG](https://github.com/opto/expression-search-NG) clarified
how Thunderbird's WebExtension and experiment APIs can be extended. Their code
provided invaluable guidance during development.

