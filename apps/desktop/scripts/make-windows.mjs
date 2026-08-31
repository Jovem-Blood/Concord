import { spawnSync } from 'node:child_process'
import { copyFileSync, readFileSync, rmSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'

const [major, minor] = process.versions.node.split('.').map(Number)
if (major < 22 || (major === 22 && minor < 12)) {
  process.stderr.write('Concord requires Node.js 22.12 or newer to package Electron 44.\n')
  process.exit(1)
}

const require = createRequire(import.meta.url)
const forgeCli = require.resolve('@electron-forge/cli/dist/electron-forge.js')
const squirrelVendor = path.join(
  path.dirname(require.resolve('electron-winstaller/package.json')),
  'vendor',
)

const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === 'path') ?? 'PATH'
const environment = {
  ...process.env,
  [pathKey]: `${squirrelVendor}${path.delimiter}${process.env[pathKey] ?? ''}`,
}

const workingDirectory = path.resolve(import.meta.dirname, '..')
const localSevenZipFiles = ['7z.exe', '7z.dll'].map((fileName) => ({
  source: path.join(squirrelVendor, fileName),
  target: path.join(workingDirectory, fileName),
}))
for (const file of localSevenZipFiles) copyFileSync(file.source, file.target)

let result
const buildStartedAt = Date.now()
try {
  result = spawnSync(
    process.execPath,
    [forgeCli, 'make', '--platform=win32', '--arch=x64'],
    { cwd: workingDirectory, env: environment, stdio: 'inherit' },
  )
} finally {
  for (const file of localSevenZipFiles) rmSync(file.target, { force: true })
}

if (result.error) throw result.error
if (result.status === 0) {
  const { version } = JSON.parse(readFileSync(path.join(workingDirectory, 'package.json'), 'utf8'))
  const artifacts = [
    path.join(workingDirectory, 'out/make/squirrel.windows/x64/Concord-Setup.exe'),
    path.join(workingDirectory, `out/make/zip/win32/x64/Concord-win32-x64-${version}.zip`),
  ]
  const freshArtifacts = artifacts.every((artifact) => {
    try { return statSync(artifact).mtimeMs >= buildStartedAt - 2_000 } catch { return false }
  })
  if (!freshArtifacts) {
    process.stderr.write('Forge exited without creating fresh Windows artifacts. Retry with Node.js 24 LTS.\n')
    process.exit(1)
  }
}
process.exit(result.status ?? 1)
