#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline/promises'
import { stdin, stdout, stderr, exit } from 'node:process'

const DEFAULT_IGNORE_WATCH = 'node_modules build dist .git bower_components logs .swp'
const useColor = stdout.isTTY && stderr.isTTY && process.env.NO_COLOR === undefined

const colors: Record<string, string> = {
  reset: '\x1b[0m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  bold: '\x1b[1m',
  gray: '\x1b[90m'
}

const pluginMenuChoices = ['Route', 'Hook', 'Decorator', 'Child plugin', 'Done']

function colorize(text: string, tone: string): string {
  if (!useColor) {
    return text
  }

  return `${colors[tone]}${text}${colors.reset}`
}

interface CategoryOption {
  key: string
  label: string
  type: 'number' | 'string' | 'boolean' | 'tri-boolean' | 'choice'
  choices?: string[]
  default: number | string | boolean | undefined
}

interface Category {
  key: string
  name: string
  options: CategoryOption[]
}

interface ResolvedOptions {
  [key: string]: string | number | boolean | undefined
}

interface PluginScaffold {
  pluginName: string
  routeNames: string[]
  hookNames: string[]
  hasDecorator: boolean
  childPluginName: string | undefined
  additions: string[]
}

interface GeneratedFile {
  relativePath: string
  content: string
}

const categories: Category[] = [
  {
    key: 'network',
    name: 'Network',
    options: [
      { key: 'port', label: 'Port', type: 'number', default: 3000 },
      { key: 'host', label: 'Host', type: 'string', default: undefined },
      { key: 'socket', label: 'Socket', type: 'string', default: undefined },
      { key: 'prefix', label: 'Prefix', type: 'string', default: undefined }
    ]
  },
  {
    key: 'logging',
    name: 'Logging',
    options: [
      {
        key: 'logLevel',
        label: 'Log level',
        type: 'choice',
        choices: ['fatal', 'error', 'warn', 'info', 'debug', 'trace'],
        default: 'fatal'
      },
      { key: 'prettyLogs', label: 'Pretty logs', type: 'boolean', default: false }
    ]
  },
  {
    key: 'debug',
    name: 'Debug',
    options: [
      { key: 'debug', label: 'Enable debug inspector', type: 'boolean', default: false },
      { key: 'debugPort', label: 'Debug port', type: 'number', default: 9320 },
      { key: 'debugHost', label: 'Debug host', type: 'string', default: undefined }
    ]
  },
  {
    key: 'watch',
    name: 'Watch Mode',
    options: [
      { key: 'watch', label: 'Enable watch mode', type: 'boolean', default: false },
      { key: 'ignoreWatch', label: 'Ignore watch list', type: 'string', default: DEFAULT_IGNORE_WATCH },
      { key: 'verboseWatch', label: 'Verbose watch events', type: 'boolean', default: false }
    ]
  },
  {
    key: 'safety',
    name: 'Safety and Limits',
    options: [
      { key: 'pluginTimeout', label: 'Plugin timeout (ms)', type: 'number', default: 10000 },
      { key: 'bodyLimit', label: 'Body limit (bytes)', type: 'number', default: undefined },
      { key: 'closeGraceDelay', label: 'Close grace delay (ms)', type: 'number', default: 500 }
    ]
  },
  {
    key: 'trustProxy',
    name: 'Trust Proxy',
    options: [
      { key: 'trustProxyEnabled', label: 'Trust proxy enabled', type: 'tri-boolean', default: undefined },
      { key: 'trustProxyIps', label: 'Trust proxy IPs/CIDR', type: 'string', default: undefined },
      { key: 'trustProxyHop', label: 'Trust proxy hop', type: 'number', default: undefined }
    ]
  }
]

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printHelp()
    exit(0)
  }

  if (args[0] === 'generate') {
    fail('Invalid command. Use: fastify-new <new-directory>')
  }

  const targetDir = args[0]
  const rest = args.slice(1)

  if (!targetDir) {
    fail('Missing target directory. Usage: fastify-new <new-directory>')
  }

  const invalidArg = rest.find((arg) => arg.startsWith('-'))
  if (invalidArg) {
    fail(`Option flags are disabled in MVP setup flow: ${invalidArg}`)
  }

  const unexpectedArg = rest.find((arg) => !arg.startsWith('-'))
  if (unexpectedArg) {
    fail(`Unexpected argument: ${unexpectedArg}. Usage: fastify-new <new-directory>`)
  }

  validateNewProjectTarget(targetDir)

  const rl = readline.createInterface({ input: stdin, output: stdout })
  try {
    const resolvedOptions = await runSetupFlow(rl)
    const pluginScaffolds = await runPluginScaffoldWizard(rl)
    printPluginScaffoldSummary(pluginScaffolds)
    const shouldRun = await askChoice(rl, 'Setup complete. Continue?', ['Generate', 'Cancel'])

    if (shouldRun === 'Cancel') {
      stdout.write(`\n${colorize('Cancelled. No files were written.', 'yellow')}\n`)
      return
    }

    generateProject(targetDir, resolvedOptions, pluginScaffolds)
    stdout.write(`\n${colorize('Project created in', 'green')} ${colorize(targetDir, 'bold')}\n`)
  } finally {
    rl.close()
  }
}

function validateNewProjectTarget(targetDir: string): void {
  if (targetDir === '.') {
    fail('Current directory generation is disabled in MVP. Use a new directory name.')
  }

  const absoluteTarget = path.resolve(process.cwd(), targetDir)
  if (fs.existsSync(absoluteTarget)) {
    fail('Target directory already exists. Please choose a new directory.')
  }
}

async function runSetupFlow(rl: readline.Interface): Promise<ResolvedOptions> {
  const mode = await askChoice(rl, 'How do you want to set this up?', [
    'Default setup (quick start)',
    'Guided setup (choose by category)'
  ])

  if (mode.startsWith('Default setup')) {
    const defaults = buildAllDefaults()
    printSummary(defaults)
    return defaults
  }

  const resolved: ResolvedOptions = {}
  for (const category of categories) {
    const categoryAction = await askChoice(rl, `${category.name}: choose how to continue`, [
      'Skip this category (use defaults)',
      'Configure this category (prompt me)'
    ])

    if (categoryAction.startsWith('Skip')) {
      applyCategoryDefaults(category, resolved)
      continue
    }

    await promptCategoryOptions(rl, category, resolved)
  }

  applyTrustProxyPrecedence(resolved)
  printSummary(resolved)
  return resolved
}

function buildAllDefaults(): ResolvedOptions {
  const resolved: ResolvedOptions = {}
  for (const category of categories) {
    applyCategoryDefaults(category, resolved)
  }
  applyTrustProxyPrecedence(resolved)
  return resolved
}

function applyCategoryDefaults(category: Category, resolved: ResolvedOptions): void {
  for (const option of category.options) {
    resolved[option.key] = option.default
  }
}

async function promptCategoryOptions(rl: readline.Interface, category: Category, resolved: ResolvedOptions): Promise<void> {
  for (const option of category.options) {
    resolved[option.key] = await askOption(rl, option)
  }
  if (category.key === 'trustProxy') {
    applyTrustProxyPrecedence(resolved)
  }
}

function applyTrustProxyPrecedence(resolved: ResolvedOptions): void {
  if (typeof resolved.trustProxyEnabled === 'boolean') {
    resolved.trustProxyEffective = resolved.trustProxyEnabled
    return
  }

  if (typeof resolved.trustProxyIps === 'string' && resolved.trustProxyIps.length > 0) {
    resolved.trustProxyEffective = resolved.trustProxyIps
    return
  }

  if (typeof resolved.trustProxyHop === 'number') {
    resolved.trustProxyEffective = resolved.trustProxyHop
    return
  }

  resolved.trustProxyEffective = undefined
}

function printSummary(resolvedOptions: ResolvedOptions): void {
  stdout.write(`\n${colorize('Resolved setup options:', 'cyan')}\n`)
  for (const [key, value] of Object.entries(resolvedOptions)) {
    const printable = value === undefined ? '(default/unset)' : value
    const keyLabel = colorize(key, 'bold')
    const valueLabel = value === undefined ? colorize(String(printable), 'gray') : printable
    stdout.write(`- ${keyLabel}: ${valueLabel}\n`)
  }
  stdout.write('\n')
}

async function runPluginScaffoldWizard(rl: readline.Interface): Promise<PluginScaffold[]> {
  const pluginScaffolds: PluginScaffold[] = []

  while (true) {
    let pluginName: string | undefined
    const routeNames: string[] = []
    const hookNames: string[] = []
    let hasDecorator = false
    let childPluginName: string | undefined

    while (true) {
      const promptMessage = pluginName
        ? `What would you like to add to "${pluginName}"?`
        : 'What would you like to add?'
      const selected = await askChoice(rl, promptMessage, pluginMenuChoices)

      if (selected === 'Done') {
        break
      }

      if (!pluginName) {
        pluginName = await askPluginName(rl, 'Plugin name')
      }

      if (selected === 'Child plugin') {
        if (childPluginName) {
          stdout.write(`${colorize('Child plugin already selected for this plugin.', 'yellow')}\n`)
          continue
        }

        while (true) {
          childPluginName = await askPluginName(rl, 'Child plugin name')
          if (childPluginName !== pluginName) {
            break
          }

          stdout.write(`${colorize('Child plugin name must be different from the parent plugin name.', 'yellow')}\n`)
        }

        stdout.write(`${colorize(`Added: Child plugin (${childPluginName})`, 'green')}\n`)
        continue
      }

      if (selected === 'Decorator') {
        if (hasDecorator) {
          stdout.write(`${colorize('Decorator already selected for this plugin.', 'yellow')}\n`)
          continue
        }

        hasDecorator = true
        stdout.write(`${colorize('Added: Decorator', 'green')}\n`)
        continue
      }

      if (selected === 'Route') {
        const routeName = await askPluginName(rl, 'Route name')
        if (routeNames.includes(routeName)) {
          stdout.write(`${colorize(`Route "${routeName}" already exists for this plugin.`, 'yellow')}\n`)
          continue
        }

        routeNames.push(routeName)
        stdout.write(`${colorize(`Added: Route (${routeName})`, 'green')}\n`)
        continue
      }

      if (selected === 'Hook') {
        const hookName = await askPluginName(rl, 'Hook name')
        if (hookNames.includes(hookName)) {
          stdout.write(`${colorize(`Hook "${hookName}" already exists for this plugin.`, 'yellow')}\n`)
          continue
        }

        hookNames.push(hookName)
        stdout.write(`${colorize(`Added: Hook (${hookName})`, 'green')}\n`)
        continue
      }
    }

    if (!pluginName) {
      break
    }

    pluginScaffolds.push({
      pluginName,
      routeNames,
      hookNames,
      hasDecorator,
      childPluginName,
      additions: []
    })

    const addAnotherPlugin = await askChoice(rl, 'Would you like to scaffold another plugin?', ['Yes', 'No'])
    if (addAnotherPlugin === 'No') {
      break
    }
  }

  return pluginScaffolds
}

async function askPluginName(rl: readline.Interface, label: string): Promise<string> {
  while (true) {
    const name = await askInput(rl, label, undefined)
    if (/^[a-z][a-z0-9-]*$/.test(name)) {
      return name
    }

    stdout.write(`${colorize('Use lowercase letters, numbers, and dashes only; must start with a letter.', 'yellow')}\n`)
  }
}

function printPluginScaffoldSummary(pluginScaffolds: PluginScaffold[]): void {
  if (!pluginScaffolds || pluginScaffolds.length === 0) {
    stdout.write(`${colorize('Plugin scaffold:', 'cyan')} ${colorize('none', 'gray')}\n\n`)
    return
  }

  stdout.write(`${colorize('Plugin scaffolds:', 'cyan')}\n`)
  for (const pluginScaffold of pluginScaffolds) {
    const additions: string[] = []
    if (pluginScaffold.routeNames.length > 0) {
      additions.push(`routes x${pluginScaffold.routeNames.length}`)
    }
    if (pluginScaffold.hookNames.length > 0) {
      additions.push(`hooks x${pluginScaffold.hookNames.length}`)
    }
    if (pluginScaffold.hasDecorator) {
      additions.push('decorator')
    }
    if (pluginScaffold.childPluginName) {
      additions.push('child plugin')
    }

    const additionsText = additions.length > 0
      ? additions.join(', ')
      : 'none (base plugin only)'

    stdout.write(`- ${colorize(pluginScaffold.pluginName, 'bold')}: ${additionsText}\n`)
    if (pluginScaffold.childPluginName) {
      stdout.write(`  ${colorize('child plugin', 'bold')}: ${pluginScaffold.childPluginName}\n`)
    }
    if (pluginScaffold.routeNames.length > 0) {
      stdout.write(`  ${colorize('routes', 'bold')}: ${pluginScaffold.routeNames.map((name) => `/${name}`).join(', ')}\n`)
    }
    if (pluginScaffold.hookNames.length > 0) {
      stdout.write(`  ${colorize('hooks', 'bold')}: ${pluginScaffold.hookNames.join(', ')}\n`)
    }
  }

  stdout.write('\n')
}

async function askOption(rl: readline.Interface, option: CategoryOption): Promise<string | number | boolean | undefined> {
  if (option.type === 'boolean') {
    const answer = await askChoice(rl, `${option.label}?`, ['No', 'Yes'])
    return answer === 'Yes'
  }

  if (option.type === 'tri-boolean') {
    const answer = await askChoice(rl, `${option.label}:`, ['Unset (default)', 'False', 'True'])
    if (answer === 'True') {
      return true
    }
    if (answer === 'False') {
      return false
    }
    return undefined
  }

  if (option.type === 'choice') {
    return askChoice(rl, `${option.label}:`, option.choices!)
  }

  if (option.type === 'number') {
    const response = await askInput(rl, `${option.label}`, option.default)
    if (response === '') {
      return undefined
    }

    const parsed = Number(response)
    if (Number.isNaN(parsed)) {
      stdout.write(`${colorize('Invalid number, using default/unset.', 'yellow')}\n`)
      return option.default
    }
    return parsed
  }

  const response = await askInput(rl, `${option.label}`, option.default)
  return response === '' ? undefined : response
}

async function askChoice(rl: readline.Interface, message: string, options: string[]): Promise<string> {
  stdout.write(`\n${colorize(message, 'cyan')}\n`)
  options.forEach((option, index) => {
    stdout.write(`  ${colorize(String(index + 1), 'bold')}) ${option}\n`)
  })

  while (true) {
    const answer = await rl.question(`${colorize('Select an option: ', 'bold')}`)
    const index = Number(answer)
    if (!Number.isNaN(index) && index >= 1 && index <= options.length) {
      return options[index - 1]
    }
    stdout.write(`${colorize('Please enter a valid option number.', 'yellow')}\n`)
  }
}

async function askInput(rl: readline.Interface, label: string, defaultValue: string | number | boolean | undefined): Promise<string> {
  const suffix = defaultValue === undefined ? '' : ` [default: ${defaultValue}]`
  const raw = await rl.question(`${label}${suffix}: `)
  if (raw.trim() === '') {
    if (defaultValue === undefined) {
      return ''
    }
    return String(defaultValue)
  }
  return raw.trim()
}

function generateProject(targetDir: string, resolvedOptions: ResolvedOptions, pluginScaffolds: PluginScaffold[]): void {
  const absoluteTarget = path.resolve(process.cwd(), targetDir)
  fs.mkdirSync(absoluteTarget, { recursive: false })

  // Create subdirectories
  fs.mkdirSync(path.join(absoluteTarget, 'plugins'), { recursive: false })
  fs.mkdirSync(path.join(absoluteTarget, 'routes'), { recursive: false })
  fs.mkdirSync(path.join(absoluteTarget, 'routes', 'root'), { recursive: false })
  fs.mkdirSync(path.join(absoluteTarget, 'test'), { recursive: false })
  fs.mkdirSync(path.join(absoluteTarget, 'test', 'plugins'), { recursive: false })
  fs.mkdirSync(path.join(absoluteTarget, 'test', 'routes'), { recursive: false })

  // package.json
  const packageJson = {
    name: path.basename(targetDir),
    version: '1.0.0',
    description: 'A Fastify application',
    main: 'dist/app.js',
    directories: {
      test: 'test'
    },
    scripts: {
      build: 'tsc',
      test: 'tsx --test test/**/*.test.ts',
      start: resolvedOptions.debug
        ? `node --inspect=${resolvedOptions.debugHost ?? 'localhost'}:${resolvedOptions.debugPort ?? 9320} dist/app.js`
        : 'node dist/app.js',
      dev: [
        'tsx',
        resolvedOptions.watch ? 'watch' : '',
        'app.ts'
      ].filter(Boolean).join(' ')
    },
    keywords: ['fastify'],
    author: '',
    license: 'ISC',
    dependencies: {
      '@fastify/autoload': '^6.0.0',
      '@fastify/sensible': '^6.0.0',
      fastify: '^5.0.0',
      'fastify-plugin': '^5.0.0'
    },
    devDependencies: {
      '@types/node': '^22.0.0',
      typescript: '^5.0.0',
      tsx: '^4.0.0'
    }
  }

  // tsconfig.json for the generated project
  const tsconfig = {
    compilerOptions: {
      target: 'ES2022',
      module: 'commonjs',
      lib: ['ES2022'],
      outDir: './dist',
      rootDir: './',
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      forceConsistentCasingInFileNames: true,
      resolveJsonModule: true,
      declaration: true,
      sourceMap: true
    },
    include: ['**/*.ts'],
    exclude: ['node_modules', 'dist']
  }

  // app.ts — the entry point
  const appTs = [
    "import path from 'node:path'",
    "import AutoLoad from '@fastify/autoload'",
    "import Fastify from 'fastify'",
    '',
    'async function start(): Promise<void> {',
    (() => {
      const loggerConfig = resolvedOptions.prettyLogs
        ? `{ level: '${resolvedOptions.logLevel ?? 'fatal'}', transport: { target: 'pino-pretty' } }`
        : `{ level: '${resolvedOptions.logLevel ?? 'fatal'}' }`
      const trustProxyValue = resolvedOptions.trustProxyEffective
      const trustProxyEntry = trustProxyValue !== undefined
        ? `trustProxy: ${typeof trustProxyValue === 'string' ? `'${trustProxyValue}'` : trustProxyValue}`
        : ''
      const extras = [
        resolvedOptions.pluginTimeout !== undefined ? `pluginTimeout: ${resolvedOptions.pluginTimeout}` : '',
        resolvedOptions.bodyLimit !== undefined ? `bodyLimit: ${resolvedOptions.bodyLimit}` : '',
        resolvedOptions.closeGraceDelay !== undefined ? `closeGraceDelay: ${resolvedOptions.closeGraceDelay}` : '',
        trustProxyEntry
      ].filter(Boolean)
      const opts = [`logger: ${loggerConfig}`, ...extras].join(', ')
      return `  const app = Fastify({ ${opts} })`
    })(),
    '',
    '  app.register(AutoLoad, {',
    "    dir: path.join(__dirname, 'plugins'),",
    '    options: {}',
    '  })',
    '',
    '  app.register(AutoLoad, {',
    "    dir: path.join(__dirname, 'routes'),",
    resolvedOptions.prefix
      ? `    options: { prefix: '${resolvedOptions.prefix}' }`
      : '    options: {}',
    '  })',
    '',
    '  app.listen({',
    `    port: ${resolvedOptions.port ?? 3000},`,
    resolvedOptions.host ? `    host: '${resolvedOptions.host}',` : '    // host: undefined,',
    '  }, (err) => {',
    '    if (err) {',
    '      app.log.error(err)',
    '      process.exit(1)',
    '    }',
    "    app.log.info(`server listening on ${app.server.address()}`)",
    '  })',
    '}',
    '',
    'start()',
    ''
  ].join('\n')

  // plugins/sensible.ts
  const pluginSensible = [
    "import fp from 'fastify-plugin'",
    "import sensible from '@fastify/sensible'",
    '',
    '/**',
    ' * This plugins adds some utilities to handle http errors',
    ' *',
    ' * @see https://github.com/fastify/fastify-sensible',
    ' */',
    'export default fp(async function (fastify) {',
    '  fastify.register(sensible)',
    '})',
    ''
  ].join('\n')

  // plugins/support.ts
  const pluginSupport = [
    "import fp from 'fastify-plugin'",
    "import { FastifyInstance } from 'fastify'",
    '',
    '// the use of fastify-plugin is required to be able',
    '// to export the decorators to the outer scope',
    '',
    '/**',
    ' * This defines the support plugin for the application.',
    ' * You can use fastify.someSupport() to call it from your routes.',
    ' */',
    'export default fp(async function (fastify: FastifyInstance) {',
    "  fastify.decorate('someSupport', function () {",
    "    return 'hugs'",
    '  })',
    '})',
    ''
  ].join('\n')

  // routes/root.ts
  const routeRoot = [
    "import { FastifyInstance, FastifyPluginOptions } from 'fastify'",
    '',
    '/**',
    ' * A plugin that provide encapsulated routes, under prefix',
    ' * @param fastify encapsulated fastify instance',
    ' * @param opts plugin options',
    ' */',
    'export default async function (fastify: FastifyInstance, opts: FastifyPluginOptions): Promise<void> {',
    "  fastify.get('/', async function (request, reply) {",
    '    return { root: true }',
    '  })',
    '}',
    ''
  ].join('\n')

  // routes/root/index.ts (auto-loaded as /root)
  const routeRootIndex = [
    "import { FastifyInstance, FastifyPluginOptions } from 'fastify'",
    '',
    'export default async function (fastify: FastifyInstance, opts: FastifyPluginOptions): Promise<void> {',
    "  fastify.get('/', async function (request, reply) {",
    "    return 'root'",
    '  })',
    '}',
    ''
  ].join('\n')

  // test/helper.ts
  const testHelper = [
    '// This file contains code that will be run before your tests.',
    "import { build } from '../app'",
    '',
    'async function buildApp(t: any): Promise<any> {',
    '  const app = await build()',
    '  t.after(() => app.close())',
    '  return app',
    '}',
    '',
    'export { buildApp }',
    ''
  ].join('\n')

  // test/plugins/support.test.ts
  const testPluginSupport = [
    "import { test } from 'node:test'",
    "import assert from 'node:assert'",
    "import { buildApp } from '../helper'",
    '',
    "test('support plugin', async (t) => {",
    '  const app = await buildApp(t)',
    '  assert.ok(app.someSupport())',
    '})',
    ''
  ].join('\n')

  // test/routes/root.test.ts
  const testRouteRoot = [
    "import { test } from 'node:test'",
    "import assert from 'node:assert'",
    "import { buildApp } from '../helper'",
    '',
    "test('root route', async (t) => {",
    '  const app = await buildApp(t)',
    "  const response = await app.inject({ method: 'GET', url: '/' })",
    '  assert.strictEqual(response.statusCode, 200)',
    '  assert.deepStrictEqual(JSON.parse(response.body), { root: true })',
    '})',
    ''
  ].join('\n')

  // .gitignore
  const gitignore = [
    'node_modules',
    'dist',
    '.DS_Store',
    '*.log',
    'build',
    ''
  ].join('\n')

  // .env (used for runtime overrides)
  const dotenv = [
    `PORT=${resolvedOptions.port ?? 3000}`,
    resolvedOptions.host ? `HOST=${resolvedOptions.host}` : '# HOST=',
    `LOG_LEVEL=${resolvedOptions.logLevel ?? 'fatal'}`,
    ''
  ].join('\n')

  // README.md
  const readme = [
    `# ${path.basename(targetDir)}`,
    '',
    'Generated with the Fastify guided CLI.',
    '',
    '## Getting started',
    '',
    '```bash',
    'npm install',
    'npm run dev     # development with tsx',
    'npm run build   # compile TypeScript',
    'npm start       # production (compiled)',
    'npm test        # run tests',
    '```',
    '',
    '## Project layout',
    '',
    '```',
    '├── app.ts             # entry point',
    '├── tsconfig.json      # TypeScript configuration',
    '├── plugins/           # shared plugins (decorated on fastify instance)',
    '│   ├── sensible.ts',
    '│   └── support.ts',
    '├── routes/            # encapsulated route plugins',
    '│   ├── root.ts',
    '│   └── root/',
    '│       └── index.ts',
    '└── test/',
    '    ├── helper.ts',
    '    ├── plugins/',
    '    │   └── support.test.ts',
    '    └── routes/',
    '        └── root.test.ts',
    '```',
    '',
    '## Resolved setup',
    '```json',
    JSON.stringify({
      options: resolvedOptions,
      pluginScaffolds
    }, null, 2),
    '```',
    ''
  ].join('\n')

  const customPluginFiles = buildCustomPluginFiles(pluginScaffolds)
  const baseGeneratedFilePaths = [
    'package.json',
    'tsconfig.json',
    'app.ts',
    'plugins/sensible.ts',
    'plugins/support.ts',
    'routes/root.ts',
    'routes/root/index.ts',
    'test/helper.ts',
    'test/plugins/support.test.ts',
    'test/routes/root.test.ts',
    '.gitignore',
    '.env',
    'README.md'
  ]

  ensureNoDuplicateFilePaths([
    ...baseGeneratedFilePaths,
    ...customPluginFiles.map((file) => file.relativePath)
  ])

  // Write all files
  fs.writeFileSync(path.join(absoluteTarget, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`)
  fs.writeFileSync(path.join(absoluteTarget, 'tsconfig.json'), `${JSON.stringify(tsconfig, null, 2)}\n`)
  fs.writeFileSync(path.join(absoluteTarget, 'app.ts'), appTs)
  fs.writeFileSync(path.join(absoluteTarget, 'plugins', 'sensible.ts'), pluginSensible)
  fs.writeFileSync(path.join(absoluteTarget, 'plugins', 'support.ts'), pluginSupport)
  fs.writeFileSync(path.join(absoluteTarget, 'routes', 'root.ts'), routeRoot)
  fs.writeFileSync(path.join(absoluteTarget, 'routes', 'root', 'index.ts'), routeRootIndex)
  fs.writeFileSync(path.join(absoluteTarget, 'test', 'helper.ts'), testHelper)
  fs.writeFileSync(path.join(absoluteTarget, 'test', 'plugins', 'support.test.ts'), testPluginSupport)
  fs.writeFileSync(path.join(absoluteTarget, 'test', 'routes', 'root.test.ts'), testRouteRoot)
  fs.writeFileSync(path.join(absoluteTarget, '.gitignore'), gitignore)
  fs.writeFileSync(path.join(absoluteTarget, '.env'), dotenv)
  fs.writeFileSync(path.join(absoluteTarget, 'README.md'), readme)

  for (const file of customPluginFiles) {
    fs.mkdirSync(path.dirname(path.join(absoluteTarget, file.relativePath)), { recursive: true })
    fs.writeFileSync(path.join(absoluteTarget, file.relativePath), file.content)
  }
}

function buildCustomPluginFiles(pluginScaffolds: PluginScaffold[]): GeneratedFile[] {
  if (!pluginScaffolds || pluginScaffolds.length === 0) {
    return []
  }

  const files: GeneratedFile[] = []
  for (const pluginScaffold of pluginScaffolds) {
    files.push(...buildPluginFiles(pluginScaffold))
  }

  return files
}

function buildPluginFiles(pluginScaffold: PluginScaffold): GeneratedFile[] {
  if (!pluginScaffold) {
    return []
  }

  const pluginRoot = path.posix.join('plugins', pluginScaffold.pluginName)
  const routeNames = pluginScaffold.routeNames || []
  const hookNames = pluginScaffold.hookNames || []
  const hasDecorator = pluginScaffold.hasDecorator === true
  const childPluginName = pluginScaffold.childPluginName || 'child'

  const indexLines = [
    "import { FastifyInstance, FastifyPluginOptions } from 'fastify'",
    '',
    'export default async function (fastify: FastifyInstance, opts: FastifyPluginOptions): Promise<void> {'
  ]

  if (hasDecorator) {
    indexLines.push("  import('./decorator').then((mod) => mod.default(fastify))")
  }

  for (const hookName of hookNames) {
    indexLines.push(`  import('./hooks/${hookName}').then((mod) => mod.default(fastify))`)
  }

  for (const routeName of routeNames) {
    indexLines.push(`  fastify.register(import('./routes/${routeName}'), { prefix: '/${routeName}' })`)
  }

  if (pluginScaffold.childPluginName) {
    indexLines.push(`  fastify.register(import('./plugins/${childPluginName}'))`)
  }

  if (routeNames.length === 0 && hookNames.length === 0 && !hasDecorator && !pluginScaffold.childPluginName) {
    indexLines.push('  return')
  }

  indexLines.push('}', '')

  const files: GeneratedFile[] = [{
    relativePath: `${pluginRoot}/index.ts`,
    content: indexLines.join('\n')
  }]

  for (const routeName of routeNames) {
    files.push({
      relativePath: `${pluginRoot}/routes/${routeName}/index.ts`,
      content: [
        "import { FastifyInstance, FastifyPluginOptions } from 'fastify'",
        '',
        'export default async function (fastify: FastifyInstance, opts: FastifyPluginOptions): Promise<void> {',
        "  fastify.get('/', async function (request, reply) {",
        `    return { plugin: '${pluginScaffold.pluginName}', route: '${routeName}' }`,
        '  })',
        '}',
        ''
      ].join('\n')
    })
  }

  for (const hookName of hookNames) {
    files.push({
      relativePath: `${pluginRoot}/hooks/${hookName}.ts`,
      content: [
        "import { FastifyInstance } from 'fastify'",
        '',
        'export default function (fastify: FastifyInstance): void {',
        "  fastify.addHook('onRequest', async function (request, reply) {})",
        '}',
        ''
      ].join('\n')
    })
  }

  if (hasDecorator) {
    files.push({
      relativePath: `${pluginRoot}/decorator.ts`,
      content: [
        "import { FastifyInstance } from 'fastify'",
        '',
        'export default function (fastify: FastifyInstance): void {',
        "  fastify.decorate('" + pluginScaffold.pluginName + "Service', {",
        '    ping(): string {',
        "      return 'pong'",
        '    }',
        '  })',
        '}',
        ''
      ].join('\n')
    })
  }

  if (pluginScaffold.childPluginName) {
    files.push({
      relativePath: `${pluginRoot}/plugins/${childPluginName}.ts`,
      content: [
        "import { FastifyInstance, FastifyPluginOptions } from 'fastify'",
        '',
        'export default async function (fastify: FastifyInstance, opts: FastifyPluginOptions): Promise<void> {',
        "  fastify.decorate('" + childPluginName + "Ready', true)",
        '}',
        ''
      ].join('\n')
    })
  }

  return files
}

function ensureNoDuplicateFilePaths(filePaths: string[]): void {
  const seen = new Set<string>()

  for (const filePath of filePaths) {
    if (seen.has(filePath)) {
      fail(`Duplicate generated file detected: ${filePath}`)
    }
    seen.add(filePath)
  }
}

function printHelp(): void {
  stdout.write(`${colorize('Usage:', 'cyan')}\n`)
  stdout.write(`  ${colorize('fastify-new <new-directory>', 'bold')}\n`)
  stdout.write(`\n`)
  stdout.write(`${colorize('MVP rules:', 'cyan')}\n`)
  stdout.write(`- ${colorize('setup option flags are disabled', 'gray')}\n`)
  stdout.write(`- ${colorize('target must be a new directory', 'gray')}\n`)
}

function fail(message: string): never {
  stderr.write(`${colorize('Error:', 'red')} ${message}\n`)
  exit(1)
}

main().catch((err: unknown) => {
  fail(err instanceof Error ? err.message : 'Unexpected error')
})
