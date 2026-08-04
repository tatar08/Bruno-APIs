const { spawn } = require('child_process');

function run(command, args) {
  return new Promise((resolve, reject) => {
    const isNpmCommand = command === 'npm';
    const executable = isNpmCommand ? process.execPath : command;
    const commandArgs = isNpmCommand ? [process.env.npm_execpath, ...args] : args;
    const child = spawn(executable, commandArgs, { stdio: 'inherit' });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} exited with code ${code}.`));
    });
  });
}

async function main() {
  await run('npm', ['run', 'build:web']);
  await run('node', ['./scripts/build-electron.js']);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});