import fs from 'node:fs'
import path from 'node:path'
import { stderr, exit } from 'node:process'
import { colorize } from './colors'

export function fail(message: string): never {
  stderr.write(`${colorize('Error:', 'red')} ${message}\n`)
  exit(1)
}

export function validateNewProjectTarget(targetDir: string): void {
  if (targetDir === '.') {
    fail('Current directory generation is disabled in MVP. Use a new directory name.')
  }

  const absoluteTarget = path.resolve(process.cwd(), targetDir)
  if (fs.existsSync(absoluteTarget)) {
    fail('Target directory already exists. Please choose a new directory.')
  }
}

export function ensureNoDuplicateFilePaths(filePaths: string[]): void {
  const seen = new Set<string>()
  for (const filePath of filePaths) {
    if (seen.has(filePath)) {
      fail(`Duplicate generated file detected: ${filePath}`)
    }
    seen.add(filePath)
  }
}
