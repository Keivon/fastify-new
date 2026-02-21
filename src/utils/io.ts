import { stdout } from 'node:process'
import type { Interface as ReadlineInterface } from 'node:readline/promises'
import { colorize } from './colors'

export async function askChoice(rl: ReadlineInterface, message: string, options: string[]): Promise<string> {
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

export async function askInput(
  rl: ReadlineInterface,
  label: string,
  defaultValue: string | number | boolean | undefined
): Promise<string> {
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

export async function askPluginName(rl: ReadlineInterface, label: string): Promise<string> {
  while (true) {
    const name = await askInput(rl, label, undefined)
    if (/^[a-z][a-z0-9-]*$/.test(name)) {
      return name
    }
    stdout.write(`${colorize('Use lowercase letters, numbers, and dashes only; must start with a letter.', 'yellow')}\n`)
  }
}
