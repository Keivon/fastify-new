#!/usr/bin/env node
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const readline = require('node:readline/promises')
const { stdin, stdout, stderr, exit } = require('node:process')

const DEFAULT_IGNORE_WATCH = 'node_modules build dist .git bower_components logs .swp'
const useColor = stdout.isTTY && stderr.isTTY && process.env.NO_COLOR === undefined

const colors = {
  reset: '\x1b[0m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  bold: '\x1b[1m',
  gray: '\x1b[90m'
}

function colorize(text, tone) {
  if (!useColor) {
    return text
  }

  return `${colors[tone]}${text}${colors.reset}`
}

const categories = [
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

async function main() {
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
    const shouldRun = await askChoice(rl, 'Review complete. Continue?', ['Run', 'Cancel'])

    if (shouldRun === 'Cancel') {
      stdout.write(`\n${colorize('Cancelled. No files were written.', 'yellow')}\n`)
      return
    }

    generateProject(targetDir, resolvedOptions)
    stdout.write(`\n${colorize('Project created in', 'green')} ${colorize(targetDir, 'bold')}\n`)
  } finally {
    rl.close()
  }
}

function validateNewProjectTarget(targetDir) {
  if (targetDir === '.') {
    fail('Current directory generation is disabled in MVP. Use a new directory name.')
  }

  const absoluteTarget = path.resolve(process.cwd(), targetDir)
  if (fs.existsSync(absoluteTarget)) {
    fail('Target directory already exists. Please choose a new directory.')
  }
}

async function runSetupFlow(rl) {
  const mode = await askChoice(rl, 'How do you want to set this up?', [
    'Default setup (quick start)',
    'Guided setup (choose by category)'
  ])

  if (mode.startsWith('Default setup')) {
    const defaults = buildAllDefaults()
    printSummary(defaults)
    return defaults
  }

  const resolved = {}
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

function buildAllDefaults() {
  const resolved = {}
  for (const category of categories) {
    applyCategoryDefaults(category, resolved)
  }
  applyTrustProxyPrecedence(resolved)
  return resolved
}

function applyCategoryDefaults(category, resolved) {
  for (const option of category.options) {
    resolved[option.key] = option.default
  }
}

async function promptCategoryOptions(rl, category, resolved) {
  for (const option of category.options) {
    resolved[option.key] = await askOption(rl, option)
  }
  if (category.key === 'trustProxy') {
    applyTrustProxyPrecedence(resolved)
  }
}

function applyTrustProxyPrecedence(resolved) {
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

function printSummary(resolvedOptions) {
  stdout.write(`\n${colorize('Resolved setup options:', 'cyan')}\n`)
  for (const [key, value] of Object.entries(resolvedOptions)) {
    const printable = value === undefined ? '(default/unset)' : value
    const keyLabel = colorize(key, 'bold')
    const valueLabel = value === undefined ? colorize(printable, 'gray') : printable
    stdout.write(`- ${keyLabel}: ${valueLabel}\n`)
  }
  stdout.write('\n')
}

async function askOption(rl, option) {
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
    return askChoice(rl, `${option.label}:`, option.choices)
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

async function askChoice(rl, message, options) {
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

async function askInput(rl, label, defaultValue) {
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

function generateProject(targetDir, resolvedOptions) {
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
    main: 'app.js',
    directories: {
      test: 'test'
    },
    scripts: {
      test: 'node --test test/**/*.test.js',
      start: resolvedOptions.debug
        ? `node --inspect=${resolvedOptions.debugHost ?? 'localhost'}:${resolvedOptions.debugPort ?? 9320} app.js`
        : 'node app.js',
      dev: [
        'node',
        resolvedOptions.watch ? '--watch' : '',
        resolvedOptions.debug ? `--inspect=${resolvedOptions.debugHost ?? 'localhost'}:${resolvedOptions.debugPort ?? 9320}` : '',
        'app.js'
      ].filter(Boolean).join(' ')
    },
    keywords: ['fastify'],
    author: '',
    license: 'ISC',
    dependencies: {
      '@fastify/autoload': '^6.0.0',
      '@fastify/sensible': '^6.0.0',
      fastify: '^5.0.0',
      'fastify-cli': '^7.0.0',
      'fastify-plugin': '^5.0.0'
    },
    devDependencies: {}
  }

  // app.js — the entry point consumed by `fastify start`
  const appJs = [
    "'use strict'",
    '',
    "const path = require('node:path')",
    "const AutoLoad = require('@fastify/autoload')",
    "const Fastify = require('fastify')",
    '',
    'async function start() {',
    resolvedOptions.prettyLogs
      ? `  const app = Fastify({ logger: { level: '${resolvedOptions.logLevel ?? 'fatal'}', transport: { target: 'pino-pretty' } } })`
      : `  const app = Fastify({ logger: { level: '${resolvedOptions.logLevel ?? 'fatal'}' } })`,
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
    "    app.log.info(`server listening on ${app.server.address().port}`)",
    '  })',
    '}',
    '',
    'start()',
    ''
  ].join('\n')

  // plugins/sensible.js
  const pluginSensible = [
    "'use strict'",
    '',
    "const fp = require('fastify-plugin')",
    "const sensible = require('@fastify/sensible')",
    '',
    '/**',
    ' * This plugins adds some utilities to handle http errors',
    ' *',
    ' * @see https://github.com/fastify/fastify-sensible',
    ' */',
    'module.exports = fp(async function (fastify, opts) {',
    '  fastify.register(sensible)',
    '})',
    ''
  ].join('\n')

  // plugins/support.js
  const pluginSupport = [
    "'use strict'",
    '',
    "const fp = require('fastify-plugin')",
    '',
    '// the use of fastify-plugin is required to be able',
    '// to export the decorators to the outer scope',
    '',
    '/**',
    ' * This defines the support plugin for the application.',
    ' * You can use fastify.someSupport() to call it from your routes.',
    ' */',
    'module.exports = fp(async function (fastify, opts) {',
    "  fastify.decorate('someSupport', function () {",
    "    return 'hugs'",
    '  })',
    '})',
    ''
  ].join('\n')

  // routes/root.js
  const routeRoot = [
    "'use strict'",
    '',
    '/**',
    ' * A plugin that provide encapsulated routes, under prefix',
    ' * @param {FastifyInstance} fastify encapsulated fastify instance',
    ' * @param {Object} options plugin options, refer to https://fastify.dev/docs/latest/Reference/Plugins/',
    ' */',
    'module.exports = async function (fastify, opts) {',
    "  fastify.get('/', async function (request, reply) {",
    "    return { root: true }",
    '  })',
    '}',
    ''
  ].join('\n')

  // routes/root/index.js (auto-loaded as /root)
  const routeRootIndex = [
    "'use strict'",
    '',
    'module.exports = async function (fastify, opts) {',
    "  fastify.get('/', async function (request, reply) {",
    "    return 'root'",
    '  })',
    '}',
    ''
  ].join('\n')

  // test/helper.js
  const testHelper = [
    "'use strict'",
    '',
    '// This file contains code that will be run before your tests.',
    "const { build } = require('../app')",
    '',
    'async function buildApp (t) {',
    '  const app = await build()',
    '  t.after(() => app.close())',
    '  return app',
    '}',
    '',
    'module.exports = {',
    '  buildApp',
    '}',
    ''
  ].join('\n')

  // test/plugins/support.test.js
  const testPluginSupport = [
    "'use strict'",
    '',
    "const { test } = require('node:test')",
    "const assert = require('node:assert')",
    "const { buildApp } = require('../helper')",
    '',
    "test('support plugin', async (t) => {",
    '  const app = await buildApp(t)',
    "  assert.ok(app.someSupport())",
    '})',
    ''
  ].join('\n')

  // test/routes/root.test.js
  const testRouteRoot = [
    "'use strict'",
    '',
    "const { test } = require('node:test')",
    "const assert = require('node:assert')",
    "const { buildApp } = require('../helper')",
    '',
    "test('root route', async (t) => {",
    '  const app = await buildApp(t)',
    "  const response = await app.inject({ method: 'GET', url: '/' })",
    "  assert.strictEqual(response.statusCode, 200)",
    "  assert.deepStrictEqual(JSON.parse(response.body), { root: true })",
    '})',
    ''
  ].join('\n')

  // .gitignore
  const gitignore = [
    'node_modules',
    '.DS_Store',
    '*.log',
    'build',
    'dist',
    ''
  ].join('\n')

  // .env (used by fastify-cli for overrides at runtime)
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
    'npm run dev   # watch mode',
    'npm start     # production',
    'npm test      # run tests',
    '```',
    '',
    '## Project layout',
    '',
    '```',
    '├── app.js            # entry point (loaded by fastify-cli)',
    '├── plugins/          # shared plugins (decorated on fastify instance)',
    '│   ├── sensible.js',
    '│   └── support.js',
    '├── routes/           # encapsulated route plugins',
    '│   ├── root.js',
    '│   └── root/',
    '│       └── index.js',
    '└── test/',
    '    ├── helper.js',
    '    ├── plugins/',
    '    │   └── support.test.js',
    '    └── routes/',
    '        └── root.test.js',
    '```',
    '',
    '## Resolved setup',
    '```json',
    JSON.stringify(resolvedOptions, null, 2),
    '```',
    ''
  ].join('\n')

  // Write all files
  fs.writeFileSync(path.join(absoluteTarget, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`)
  fs.writeFileSync(path.join(absoluteTarget, 'app.js'), appJs)
  fs.writeFileSync(path.join(absoluteTarget, 'plugins', 'sensible.js'), pluginSensible)
  fs.writeFileSync(path.join(absoluteTarget, 'plugins', 'support.js'), pluginSupport)
  fs.writeFileSync(path.join(absoluteTarget, 'routes', 'root.js'), routeRoot)
  fs.writeFileSync(path.join(absoluteTarget, 'routes', 'root', 'index.js'), routeRootIndex)
  fs.writeFileSync(path.join(absoluteTarget, 'test', 'helper.js'), testHelper)
  fs.writeFileSync(path.join(absoluteTarget, 'test', 'plugins', 'support.test.js'), testPluginSupport)
  fs.writeFileSync(path.join(absoluteTarget, 'test', 'routes', 'root.test.js'), testRouteRoot)
  fs.writeFileSync(path.join(absoluteTarget, '.gitignore'), gitignore)
  fs.writeFileSync(path.join(absoluteTarget, '.env'), dotenv)
  fs.writeFileSync(path.join(absoluteTarget, 'README.md'), readme)
}

function printHelp() {
  stdout.write(`${colorize('Usage:', 'cyan')}\n`)
  stdout.write(`  ${colorize('fastify-new <new-directory>', 'bold')}\n`)
  stdout.write(`\n`)
  stdout.write(`${colorize('MVP rules:', 'cyan')}\n`)
  stdout.write(`- ${colorize('setup option flags are disabled', 'gray')}\n`)
  stdout.write(`- ${colorize('target must be a new directory', 'gray')}\n`)
}

function fail(message) {
  stderr.write(`${colorize('Error:', 'red')} ${message}\n`)
  exit(1)
}

main().catch((err) => {
  fail(err instanceof Error ? err.message : 'Unexpected error')
})
