import { stdout } from 'node:process'
import type { Interface as ReadlineInterface } from 'node:readline/promises'
import type { PluginScaffold } from '../types'
import { colorize } from '../utils/colors'
import { askChoice, askPluginName } from '../utils/io'

const pluginMenuChoices = ['Route', 'Hook', 'Decorator', 'Child plugin', 'Done']

export async function runPluginScaffoldWizard(rl: ReadlineInterface): Promise<PluginScaffold[]> {
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

export function printPluginScaffoldSummary(pluginScaffolds: PluginScaffold[]): void {
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
