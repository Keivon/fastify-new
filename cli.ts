#!/usr/bin/env node

import readline from 'node:readline/promises'
import { stdin, stdout, exit } from 'node:process'
import { colorize } from './src/utils/colors'
import { validateNewProjectTarget, fail } from './src/utils/validation'
import { askChoice } from './src/utils/io'
import { runSetupFlow } from './src/prompts/setup'
import { runPluginScaffoldWizard, printPluginScaffoldSummary } from './src/prompts/plugin-wizard'
import { generateProject } from './src/generator/project-generator'

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

function printHelp(): void {
  stdout.write(`${colorize('Usage:', 'cyan')}\n`)
  stdout.write(`  ${colorize('fastify-new <new-directory>', 'bold')}\n`)
  stdout.write('\n')
  stdout.write(`${colorize('MVP rules:', 'cyan')}\n`)
  stdout.write(`- ${colorize('setup option flags are disabled', 'gray')}\n`)
  stdout.write(`- ${colorize('target must be a new directory', 'gray')}\n`)
}

main().catch((err: unknown) => {
  fail(err instanceof Error ? err.message : 'Unexpected error')
})
