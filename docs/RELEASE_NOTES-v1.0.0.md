# Minecraft Server Setup Maker v1.0.0

Self-hosted web app for assembling Minecraft **plugin setups** and exporting them as a
ZIP that contains **only** the `plugins/` directory.

## What's included

- **Project wizard** — name, server name, language (EN/TH), searchable Minecraft version
  list from Mojang's manifest (releases / prereleases / snapshots, custom versions allowed
  with warnings), server software (Paper, Folia, Leaf) with supported versions and builds
  from PaperMC Fill v3 and Leaf's GitHub releases, review step.
- **Plugin library** — Modrinth search, version listing and downloads with SHA-512
  verification, plus local JAR/ZIP uploads with `plugin.yml` inspection (never executed),
  custom categories, multiple versions per plugin and safe metadata editing.
- **Compatibility engine** — Verified / Potential / Incompatible / Unknown, evaluated
  separately for loader and game version; Folia and Leaf support is never assumed from
  Paper support.
- **Setup templates** — 10 built-in templates, preview → availability → warnings →
  confirmation → apply, create/edit/duplicate/delete, and "create from project".
- **Configuration editors** — YAML / JSON / TOML / text with syntax highlighting,
  validation, import, download, reset-to-template and an export-contents preview.
- **Visual TAB editor** — header/footer, tablist names, objectives, teams, bossbar,
  placeholders, undo/redo, import of existing configs, and a live Minecraft-style preview.
- **LuckPerms workflow** — install, version selection, config access, in-game command and
  permission-node guidance (no web permission editor by design).
- **AI assistant** (optional) — OpenAI-compatible provider, candidate-grounded install
  plans validated against a strict schema, explicit user approval, no invented IDs or URLs.
  The app works fully without an AI key.
- **ZIP export** — backend-generated archive with collision detection, missing-file
  blocking, post-generation validation, and an accurate preview (file count, size).

## Requirements

- Node.js **22.5+** (uses the built-in `node:sqlite`)
- Network access to Modrinth and Mojang/PaperMC for live metadata and downloads

## Install and run

```bash
npm ci
cp .env.example .env
npm run db:migrate
npm run dev        # API :8787 + UI :3000
```

## Production

```bash
npm ci
npm run build
npm start          # serves UI + API on PORT (default 8787)
```

## From this release bundle

```bash
unzip MinecraftServerSetupMaker-v1.0.0.zip -d server-setup-maker
cd server-setup-maker
npm ci --omit=dev
npm start          # open http://localhost:8787
```

## AI configuration (optional)

```dotenv
AI_PROVIDER=openai-compatible
AI_API_KEY=your-key
AI_MODEL=your-model
AI_BASE_URL=https://your-provider.example/v1
```

## Security notes

No built-in authentication — run it on localhost or behind an authenticated reverse proxy.
Uploads and archives are treated as untrusted: path containment, SSRF-guarded downloads,
trusted-host validation for Modrinth URLs, size limits, YAML without custom tags, and no
execution of JARs or archive scripts.

## Verification

- `npm run typecheck` — passed
- `npm test` — 7 files, **43/43 tests passed**
- `npm run build` — passed
- End-to-end run against live APIs: create project → download EssentialsX, LuckPerms and
  PlaceholderAPI from Modrinth → apply a template → export → archive opened and verified
  (only `plugins/`, integrity OK, no server JARs/worlds/logs/DB/env files)
- Release bundle smoke test: fresh `npm ci --omit=dev` → `npm start` → health, HTML, JS
  assets and template seeding all verified
