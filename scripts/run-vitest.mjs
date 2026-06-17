import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const vitestBin = resolve(repoRoot, 'node_modules', 'vitest', 'vitest.mjs')

if (!existsSync(vitestBin)) {
  console.error('Vitest binary not found. Run npm install before running tests.')
  process.exit(1)
}

function hasFlag(args, name) {
  return args.some((arg) => arg === name || arg.startsWith(`${name}=`))
}

const forwardedArgs = process.argv.slice(2)
const defaultArgs = []

if (!hasFlag(forwardedArgs, '--pool')) {
  defaultArgs.push('--pool=forks')
}
if (!hasFlag(forwardedArgs, '--maxWorkers')) {
  defaultArgs.push('--maxWorkers=2')
}
if (!hasFlag(forwardedArgs, '--reporter')) {
  defaultArgs.push('--reporter=dot')
}

const child = spawn(process.execPath, [vitestBin, 'run', ...defaultArgs, ...forwardedArgs], {
  cwd: repoRoot,
  env: {
    ...process.env,
    CI: process.env.CI ?? 'true',
  },
  stdio: 'inherit',
})

child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`Vitest terminated by signal ${signal}.`)
    process.exit(1)
  }
  process.exit(code ?? 1)
})

child.on('error', (error) => {
  console.error(error.message)
  process.exit(1)
})
