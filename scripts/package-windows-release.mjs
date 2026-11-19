import fs from 'node:fs';
import path from 'node:path';

const [commit, buildDirectory = '.next', outputDirectory = '.release-windows'] = process.argv.slice(2);
if (!/^[a-f0-9]{40}$/.test(commit ?? '') || process.platform !== 'win32') {
  throw new Error('Usage on Windows: node scripts/package-windows-release.mjs <commit> [build-directory] [output-directory]');
}
const build = path.resolve(buildDirectory);
const standalone = path.join(build, 'standalone');
const output = path.resolve(outputDirectory);
if (output === build || output.startsWith(build + path.sep)) throw new Error('Output must be outside the build directory');
fs.mkdirSync(output);
const allowed = file => !path.basename(file).startsWith('.env') &&
  path.basename(file) !== '.git' && !/\.(?:db|sqlite|sqlite3)(?:-|$)/i.test(file);
fs.cpSync(standalone, output, { recursive: true, dereference: true, filter: allowed });
const configName = path.basename(build);
fs.cpSync(path.join(build, 'static'), path.join(output, configName, 'static'), { recursive: true });
if (fs.existsSync('public')) fs.cpSync('public', path.join(output, 'public'), { recursive: true, filter: allowed });

const runtime = path.join(output, 'runtime');
fs.mkdirSync(runtime);
fs.copyFileSync(process.execPath, path.join(runtime, 'node.exe'));
const license = path.join(path.dirname(process.execPath), 'LICENSE');
if (fs.existsSync(license)) fs.copyFileSync(license, path.join(runtime, 'LICENSE'));
const engine = path.resolve('src/generated/prisma/query_engine-windows.dll.node');
for (const directory of ['src/generated/prisma', 'src/generated/prisma-base', 'node_modules/.prisma/client']) {
  fs.mkdirSync(path.join(output, directory), { recursive: true });
  fs.copyFileSync(engine, path.join(output, directory, 'query_engine-windows.dll.node'));
}
const metadata = {
  commit,
  buildId: fs.readFileSync(path.join(build, 'BUILD_ID'), 'utf8').trim(),
  buildDirectory: configName,
  runtime: process.version,
  packagedAt: new Date().toISOString(),
};
fs.writeFileSync(path.join(output, 'release.json'), JSON.stringify(metadata, null, 2));
console.log(JSON.stringify(metadata));
