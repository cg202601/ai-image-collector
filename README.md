# AI Image Collector

A Chrome extension for collecting AI-generated images, prompts, source links, notes, software names, and categories into Google Sheets and Google Drive.

This repository contains the browser extension and the companion Google Apps Script backend. The optional gallery website is not included in this public package.

## Features

- Collect images from webpages, clipboard paste, drag and drop, or right-click menu.
- Save image files to Google Drive.
- Write metadata to Google Sheets.
- Store prompt, note, software, source URL, user name, and gallery category.
- Read prompt history and templates from the connected spreadsheet.
- Support prompt library search, favorites, high-frequency prompts, and preview filtering.
- Support software list, category tags, cloud config upload/download, and failed-submit retry queue.
- Optional website gallery URL entry for opening your own gallery page from the extension.

## Files

| File | Purpose |
| --- | --- |
| `manifest.json` | Chrome extension manifest |
| `background.js` | Service worker, context menu, extension background logic |
| `content.js` | Main collection panel injected into webpages |
| `popup.html` / `popup.css` / `popup.js` | Extension settings popup |
| `gas_script.js` | Google Apps Script backend code |
| `icons/` | Extension icons |

## User Manual

Chinese user manual: `docs/user-manual.zh-CN.md`

## Install The Extension

1. Download the latest release zip from GitHub Releases.
2. Verify the release artifact if your organization requires provenance checks.
3. Unzip the package.
4. Open Chrome and go to `chrome://extensions/`.
5. Turn on `Developer mode`.
6. Click `Load unpacked`.
7. Select the extracted extension folder.
8. Pin the extension if you want quick access from the toolbar.

For development, you can also clone this repository and load the repository folder directly:

1. Clone this repository.
2. Open Chrome and go to `chrome://extensions/`.
3. Turn on `Developer mode`.
4. Click `Load unpacked`.
5. Select this repository folder.

## Trusted Releases

Official release packages are built by GitHub Actions when a version tag such as `v1.9.0` is pushed.

The release workflow:

- validates the extension files;
- checks for common hardcoded private IDs and secrets;
- builds the installable zip package;
- generates an Artifact Attestation with `actions/attest-build-provenance`;
- uploads the zip to GitHub Releases.

To verify a downloaded release package with GitHub CLI:

```bash
gh attestation verify ai-image-collector-v1.9.0.zip \
  --repo cg202601/ai-image-collector
```

See `docs/release-process.md` for the full release checklist.

## Create Google Sheets

1. Open [Google Sheets](https://sheets.google.com).
2. Create a blank spreadsheet.
3. Copy the spreadsheet ID from the URL.

The spreadsheet ID is the part between `/d/` and `/edit`:

```text
https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit
```

The script can create required sheets automatically when used, but you can also run helper functions in Apps Script if needed.

## Deploy Google Apps Script

1. Open the spreadsheet.
2. Click `Extensions` > `Apps Script`.
3. Delete the default code.
4. Paste all code from `gas_script.js`.
5. Save the script.
6. Click `Deploy` > `New deployment`.
7. Select type: `Web app`.
8. Set `Execute as` to `Me`.
9. Set `Who has access` to `Anyone`.
10. Deploy and copy the Web App URL.

Important: `SPREADSHEET_ID` in `gas_script.js` is intentionally blank. The extension sends the target spreadsheet ID from its settings. Do not hardcode private IDs before publishing.

## Configure The Extension

Open the extension settings and fill in:

- `GAS Web App URL`: the Apps Script Web App URL.
- `Google Sheets ID`: your spreadsheet ID.
- `Google Drive Folder ID`: optional folder ID for uploaded images.
- `Default User Name`: optional name written to the spreadsheet.
- `Website Gallery URL`: optional URL for your own gallery website.

Then save the settings.

## Usage

- Right-click an image on a webpage and choose the collection action.
- Press the panel shortcut or use the floating entry button to open the panel.
- Paste or drag an image into the panel.
- Fill in prompt, note, software, and category.
- Submit to save the image and metadata.

## Google Drive Folder ID

If you want images saved into a specific Drive folder:

1. Create or open a Google Drive folder.
2. Copy the folder ID from the URL.

```text
https://drive.google.com/drive/folders/FOLDER_ID
```

3. Paste that ID into the extension settings.

## Privacy And Safety

Before publishing your own fork, check that you have not committed:

- Real Google Sheets IDs.
- Real Google Drive folder IDs.
- Real GAS deployment URLs.
- API keys, tokens, passwords, or private account data.
- Business-sensitive prompts or internal project data.

This repository is designed so user-specific IDs are configured locally in the extension, not hardcoded in source code.

## Troubleshooting

| Problem | What to check |
| --- | --- |
| Submit fails | Confirm the GAS Web App URL and spreadsheet ID are correct |
| Permission error | Redeploy GAS with `Execute as: Me` and `Who has access: Anyone` |
| Image does not upload | Check Drive folder permission and folder ID |
| Prompt library does not load | Confirm the GAS URL can access the spreadsheet |
| Settings do not persist | Reload the extension from `chrome://extensions/` |

## Updating GAS

After changing `gas_script.js`, update your Apps Script project and create a new deployment version:

1. Paste the updated code into Apps Script.
2. Click `Deploy` > `Manage deployments`.
3. Edit the existing deployment.
4. Choose `New version`.
5. Deploy.

The Web App URL usually stays the same.

## License

No license is currently provided. Add a license before distributing modified versions broadly.
