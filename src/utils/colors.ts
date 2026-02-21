import { stdout, stderr } from 'node:process'

export const useColor = stdout.isTTY && stderr.isTTY && process.env.NO_COLOR === undefined

const colors: Record<string, string> = {
  reset: '\x1b[0m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  bold: '\x1b[1m',
  gray: '\x1b[90m'
}

export function colorize(text: string, tone: string): string {
  if (!useColor) {
    return text
  }
  return `${colors[tone]}${text}${colors.reset}`
}
