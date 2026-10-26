# Minecraft Server Setup Maker

A self-hosted web application for building Minecraft server **plugin** setups and exporting them as a ZIP that contains **only the `plugins/` directory**.

It manages projects, plugin files (Modrinth + your own uploads), plugin configuration files, reusable setup templates, a visual TAB editor and an optional AI planning assistant. It never runs plugin JARs and never connects to a live Minecraft server.

---

## 1. Architecture

| Layer | Choice |
| --- | --- |
| Frontend | React 18 + TypeScript + Vite, Tailwind CSS (dark UI), React Router |
| Backend | Node.js + Express 4 + TypeScript, Zod request validation |
| Database | SQLite via Node's built-in `node:sqlite` (no native build step) |
| File storage | Local `DATA_DIR` (plugin JARs, extracted config templates, temp files) |
| ZIP | `archiver` (streaming archive creation), `yauzl` (safe inspection/extraction) |
| YAML | `js-yaml` with the JSON schema (no custom tags), `smol-toml` for TOML |
| Tests | Vitest + Supertest, with real ZIP archives and mocked external services |

```
client/                     React application (pages + components)
  components/               CodeEditor, ConfigPanel, TabEditor, PluginManager, ...
  pages/                    Dashboard, Wizard, Workspace, Library, Templates, AI, Settings
server/
  index.ts                  HTTP bootstrap (listens, seeds templates)
  app.ts                    Express app factory (routes, security headers, static hosting)
  config.ts                 Environment configuration + storage paths
  db.ts                     SQLite schema and query helpers
  safety.ts                 Path containment, safe ZIP listing/extraction
  net.ts                    SSRF-guarded fetch (host allowlist, DNS/IP checks, redirect policy)
  download.ts               Streaming download with size cap + SHA-512 verification
  modrinth.ts               Modrinth API client (search, project, versions)
  mcmeta.ts                 Mojang version manifest, PaperMC Fill v3, Leaf GitHub releases
  compat.ts                 Compatibility evaluation (version + loader + Folia/Leaf rules)
  library.ts                Local plugin library (uploads, metadata, categories, templates)
  installer.ts              Modrinth install workflow + cache reuse
  projects.ts               Project/plugin/config persistence, dependency checks
  templates.ts              Setup template preview/apply/duplicate/from-project
  export.ts                 Export preview, collision detection, ZIP creation + validation
  tab.ts                    TAB 5.x model, YAML generation/parsing with preservation
  ai.ts                     Provider abstraction, candidate grounding, plan validation
  luckperms.ts              LuckPerms guidance content (commands, nodes, docs)
  routes/                   REST route modules
shared/types.ts             Types shared by client and server
tests/                      Vitest integration/unit tests
storage/                    Created at runtime (git-ignored)
```

SQLite tables: `projects`, `library_plugins`, `project_plugins`, `project_configs`, `templates`, `categories`, `settings`.

### Storage layout

```
storage/
├── app.db                          SQLite database
├── plugins/
│   ├── modrinth/<project>/<version>/<file>.jar   downloaded + hash-verified
│   ├── uploaded/<libraryId>/<file>.jar           your uploads
│   └── cache/                                    reserved for temporary artifacts
├── templates/<libraryId>/files/...               extracted config templates
├── templates/<libraryId>/original.zip            original archive (never exported)
└── tmp/                                          upload staging + export archives
```

Database rows store **relative** paths; absolute paths are never returned to the browser.

---

## 2. Implemented features

**Projects & wizard**
- 4-step wizard: project info (name, server name, EN/TH language, description, optional icon), Minecraft version, server software, review.
- Version list from the official Mojang manifest (releases, snapshots, prereleases), searchable, plus manual/custom versions with an explicit “unverified” warning.
- Paper / Folia / Leaf selection with supported-version metadata, optional build selection, and per-software compatibility notes.
- Project persistence: rename, duplicate (including plugin and configuration copies), delete with confirmation, reopen, language per project.

**Plugin library**
- Two sources: Modrinth (official API) and local uploads.
- JAR uploads are inspected for `plugin.yml` / `paper-plugin.yml` (name, version, API version, dependencies, Folia flag) — never executed.
- ZIP uploads are safely extracted into configuration templates; a template can be attached to an existing plugin entry so configs are applied when that plugin is added to a project.
- Custom categories plus the built-in category set; metadata editing, notes, checksum, file size, source references.
- Cached Modrinth files are reused instead of re-downloaded; “re-download” is explicit.
- Version replacement: switch an installed project plugin to another local library version or a Modrinth version while keeping its configuration files. Replacing with a different plugin is rejected.
- Duplicate files are rejected with a conflict (no silent overwrite). Library deletion is blocked while projects use the entry, unless forced.

**Compatibility**
- Four states: verified, potentially compatible, incompatible, unknown.
- Never treats Paper support as Folia support, and never treats Paper support as automatic Leaf compatibility.
- Version-specific checks use the plugin's published version list; unlisted versions inside the supported range are “potential”, outside are “incompatible”; missing metadata is “unknown”.
- Dependency panel lists missing required dependencies and can resolve those that name a Modrinth project through the validated download pipeline.

**Setup templates**
- 10 built-in templates (Minimal/Survival/Economy SMP, Towny, RPG, Bedrock, Performance, Lobby, Minigames, Custom) shipped as *references only* — nothing is downloaded until you approve it.
- Browse, preview (per-plugin availability + compatibility), apply, create, edit, duplicate, delete, and “create from project”.
- Applying: local-first resolution, optional Modrinth download of missing plugins, warning summary, no config overwrite unless explicitly enabled.

**Configuration editor**
- YAML / JSON / TOML / text editing with syntax highlighting, line numbers, search, validation, word wrap.
- Create, import, download, delete, save/reload, reset to attached plugin template with confirmation.
- Shows exactly which files will be included in the ZIP.

**TAB visual editor (TAB 5.x layout)**
- Header/footer lines, tablist name formatting, player-list objective, below-name objective, scoreboard teams (sorting, collision, formats), bossbar, placeholders and output replacements, spectator effect.
- Live simulated player-list, bossbar and sidebar previews (Minecraft colour codes and `&#RRGGBB` hex supported).
- Undo/redo, placeholder insertion, import of existing `config.yml` (unknown sections preserved and re-emitted), YAML preview, download, save to project.
- The sidebar preview is explicitly labelled as simulation only: TAB does not manage sidebar scoreboards.
- TAB animation definitions live in TAB's separate `animations.yml`; the visual editor does not generate that file (see limitations).

**LuckPerms workflow**
- Plugin installation, version and compatibility checks, config file access, documentation links, recommended in-game commands, example permission nodes and role-planning notes saved per plugin.
- No web permission editor and no live server/RCON connection, by design.

**AI assistant (optional)**
- OpenAI-compatible provider abstraction (`AI_PROVIDER`, `AI_API_KEY`, `AI_MODEL`, `AI_BASE_URL`).
- The backend gathers candidates from the local library and Modrinth (real search metadata), then the model may only select from those candidate IDs. Unknown IDs are dropped, incompatible plugins are skipped, and compatibility is recomputed at install time.
- Plans require explicit approval; installation reuses the normal validated download/install pipeline.
- Without AI configuration the whole manual workflow still works and `/api/ai/plan` returns `503 ai_not_configured`.

**ZIP export**
- Backend-generated ZIP containing **only** `plugins/` with the selected JARs and configuration files, preserving nested directories.
- Preview endpoint lists every entry, file count and total size; detects filename and file/directory collisions; blocks export when a plugin file is missing.
- Optional exclusion of template-origin configuration files; validated after creation (every entry must live under `plugins/`).

---

## 3. Installation

Requirements: **Node.js 22.5+** (Node 24 recommended; uses built-in `node:sqlite`), npm.

```bash
git clone <your-repo-url> server-setup-maker
cd server-setup-maker
npm ci            # or: npm install
cp .env.example .env
npm run db:migrate
```

`npm run db:migrate` creates the SQLite schema and seeds the built-in templates. The server also does this automatically on first start.

## 4. Development

```bash
npm run dev
```

- API: <http://127.0.0.1:8787>
- UI (Vite with `/api` proxy): <http://localhost:3000>

If you open the Vite server through a remote hostname (reverse proxy, cloud preview), allow that exact host with `__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=your.host npm run dev`.

Other commands:

```bash
npm run dev:server     # API only (tsx watch)
npm run dev:client     # Vite only (port 3000)
npm run typecheck      # TypeScript, client + server + tests
npm test               # Vitest suite (41 tests)
npm run test:watch     # watch mode
npm run db:migrate     # (re)initialise schema + seed templates
```

## 5. Production

```bash
npm run build     # Vite client -> dist/client, esbuild server -> dist/server/index.js
npm start         # serves API + built client on PORT (default 8787)
```

The Express server serves `dist/client` with an SPA fallback; set `HOST=0.0.0.0` if you intentionally expose it (see security notes).

---

## 6. Configuration

Copy `.env.example` to `.env`. Values are read at startup.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8787` | API / production HTTP port |
| `HOST` | `127.0.0.1` | Bind address |
| `API_PORT` | `8787` | Vite dev proxy target |
| `DATA_DIR` | `./storage` | Database, plugin files, templates |
| `MAX_UPLOAD_BYTES` | `67108864` | Upload size limit |
| `MAX_ARCHIVE_ENTRIES` | `2000` | ZIP entry limit |
| `MAX_EXTRACTED_BYTES` | `268435456` | Max uncompressed ZIP bytes |
| `MAX_DOWNLOAD_BYTES` | `134217728` | Max plugin download size |
| `REQUEST_TIMEOUT_MS` | `20000` | Outbound request timeout |
| `MODRINTH_USER_AGENT` | `serversetup-maker/1.0 (self-hosted)` | Sent to Modrinth; use contact info |
| `GITHUB_TOKEN` | – | Optional; lifts GitHub rate limits for Leaf build metadata |
| `AI_PROVIDER` | `none` | `openai`, `openai-compatible`, or `none` |
| `AI_API_KEY` | – | Provider key (server-side only) |
| `AI_MODEL` | `gpt-4o-mini` | Model name |
| `AI_BASE_URL` | `https://api.openai.com/v1` | OpenAI-compatible API root |
| `CORS_ORIGINS` | – | Optional comma-separated extra origins |

### AI provider setup

```dotenv
AI_PROVIDER=openai-compatible
AI_API_KEY=your-key
AI_MODEL=your-model
AI_BASE_URL=https://your-provider.example/v1
```

Restart the server after editing `.env`. The key is only used by the backend and is never sent to the browser. Settings shows whether AI is configured.

---

## 7. Plugin storage and Modrinth caching

- Uploaded JARs: `storage/plugins/uploaded/<libraryId>/<original-file-name>.jar`, SHA-256 recorded in SQLite.
- Modrinth downloads: `storage/plugins/modrinth/<projectId>/<versionId>/<file>.jar`, downloaded through the validated pipeline, checked against the SHA-512 Modrinth publishes when available.
- A Modrinth library row is keyed by `(source, project id, version id)`. If the row exists and its file is still present, the cached file is reused (`cached: true`); if the file was deleted, it is re-downloaded into the same path.
- Removing a plugin from a project never deletes shared cached files. Library deletion removes the file only when no other library entry references it.
- Server metadata (Mojang versions, PaperMC versions/builds, Leaf releases) is cached in memory for 30 minutes; stale cached values are used with a warning if upstream fails.

## 8. Creating a server setup template

1. Open **Server Setups** → **Create template**.
2. Fill name, description, categories, recommended versions and software, and add plugin references (name + optional Modrinth slug + required flag). References are resolved against your library first; with “download missing” enabled, the Modrinth slug is used through the backend installer.
3. Save. Use **Duplicate** on built-ins to customise them (built-ins are read-only).
4. Alternatively open a project → **Overview** → **Create from project** to capture its current plugin list.
5. Applying always previews availability, compatibility and warnings before anything changes.

## 9. Exporting the plugin ZIP

1. Open the project → **Export**.
2. Review the entry list, total size and any collisions/errors.
3. Choose whether template-origin configuration files are included.
4. Click **Download ZIP** — the backend builds `<ServerName>-Setup.zip` and streams it.

```
HamburgerSMP-Setup.zip
└── plugins/
    ├── EssentialsX-2.22.0.jar
    └── Essentials/
        ├── config.yml
        └── kits.yml
```

The archive never contains server JARs, worlds, logs, `server.properties`, the database, `.env`, caches or absolute paths. Collisions are reported instead of silently overwritten.

---

## 10. Tests

```bash
npm test
```

Verified locally: **7 test files, 43 tests passed** (plus `npm run typecheck` and `npm run build`).

| Area | Coverage |
| --- | --- |
| Projects | create, persist, reopen, update, duplicate, delete, version validation |
| Config files | create/update/validate, traversal rejection, unsafe YAML tags, delete |
| Library | JAR upload + `plugin.yml` inspection, duplicate hash conflict, search, metadata, template attach, hostile ZIP, unsupported types, version replacement preserving configs, reference-safe deletion |
| Export | preview, real ZIP inspection, only `plugins/`, no secrets/DB, template exclusion, collisions, missing plugin file |
| TAB | generate/parse round-trip, unsupported-section preservation, validation, version adapter, YAML routes, save into project |
| Network | private-IP detection, host allowlist, credential/protocol rejection, redirect refusal, upstream failures, SHA-512 matching, size limits, Modrinth search/version parsing, unavailable plugin versions |
| AI | configured plan grounding, invented-ID rejection, approved installation through the download pipeline, unconfigured provider 503 while manual workflows stay available |

External services (Modrinth, DNS, AI provider) are mocked in tests; the pipeline itself is real (files written, ZIP inspected).

---

## 11. API overview

```
GET    /api/health
GET    /api/settings                PUT /api/settings
GET    /api/minecraft/versions      GET /api/minecraft/builds

GET    /api/projects                POST /api/projects
GET    /api/projects/:id            PATCH/DELETE /api/projects/:id
POST   /api/projects/:id/duplicate
GET    /api/projects/:id/plugins    POST /api/projects/:id/plugins
POST   /api/projects/:id/plugins/batch
PATCH  /api/projects/:id/plugins/:pluginId
POST   /api/projects/:id/plugins/:pluginId/reinstall
POST   /api/projects/:id/plugins/:pluginId/replace
POST   /api/projects/:id/plugins/resolve-dependencies
DELETE /api/projects/:id/plugins/:pluginId
GET    /api/projects/:id/dependencies
GET    /api/projects/:id/configs    POST /api/projects/:id/configs
PUT    /api/projects/:id/configs/:configId
DELETE /api/projects/:id/configs/:configId
POST   /api/projects/:id/configs/import
POST   /api/projects/:id/configs/validate
GET    /api/projects/:id/configs/:configId/download
POST   /api/projects/:id/configs/:configId/reset
GET    /api/projects/:id/export/preview
GET    /api/projects/:id/export

GET    /api/plugins/library         POST /api/plugins/library/upload
GET    /api/plugins/library/:id     PATCH/DELETE /api/plugins/library/:id
GET    /api/plugins/categories      POST /api/plugins/categories
POST   /api/plugins/download        POST /api/plugins/library/:id/redownload

GET    /api/modrinth/search         GET /api/modrinth/project/:id
GET    /api/modrinth/versions/:id

GET    /api/templates               POST /api/templates
GET    /api/templates/:id           PATCH/DELETE /api/templates/:id
POST   /api/templates/:id/duplicate
GET    /api/templates/:id/preview   POST /api/templates/:id/apply
POST   /api/templates/from-project

GET    /api/ai/status               POST /api/ai/plan
POST   /api/ai/install-plan

GET    /api/tab/model               POST /api/tab/parse|validate|preview|generate
GET    /api/tab/projects/:id/context
POST   /api/tab/projects/:id/save
GET    /api/tab/luckperms/guide
```

Errors use `{ "error": { "code": "...", "message": "...", "details": ... } }` with appropriate status codes (400/404/409/413/422/429/502/503/504).

---

## 12. Security model

- All paths are normalized and contained under `DATA_DIR`; traversal, absolute paths, drive letters, reserved names, control characters and symlinks are rejected.
- Uploads: size limits, extension allowlist, ZIP entry/size limits, duplicate-entry detection, text-only extraction; archives are never executed and JARs are never loaded.
- YAML uses the JSON schema only, so `!!python/...` style tags are rejected; YAML is re-validated before export.
- Outbound requests: HTTPS only, explicit host allowlists, DNS resolution checks that block private/link-local/metadata addresses, manual redirect handling with re-validation (max 4), timeouts and byte ceilings.
- Downloads are restricted to Modrinth CDN/GitHub hosts; hashes are verified when published. AI responses cannot supply download URLs.
- No shell execution. API keys stay in server environment variables. Exports contain no secrets or internal paths.
- Basic security headers are set; CORS is disabled unless explicitly configured; expensive endpoints are rate limited in-process.

### Deployment assumptions

This is a private, self-hosted tool. **There is no built-in authentication.** Run it on localhost, or publish it only behind a reverse proxy that enforces authentication and TLS. Anyone who can reach the API can manage projects and download plugin files.

## 13. Known limitations

- **TAB adapter covers the TAB 5.x layout only.** Older TAB versions are detected and the UI warns you to use the generic editor; unsupported sections are preserved verbatim. TAB animation files (`animations.yml`) are not generated or edited.
- **No LuckPerms permission editor, no RCON, no live server connection.** LuckPerms is managed in-game/its web editor; this app provides installation, docs and notes.
- **No Minecraft server JAR, world or proxy (Velocity/BungeeCord) management.** Server JARs are intentionally excluded from downloads and exports.
- **Modrinth is the only remote plugin source.** SpigotMC/Hangar/Ore downloads are not automated; upload those JARs manually.
- **Folia/Leaf compatibility is advisory.** A plugin is only “verified” when its published metadata claims support; Folia plugins still need per-plugin evaluation.
- **Leaf metadata depends on GitHub** and may be rate limited without `GITHUB_TOKEN`; the UI falls back to manual build entry.
- **Version support is metadata-driven.** Custom/unverified versions are accepted but marked as unverified.
- **Download progress is not streamed byte-by-byte**; requests report start/finish with per-item results rather than a live progress bar. Interrupted `.part` downloads are cleaned up on startup and can be retried with “Re-download”.
- **Sidebar scoreboard preview is illustrative** and never written to TAB configuration.
- SQLite/`node:sqlite` is single-writer; this app is designed for one user/local use, not multi-tenant hosting.
