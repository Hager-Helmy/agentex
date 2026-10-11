'use strict';

const { loadProjectEnvironment, createGateway } = require('./gateway-core');
const { loadConfig, flowConfiguration } = require('./config');
const { compose } = require('./registry');
const { SessionManager } = require('./session-manager');

// Existing smoke commands exercise the same owner/capability pipeline, with no duplicate payload.
async function smoke(options = {}) {
  const projectRoot = process.cwd();
  loadProjectEnvironment(projectRoot);
  const config = loadConfig(projectRoot, options);
  const { provider, platform } = compose(config);
  const manager = new SessionManager({ config, provider, platform, projectRoot });
  const gateway = createGateway({ projectRoot, gatewayName: 'Mobile Define Flow smoke', platform,
    flowConfig: flowConfiguration(config, platform), argv: [], interactive: false,
    check: () => manager.check(), createDriver: () => manager.create(), readyMetadata: () => manager.metadata(),
    closeSession: () => manager.close(), assertTarget: (driver) => manager.assertTarget(driver) });
  try {
    await gateway.start();
    await gateway.handleCommand({ action: 'wait', milliseconds: 3000 });
    const output = `${config.paths.artifactRoot}/smoke-${Date.now()}.png`;
    console.log(JSON.stringify(await gateway.handleCommand({ action: 'screenshot', output })));
  } finally { await gateway.close(); }
}
module.exports = { smoke };
