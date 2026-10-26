import { all, newId, nowIso, run } from './db.js';
import type { ServerSoftware, TemplatePluginRef } from '../shared/types.js';

interface SeedTemplate {
  name: string;
  description: string;
  categories: string[];
  mcVersions: string[];
  software: ServerSoftware | null;
  plugins: TemplatePluginRef[];
  warnings: string[];
  notes: string;
}

const p = (name: string, modrinthSlug: string | undefined, category: string, required = true): TemplatePluginRef => ({
  name,
  modrinthSlug,
  slug: modrinthSlug,
  required,
  category,
});

const COMMON_WARNING =
  'Plugin availability changes over time. This template stores references only; nothing is downloaded until you approve it.';

export const BUILTIN_TEMPLATES: SeedTemplate[] = [
  {
    name: 'Minimal SMP',
    description: 'A small survival server with essentials, permissions and placeholders only.',
    categories: ['Essentials', 'Permissions'],
    mcVersions: ['1.21.4', '1.21.8', '26.1.2'],
    software: 'paper',
    plugins: [
      p('EssentialsX', 'essentialsx', 'Essentials'),
      p('LuckPerms', 'luckperms', 'Permissions'),
      p('PlaceholderAPI', 'placeholderapi', 'Developer Tools'),
    ],
    warnings: [COMMON_WARNING],
    notes: 'Configure LuckPerms in-game with /lp editor after the first start.',
  },
  {
    name: 'Survival SMP',
    description: 'Balanced survival setup: homes, protection, chat formatting and a scoreboard.',
    categories: ['Essentials', 'Protection', 'Chat', 'Scoreboards'],
    mcVersions: ['1.21.4', '1.21.8', '26.1.2'],
    software: 'paper',
    plugins: [
      p('EssentialsX', 'essentialsx', 'Essentials'),
      p('LuckPerms', 'luckperms', 'Permissions'),
      p('PlaceholderAPI', 'placeholderapi', 'Developer Tools'),
      p('WorldGuard', 'worldguard', 'Protection'),
      p('WorldEdit', 'worldedit', 'World Management'),
      p('TAB', 'tab', 'TAB'),
      p('CoreProtect', 'coreprotect', 'Protection'),
    ],
    warnings: [COMMON_WARNING, 'WorldGuard and WorldEdit are large plugins; confirm you actually need region protection.'],
    notes: 'TAB configuration can be generated with the visual TAB editor.',
  },
  {
    name: 'Economy SMP',
    description: 'Adds a Vault-based economy, shops and an auction house on top of the survival core.',
    categories: ['Economy', 'Shops', 'Auction House'],
    mcVersions: ['1.21.4', '1.21.8', '26.1.2'],
    software: 'paper',
    plugins: [
      p('Vault', 'vault', 'Economy'),
      p('EssentialsX', 'essentialsx', 'Essentials'),
      p('LuckPerms', 'luckperms', 'Permissions'),
      p('ChestShop', 'chestshop', 'Shops'),
      p('AuctionHouse', 'auctionhouse', 'Auction House', false),
      p('PlaceholderAPI', 'placeholderapi', 'Developer Tools'),
    ],
    warnings: [COMMON_WARNING, 'Economy providers and shop plugins must agree on the same Vault economy implementation.'],
    notes: 'EssentialsX can provide the economy backend; disable it if you install a dedicated economy plugin.',
  },
  {
    name: 'Towny Server',
    description: 'Town and nation gameplay with land claiming and a chat channel layer.',
    categories: ['Protection', 'World Management', 'Chat'],
    mcVersions: ['1.21.4', '1.21.8'],
    software: 'paper',
    plugins: [
      p('Towny', 'towny', 'Protection'),
      p('LuckPerms', 'luckperms', 'Permissions'),
      p('EssentialsX', 'essentialsx', 'Essentials'),
      p('PlaceholderAPI', 'placeholderapi', 'Developer Tools'),
    ],
    warnings: [COMMON_WARNING, 'Towny has its own economy integration; do not run two economy plugins.'],
    notes: 'Review Towny configuration in the generic config editor after first run.',
  },
  {
    name: 'RPG Server',
    description: 'Quest and progression oriented setup with NPCs and custom menus.',
    categories: ['NPCs', 'GUI', 'Essentials'],
    mcVersions: ['1.21.4', '1.21.8'],
    software: 'paper',
    plugins: [
      p('Citizens', 'citizens', 'NPCs'),
      p('DeluxeMenus', 'deluxemenus', 'GUI'),
      p('LuckPerms', 'luckperms', 'Permissions'),
      p('PlaceholderAPI', 'placeholderapi', 'Developer Tools'),
      p('Vault', 'vault', 'Economy', false),
    ],
    warnings: [COMMON_WARNING, 'Quest plugins are not included; add one that is available for your server version.'],
    notes: 'RPG content (items, mobs, quests) is out of scope for this builder.',
  },
  {
    name: 'Bedrock-Compatible SMP',
    description: 'Lets Bedrock clients join a Java server through Geyser and Floodgate.',
    categories: ['Bedrock Compatibility', 'Essentials'],
    mcVersions: ['1.21.4', '1.21.8', '26.1.2'],
    software: 'paper',
    plugins: [
      p('Geyser-Spigot', 'geyser', 'Bedrock Compatibility'),
      p('Floodgate', 'floodgate', 'Bedrock Compatibility'),
      p('EssentialsX', 'essentialsx', 'Essentials'),
      p('LuckPerms', 'luckperms', 'Permissions'),
    ],
    warnings: [
      COMMON_WARNING,
      'Bedrock support adds latency and requires an open UDP port (19132 by default).',
    ],
    notes: 'Geyser and Floodgate must be kept in sync with the server version.',
  },
  {
    name: 'Performance-Focused Server',
    description: 'Minimal plugin surface with profilers and pre-generation helpers.',
    categories: ['Performance', 'Optimization'],
    mcVersions: ['1.21.4', '1.21.8', '26.1.2'],
    software: 'paper',
    plugins: [p('spark', 'spark', 'Performance'), p('Chunky', 'chunky', 'World Management', false)],
    warnings: [COMMON_WARNING, 'Server JARs and Aikar flags are out of scope; this builder only manages plugins.'],
    notes: 'Use spark to profile before adding more plugins.',
  },
  {
    name: 'Lobby Server',
    description: 'A small lobby setup with menus, NPCs and protection.',
    categories: ['GUI', 'NPCs', 'Protection'],
    mcVersions: ['1.21.4', '1.21.8'],
    software: 'paper',
    plugins: [
      p('DeluxeMenus', 'deluxemenus', 'GUI'),
      p('Citizens', 'citizens', 'NPCs'),
      p('WorldGuard', 'worldguard', 'Protection'),
      p('PlaceholderAPI', 'placeholderapi', 'Developer Tools'),
    ],
    warnings: [COMMON_WARNING],
    notes: 'Lobby servers usually sit behind a proxy; proxy plugins are not managed here.',
  },
  {
    name: 'Minigames Server',
    description: 'Base setup for minigame arenas with permissions and placeholders.',
    categories: ['Developer Tools', 'Permissions'],
    mcVersions: ['1.21.4', '1.21.8'],
    software: 'paper',
    plugins: [
      p('LuckPerms', 'luckperms', 'Permissions'),
      p('PlaceholderAPI', 'placeholderapi', 'Developer Tools'),
      p('TAB', 'tab', 'TAB', false),
    ],
    warnings: [COMMON_WARNING, 'Minigame plugins are server-specific; this template only provides the shared foundation.'],
    notes: 'Add your minigame plugin manually after applying.',
  },
  {
    name: 'Custom Setup',
    description: 'An empty template you can extend with your own plugin references.',
    categories: ['Other'],
    mcVersions: [],
    software: null,
    plugins: [],
    warnings: ['Empty template: add plugin references before applying it.'],
    notes: 'Edit this template or duplicate it to keep the original intact.',
  },
];

export function seedTemplates(): void {
  const count = all<{ c: number }>('SELECT COUNT(*) as c FROM templates WHERE builtin = 1')[0];
  if (count && count.c > 0) return;
  const now = nowIso();
  for (const template of BUILTIN_TEMPLATES) {
    run(
      `INSERT INTO templates (id, name, description, categories, mc_versions, software, plugins, warnings, notes, builtin, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      [
        newId(),
        template.name,
        template.description,
        JSON.stringify(template.categories),
        JSON.stringify(template.mcVersions),
        template.software,
        JSON.stringify(template.plugins),
        JSON.stringify(template.warnings),
        template.notes,
        now,
        now,
      ],
    );
  }
}
