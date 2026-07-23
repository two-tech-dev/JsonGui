# JsonGui desktop release

1. Generate updater signing key once:

   ```bash
   npx tauri signer generate -w ~/.tauri/jsongui.key
   ```

2. Put generated public key in `src-tauri/tauri.conf.json` under `plugins.updater.pubkey`.
3. Add private key and password to protected GitHub Environment `release-production`:
   - `TAURI_SIGNING_PRIVATE_KEY`
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (if set)
4. Push matching tag:

   ```bash
   git tag v0.1.1
   git push origin v0.1.1
   ```

Release workflow creates signed NSIS artifacts and `latest.json` for:

```text
https://github.com/two-tech-dev/JsonGui/releases/latest/download/latest.json
```

MSI remains manual-download only. Do not rotate signing key without an updater migration plan; installed clients trust public key embedded in their current binary.
