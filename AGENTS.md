# AGENTS Guidelines for Sortana

This file provides guidelines for codex agents contributing to the Sortana project. It describes the repository structure, the expected coding conventions, and testing commands. If you make changes to Sortana, make sure to update this document and the README.md if applicable.

## Repository Overview

- `background.js`: Handles startup tasks and coordinates message passing within the extension.
- `modules/`: Holds reusable JavaScript modules for the extension.
- `content/`: Scripts for modifying Thunderbird windows (e.g., the filter editor).
- `options/`: The options page HTML and JavaScript.
- `resources/`: Images and other static files.
- `prompt_templates/`: Prompt template files for the AI service.
- `build-xpi.ps1`: PowerShell script to package the extension.

## Coding Style

- Use **modern JavaScript** (ES6 or later). Prefer `const` and `let` over `var`.
- Keep functions small and focused. Aim for clear naming and concise comments when necessary.
- Use template literals for string interpolation.
- Avoid trailing whitespace and ensure files end with a newline.

## Commit Guidelines

- Group related changes together. Each commit should have a clear purpose.
- Use descriptive commit messages in the imperative mood (e.g., "Add filter editor patch").
- Run `git status` before committing to verify only intended files are staged.

## Testing

There are currently no automated tests for this project. If you add tests in the future, specify the commands to run them here. For now, verification must happen manually in Thunderbird.

## Documentation

Additional documentation exists outside this repository.

- Development guide: [Webextention-API for Thunderbird](https://webextension-api.thunderbird.net/en/stable/)
  - [Messages API](https://webextension-api.thunderbird.net/en/stable/messages.html)
  - [Message Tags API](https://webextension-api.thunderbird.net/en/stable/messages.tags.html)
  - [Storage API](https://webextension-api.thunderbird.net/en/stable/storage.html)
- Issue tracker: [Thunderbird tracker on Bugzilla](https://bugzilla.mozilla.org/describecomponents.cgi?product=Thunderbird)

