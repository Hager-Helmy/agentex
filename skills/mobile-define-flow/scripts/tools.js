'use strict';

const { loadProjectEnvironment } = require('./gateway-core');
const { loadConfig } = require('./config');
const { compose } = require('./registry');
const { parseArguments } = require('./cli');
const { smoke } = require('./smoke');

async function main(argv = process.argv.slice(2)) {
  const [command, ...args] = argv;
  if (!['devices', 'upload', 'smoke'].includes(command)) throw new Error('Usage: tools.js devices|upload|smoke [--platform android|ios] [--config path]');
  const options = parseArguments(args);
  if (options.noLaunch || options.gatewayArguments.length) throw new Error('Device/upload/smoke tools accept only --platform and --config.');
  const projectRoot = process.cwd();
  loadProjectEnvironment(projectRoot);
  const config = loadConfig(projectRoot, options);
  const { provider, platform } = compose(config);
  const context = { config, platform, projectRoot };
  if (command === 'devices') {
    await provider.devices(context);
    console.log(JSON.stringify({ ok: true, event: 'deviceAvailable', provider: 'browserstack', platform: config.platform,
      deviceName: config.device.name, osVersion: config.device.osVersion, availability: 'catalog-match' }));
  } else if (command === 'upload') console.log(JSON.stringify(await provider.upload(context)));
  else await smoke(options);
}
if (require.main === module) main().catch(() => {
  console.error('BrowserStack operation failed. Check the selected platform, configuration, app archive and credentials.');
  process.exitCode = 1;
});
module.exports = { main };
