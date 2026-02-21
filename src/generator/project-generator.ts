import fs from 'node:fs'
import path from 'node:path'
import type { GeneratedFile, PluginScaffold, ResolvedOptions } from '../types'
import { ensureNoDuplicateFilePaths } from '../utils/validation'

export function generateProject(
  targetDir: string,
  resolvedOptions: ResolvedOptions,
  pluginScaffolds: PluginScaffold[]
): void {
  const absoluteTarget = path.resolve(process.cwd(), targetDir)
  fs.mkdirSync(absoluteTarget, { recursive: false })

  // Create subdirectories
  fs.mkdirSync(path.join(absoluteTarget, 'plugins'), { recursive: false })
  fs.mkdirSync(path.join(absoluteTarget, 'routes'), { recursive: false })
  fs.mkdirSync(path.join(absoluteTarget, 'routes', 'root'), { recursive: false })
  fs.mkdirSync(path.join(absoluteTarget, 'test'), { recursive: false })
  fs.mkdirSync(path.join(absoluteTarget, 'test', 'plugins'), { recursive: false })
  fs.mkdirSync(path.join(absoluteTarget, 'test', 'routes'), { recursive: false })

  const packageJson = buildPackageJson(targetDir, resolvedOptions)
  const tsconfig = buildTsconfig()
  const appTs = buildAppTs(resolvedOptions)
  const pluginSensible = buildPluginSensible()
  const pluginSupport = buildPluginSupport()
  const routeRoot = buildRouteRoot()
  const routeRootIndex = buildRouteRootIndex()
  const testHelper = buildTestHelper()
  const testPluginSupport = buildTestPluginSupport()
  const testRouteRoot = buildTestRouteRoot()
  const gitignore = buildGitignore()
  const dotenv = buildDotenv(resolvedOptions)
  const readme = buildReadme(targetDir, resolvedOptions, pluginScaffolds)

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

function buildPackageJson(targetDir: string, resolvedOptions: ResolvedOptions): object {
  return {
    name: path.basename(targetDir),
    version: '1.0.0',
    description: 'A Fastify application',
    main: 'dist/app.js',
    directories: { test: 'test' },
    scripts: {
      build: 'tsc',
      test: 'tsx --test test/**/*.test.ts',
      start: resolvedOptions.debug
        ? `node --inspect=${resolvedOptions.debugHost ?? 'localhost'}:${resolvedOptions.debugPort ?? 9320} dist/app.js`
        : 'node dist/app.js',
      dev: ['tsx', resolvedOptions.watch ? 'watch' : '', 'app.ts'].filter(Boolean).join(' ')
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
}

function buildTsconfig(): object {
  return {
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
}

function buildAppTs(resolvedOptions: ResolvedOptions): string {
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

  return [
    "import path from 'node:path'",
    "import AutoLoad from '@fastify/autoload'",
    "import Fastify from 'fastify'",
    '',
    'async function start(): Promise<void> {',
    `  const app = Fastify({ ${opts} })`,
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
}

function buildPluginSensible(): string {
  return [
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
}

function buildPluginSupport(): string {
  return [
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
}

function buildRouteRoot(): string {
  return [
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
}

function buildRouteRootIndex(): string {
  return [
    "import { FastifyInstance, FastifyPluginOptions } from 'fastify'",
    '',
    'export default async function (fastify: FastifyInstance, opts: FastifyPluginOptions): Promise<void> {',
    "  fastify.get('/', async function (request, reply) {",
    "    return 'root'",
    '  })',
    '}',
    ''
  ].join('\n')
}

function buildTestHelper(): string {
  return [
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
}

function buildTestPluginSupport(): string {
  return [
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
}

function buildTestRouteRoot(): string {
  return [
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
}

function buildGitignore(): string {
  return ['node_modules', 'dist', '.DS_Store', '*.log', 'build', ''].join('\n')
}

function buildDotenv(resolvedOptions: ResolvedOptions): string {
  return [
    `PORT=${resolvedOptions.port ?? 3000}`,
    resolvedOptions.host ? `HOST=${resolvedOptions.host}` : '# HOST=',
    `LOG_LEVEL=${resolvedOptions.logLevel ?? 'fatal'}`,
    ''
  ].join('\n')
}

function buildReadme(
  targetDir: string,
  resolvedOptions: ResolvedOptions,
  pluginScaffolds: PluginScaffold[]
): string {
  return [
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
    JSON.stringify({ options: resolvedOptions, pluginScaffolds }, null, 2),
    '```',
    ''
  ].join('\n')
}

export function buildCustomPluginFiles(pluginScaffolds: PluginScaffold[]): GeneratedFile[] {
  if (!pluginScaffolds || pluginScaffolds.length === 0) {
    return []
  }

  const files: GeneratedFile[] = []
  for (const pluginScaffold of pluginScaffolds) {
    files.push(...buildPluginFiles(pluginScaffold))
  }

  return files
}

export function buildPluginFiles(pluginScaffold: PluginScaffold): GeneratedFile[] {
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
