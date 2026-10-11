'use strict';

const { loadConfig, flowConfiguration } = require('./config');
const { compose } = require('./registry');
const { SessionManager } = require('./session-manager');
const { loadProjectEnvironment, runGateway, validateFlowConfiguration } = require('./gateway-core');

function parseArguments(argv) {
  const options = { gatewayArguments: [] };
  const values = { '--platform': 'platform', '--config': 'configPath' };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (Object.hasOwn(values, argument)) {
      const value = argv[++index];
      if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value.`);
      options[values[argument]] = value;
    } else if (argument === '--no-launch') options.noLaunch = true;
    else if (['--check', '--help', '-h', '--validate-config'].includes(argument)) options.gatewayArguments.push(argument);
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (options.gatewayArguments.length > 1) throw new Error('Choose one of --check, --validate-config or --help.');
  return options;
}

async function main(argv = process.argv.slice(2), defaults = {}) {
  const projectRoot = process.cwd();
  const options = { ...defaults, ...parseArguments(argv) };
  loadProjectEnvironment(projectRoot);
  const config = loadConfig(projectRoot, options);
  const { provider, platform } = compose(config);
  validateFlowConfiguration(flowConfiguration(config, platform), 'Mobile Define Flow');
  if (options.gatewayArguments.includes('--validate-config')) {
    process.stdout.write(`${JSON.stringify({ ok: true, event: 'configurationValid', provider: config.provider, platform: config.platform })}\n`);
    return;
  }
  const manager = new SessionManager({ config, provider, platform, projectRoot, noLaunch: options.noLaunch });
  return runGateway({ projectRoot, gatewayName: 'BrowserStack Mobile Define Flow', platform,
    flowConfig: flowConfiguration(config, platform), argv: options.gatewayArguments,
    heartbeatSeconds: config.runtime.heartbeatSeconds,
    extraSecretEnvironmentNames: provider.secretEnvironmentNames?.(config) || [],
    check: () => manager.check(), createDriver: () => manager.create(),
    readyMetadata: () => manager.metadata(), closeSession: () => manager.close(),
    assertTarget: (driver) => manager.assertTarget(driver),
    helpLines: ['--platform android|ios  Select the mobile platform.', '--config <path>  Load logical configuration.',
      '--no-launch  Skip target activation in the newly allocated remote session.',
      '--validate-config  Validate configuration without device/network access.'] });
}

function launch(argv, defaults) {
  main(argv, defaults).catch((error) => {
    process.stdout.write(`${JSON.stringify({ ok: false, event: 'fatal', code: error.code || 'CONFIGURATION_FAILED',
      error: 'Configuration or environment initialization failed. Check BrowserStack settings, platform, app identity and required paths.' })}\n`);
    process.exitCode = 1;
  });
}
if (require.main === module) launch();
module.exports = { launch, main, parseArguments };
