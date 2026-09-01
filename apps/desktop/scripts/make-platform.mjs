import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'

const [major, minor] = process.versions.node.split('.').map(Number)
if (major < 22 || (major === 22 && minor < 12) || major > 24) {
  process.stderr.write('Concord release packaging requires Node.js 22.12 through 24.x (24 LTS recommended).\n')
  process.exit(1)
}

const targetPlatform = process.argv[2] ?? process.platform
if (targetPlatform !== 'win32' && targetPlatform !== 'linux') {
  process.stderr.write(`Unsupported release platform: ${targetPlatform}\n`)
  process.exit(1)
}
if (targetPlatform !== process.platform) {
  process.stderr.write(`Build ${targetPlatform} artifacts on a ${targetPlatform} host.\n`)
  process.exit(1)
}

const require = createRequire(import.meta.url)
const forgeCli = require.resolve('@electron-forge/cli/dist/electron-forge.js')
const builderCli = require.resolve('electron-builder/cli.js')
const workingDirectory = path.resolve(import.meta.dirname, '..')
const packageJson = JSON.parse(readFileSync(path.join(workingDirectory, 'package.json'), 'utf8'))
const version = packageJson.version
const arch = 'x64'
const packageDirectory = path.join(workingDirectory, `out/Concord-${targetPlatform}-${arch}`)
const updateConfigPath = path.join(packageDirectory, 'resources/app-update.yml')
const zipArtifact = path.join(
  workingDirectory,
  `out/make/zip/${targetPlatform}/${arch}/Concord-${targetPlatform}-${arch}-${version}.zip`,
)
const builderDirectory = path.join(workingDirectory, 'out/make/builder')
const releaseDirectory = path.join(workingDirectory, `out/release-assets/${targetPlatform}`)
const builderArtifacts = targetPlatform === 'win32'
  ? [
      path.join(builderDirectory, `Concord-Setup-${version}-${arch}.exe`),
      path.join(builderDirectory, `Concord-Setup-${version}-${arch}.exe.blockmap`),
      path.join(builderDirectory, 'latest.yml'),
    ]
  : [
      path.join(builderDirectory, `Concord-${version}-linux-x86_64.AppImage`),
      path.join(builderDirectory, 'latest-linux.yml'),
    ]

rmSync(packageDirectory, { recursive: true, force: true })
rmSync(zipArtifact, { force: true })
rmSync(path.join(workingDirectory, 'out/make/squirrel.windows'), { recursive: true, force: true })
for (const artifact of builderArtifacts) rmSync(artifact, { force: true })

const buildStartedAt = Date.now()
run(forgeCli, ['make', `--platform=${targetPlatform}`, `--arch=${arch}`])
writeFileSync(updateConfigPath, [
  'provider: github',
  'owner: Jovem-Blood',
  'repo: Concord',
  'updaterCacheDirName: concord-updater',
  '',
].join('\n'))
run(builderCli, [
  '--config=electron-builder.yml',
  '--prepackaged', packageDirectory,
  targetPlatform === 'win32' ? '--win' : '--linux',
  targetPlatform === 'win32' ? 'nsis' : 'AppImage',
  `--${arch}`,
  '--publish=never',
])

const artifacts = [zipArtifact, ...builderArtifacts]
const staleArtifact = artifacts.find((artifact) => {
  try {
    return statSync(artifact).mtimeMs < buildStartedAt - 2_000
  } catch {
    return true
  }
})
if (staleArtifact) {
  process.stderr.write(`Release build did not create a fresh artifact: ${staleArtifact}\n`)
  process.exit(1)
}

rmSync(releaseDirectory, { recursive: true, force: true })
mkdirSync(releaseDirectory, { recursive: true })
for (const artifact of artifacts) {
  copyFileSync(artifact, path.join(releaseDirectory, path.basename(artifact)))
}

process.stdout.write(`Release artifacts created:\n${artifacts.map((artifact) => `- ${artifact}`).join('\n')}\n`)

function run(cli, args) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: workingDirectory,
    env: process.env,
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
