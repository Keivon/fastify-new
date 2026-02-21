import { stdout } from 'node:process'
import type { Interface as ReadlineInterface } from 'node:readline/promises'
import type { Category, CategoryOption, ResolvedOptions } from '../types'
import { colorize } from '../utils/colors'
import { askChoice, askInput } from '../utils/io'

const DEFAULT_IGNORE_WATCH = 'node_modules build dist .git bower_components logs .swp'

export const categories: Category[] = [
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

export async function runSetupFlow(rl: ReadlineInterface): Promise<ResolvedOptions> {
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

async function promptCategoryOptions(
  rl: ReadlineInterface,
  category: Category,
  resolved: ResolvedOptions
): Promise<void> {
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

async function askOption(
  rl: ReadlineInterface,
  option: CategoryOption
): Promise<string | number | boolean | undefined> {
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
