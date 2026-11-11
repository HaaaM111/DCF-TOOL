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
fs.cpSync(standalone, output, { recursive: true, dereference: true, filter: file =>
  allowed(file) && path.relative(standalone, file).split(path.sep)[0] !== 'node_modules' });
// Windows may link standalone/node_modules to the complete development tree.
// Reconstruct dependencies from file traces instead of dereferencing that junction.
const dependencies = fs.realpathSync('node_modules');
function restoreTracedDependencies(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!['standalone', 'cache', 'static', 'node_modules'].includes(entry.name)) restoreTracedDependencies(filename);
    } else if (entry.name.endsWith('.nft.json')) {
      for (const traced of JSON.parse(fs.readFileSync(filename, 'utf8')).files ?? []) {
        const tracedPath = path.resolve(directory, traced);
        if (!fs.existsSync(tracedPath)) continue;
        const source = fs.realpathSync(tracedPath);
        const relative = path.relative(dependencies, source);
        if (relative.startsWith('..') || path.isAbsolute(relative) || !allowed(source)) continue;
        const destination = path.join(output, 'node_modules', relative);
        if (!fs.existsSync(destination) && fs.statSync(source).isFile()) {
          fs.mkdirSync(path.dirname(destination), { recursive: true });
          fs.copyFileSync(source, destination);
        }
      }
    }
  }
}
restoreTracedDependencies(build);
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
