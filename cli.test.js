'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const { spawn } = require('child_process')
const fs = require('node:fs')
const path = require('node:path')

const CLI_PATH = path.join(__dirname, 'cli.js')

/**
 * Helper to run the CLI and feed it stdin inputs sequentially.
 * Each input is sent only after the CLI has printed its next prompt (a line ending with '> ').
 */
function runCli(args, inputs = []) {
  return new Promise((resolve, reject) => {
    const cp = spawn(process.execPath, [CLI_PATH, ...args], {
      cwd: __dirname,
      env: { ...process.env, NO_COLOR: '1' }
    })

    let output = ''
    let errorOutput = ''
    let inputIndex = 0

    cp.stdout.on('data', (chunk) => {
      output += chunk.toString()

      // The CLI prompt always ends with 'Select an option: ' or a field label like 'Port: '
      if (inputIndex < inputs.length && output.endsWith(': ')) {
        const next = inputs[inputIndex++]
        cp.stdin.write(next + '\n')

        if (inputIndex >= inputs.length) {
          cp.stdin.end()
        }
      }
    })

    cp.stderr.on('data', (chunk) => {
      errorOutput += chunk.toString()
    })

    cp.on('close', (code) => {
      resolve({ code, output, errorOutput })
    })

    cp.on('error', reject)

    // Safety timeout to avoid hanging tests
    setTimeout(() => {
      cp.kill()
      reject(new Error(`CLI timed out.\nOutput so far:\n${output}\nInputs sent: ${inputIndex}/${inputs.length}`))
    }, 10000)
  })
}

test('CLI generates project with default setup and writes files', async () => {
  const targetDir = path.join(__dirname, '.tmp-test-default')

  if (fs.existsSync(targetDir)) {
    fs.rmSync(targetDir, { recursive: true, force: true })
  }

  // Inputs:
  // '1' -> Default setup (quick start)
  // '1' -> Run
  const { code, output } = await runCli(['generate', '.tmp-test-default'], ['1', '1'])

  assert.strictEqual(code, 0, 'CLI should exit with code 0')
  assert.match(output, /Project created in/, 'Output should confirm project creation')

  assert.ok(fs.existsSync(targetDir), 'Target directory should exist')
  assert.ok(fs.existsSync(path.join(targetDir, 'package.json')), 'package.json should be generated')
  assert.ok(fs.existsSync(path.join(targetDir, 'app.js')), 'app.js should be generated')
  assert.ok(fs.existsSync(path.join(targetDir, 'routes', 'root.js')), 'routes/root.js should be generated')

  fs.rmSync(targetDir, { recursive: true, force: true })
})

test('CLI prompts for all categories in guided setup', async () => {
  const targetDir = path.join(__dirname, '.tmp-test-guided')

  if (fs.existsSync(targetDir)) {
    fs.rmSync(targetDir, { recursive: true, force: true })
  }

  // Inputs:
  // '2' -> Guided setup
  // '1' x6 -> Skip each of the 6 categories
  // '2' -> Cancel
  const inputs = ['2', '1', '1', '1', '1', '1', '1', '2']
  const { code, output } = await runCli(['generate', '.tmp-test-guided'], inputs)

  assert.strictEqual(code, 0, 'CLI should exit with code 0')

  assert.match(output, /Network: choose how to continue/, 'Should prompt for Network category')
  assert.match(output, /Logging: choose how to continue/, 'Should prompt for Logging category')
  assert.match(output, /Debug: choose how to continue/, 'Should prompt for Debug category')
  assert.match(output, /Watch Mode: choose how to continue/, 'Should prompt for Watch Mode category')
  assert.match(output, /Safety and Limits: choose how to continue/, 'Should prompt for Safety and Limits category')
  assert.match(output, /Trust Proxy: choose how to continue/, 'Should prompt for Trust Proxy category')

  assert.match(output, /Cancelled\. No files were written\./, 'Output should confirm cancellation')
  assert.strictEqual(fs.existsSync(targetDir), false, 'Target directory should not be created when cancelled')
})

test('CLI applies custom configurations for Network, Logging, and Debug categories', async () => {
  const targetDir = path.join(__dirname, '.tmp-test-custom')

  if (fs.existsSync(targetDir)) {
    fs.rmSync(targetDir, { recursive: true, force: true })
  }

  const inputs = [
    '2',         // Guided setup
    '2',         // Configure Network
    '8080',      // Port
    '0.0.0.0',   // Address
    '',          // Socket (empty = keep default)
    '/api',      // Prefix
    '2',         // Configure Logging
    '4',         // Log level -> 'info'
    '2',         // Pretty logs -> Yes
    '2',         // Configure Debug
    '2',         // Enable debug inspector -> Yes
    '9229',      // Debug port
    'localhost', // Debug host
    '1',         // Skip Watch Mode
    '1',         // Skip Safety and Limits
    '1',         // Skip Trust Proxy
    '1'          // Run
  ]

  const { code, output } = await runCli(['generate', '.tmp-test-custom'], inputs)

  assert.strictEqual(code, 0, 'CLI should exit with code 0')

  assert.match(output, /- port: 8080/, 'Summary should reflect custom port')
  assert.match(output, /- address: 0\.0\.0\.0/, 'Summary should reflect custom address')
  assert.match(output, /- prefix: \/api/, 'Summary should reflect custom prefix')
  assert.match(output, /- logLevel: info/, 'Summary should reflect custom log level')
  assert.match(output, /- prettyLogs: true/, 'Summary should reflect custom pretty logs')
  assert.match(output, /- debug: true/, 'Summary should reflect custom debug flag')
  assert.match(output, /- debugPort: 9229/, 'Summary should reflect custom debug port')
  assert.match(output, /- debugHost: localhost/, 'Summary should reflect custom debug host')

  const envPath = path.join(targetDir, '.env')
  assert.ok(fs.existsSync(envPath), '.env file should be generated')

  const envContent = fs.readFileSync(envPath, 'utf8')
  assert.match(envContent, /PORT=8080/, '.env should contain PORT=8080')
  assert.match(envContent, /ADDRESS=0\.0\.0\.0/, '.env should contain ADDRESS=0.0.0.0')
  assert.match(envContent, /LOG_LEVEL=info/, '.env should contain LOG_LEVEL=info')

  fs.rmSync(targetDir, { recursive: true, force: true })
})