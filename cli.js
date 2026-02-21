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
      { key: 'address', label: 'Address', type: 'string', default: undefined },
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
  const [command, targetDir, ...rest] = process.argv.slice(2)

  if (command !== 'generate') {
    printHelp()
    exit(1)
  }

  if (!targetDir) {
    fail('Missing target directory. Usage: node cli.js generate <new-directory>')
  }

  const invalidArg = rest.find((arg) => arg.startsWith('-'))
  if (invalidArg) {
    fail(`Option flags are disabled in MVP setup flow: ${invalidArg}`)
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

  const packageJson = {
    name: path.basename(targetDir),
    version: '0.1.0',
    private: true,
    scripts: {
      start: 'node app.js'
    },
    dependencies: {
      fastify: '^5.0.0'
    }
  }

  const appJs = [
    "'use strict'",
    '',
    "const Fastify = require('fastify')",
    '',
    `const app = Fastify({ logger: ${resolvedOptions.prettyLogs ? 'true' : 'false'} })`,
    '',
    "app.get('/', async () => ({ hello: 'world' }))",
    '',
    'app.listen({',
    `  port: ${resolvedOptions.port ?? 3000},`,
    resolvedOptions.address ? `  address: '${resolvedOptions.address}',` : '  // address uses platform default',
    '}, (err) => {',
    '  if (err) {',
    '    app.log.error(err)',
    '    process.exit(1)',
    '  }',
    "  app.log.info('server started')",
    '})',
    ''
  ].join('\n')

  const readme = [
    `# ${path.basename(targetDir)}`,
    '',
    'Generated with the MVP guided flow.',
    '',
    '## Resolved setup',
    '```json',
    JSON.stringify(resolvedOptions, null, 2),
    '```',
    ''
  ].join('\n')

  fs.writeFileSync(path.join(absoluteTarget, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`)
  fs.writeFileSync(path.join(absoluteTarget, 'app.js'), appJs)
  fs.writeFileSync(path.join(absoluteTarget, 'README.md'), readme)
}

function printHelp() {
  stdout.write(`${colorize('Usage:', 'cyan')}\n`)
  stdout.write(`  ${colorize('node cli.js generate <new-directory>', 'bold')}\n\n`)
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
