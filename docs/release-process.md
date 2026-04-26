# Release Process

This project publishes trusted extension packages through GitHub Actions.

## Standard Release

1. Make sure the working tree is clean.
2. Update `manifest.json` version if needed.
3. Commit all changes to `main`.
4. Create and push a matching version tag, for example:

```bash
git tag -a v1.9.0 -m "Release v1.9.0"
git push origin v1.9.0
```

5. GitHub Actions builds the zip package from source.
6. GitHub Actions generates an artifact attestation for the zip.
7. GitHub Actions creates a GitHub Release and uploads the zip.

The tag version must match the version in `manifest.json`.

## Verification

After downloading a release zip, verify the artifact with GitHub CLI:

```bash
gh attestation verify ai-image-collector-v1.9.0.zip \
  --repo cg202601/ai-image-collector
```

The package should verify against this repository.

## Notes

- Do not publish locally created zip files as official releases.
- Do not hardcode private Google Sheets IDs, Drive folder IDs, GAS URLs, API keys, or tokens.
- Keep the optional gallery website outside this public extension package.
