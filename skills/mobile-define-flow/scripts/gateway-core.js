'use strict';

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { publicElement, centerOf, ElementRefs } = require('./element-model');

const permissionForAction = {
  status: 'status',
  dump: 'dump',
  screenshot: 'screenshot',
  launch: 'app.launch.target',
  tap: 'tap',
  tapPoint: 'tap.coordinatesFallback',
  type: 'typeNonSecret',
  typeSecret: 'typeSecretFromAllowlistedEnv',
  submitSecret: 'submitSecret',
  beginManualAuth: 'beginManualAuth',
  completeManualAuth: 'completeManualAuth',
  resumeObservation: 'resumeObservation',
  swipe: 'swipe',
  longpress: 'longpress',
  longPress: 'longpress',
  back: 'button.back',
  home: 'button.home',
  wait: 'wait',
  close: 'close'
};

function loadProjectEnvironment(projectRoot) {
  const envPath = path.join(projectRoot, '.env');
  if (!fs.existsSync(envPath)) return;
  if (typeof process.loadEnvFile !== 'function') {
    throw new Error('Loading .env requires Node.js 20.12 or newer.');
  }
  process.loadEnvFile(envPath);
}

function secretNames(flowConfig) {
  const configured = flowConfig?.authentication?.secretEnvNames;
  if (Array.isArray(configured)) return configured;
  if (configured && typeof configured === 'object') return Object.values(configured);
  return [];
}

function validateFlowConfiguration(flowConfig, gatewayName) {
  if (!flowConfig || typeof flowConfig !== 'object') {
    throw new Error(`Missing define-flow configuration for ${gatewayName}.`);
  }

  const requiredStrings = [
    ['appId', flowConfig.appId],
    ['scratchRoot', flowConfig.scratchRoot],
    ['artifactRoot', flowConfig.artifactRoot]
  ];
  for (const [name, value] of requiredStrings) {
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error(`Missing required ${gatewayName} configuration: ${name}`);
    }
  }

  if (!Array.isArray(flowConfig.allowedOperations) || flowConfig.allowedOperations.length === 0) {
    throw new Error(`${gatewayName} allowedOperations must be a non-empty array.`);
  }
  if (secretNames(flowConfig).some((name) => typeof name !== 'string' || !name.trim())) {
    throw new Error(`${gatewayName} secretEnvNames must contain non-empty strings.`);
  }
}

function sanitizeError(error, environmentNames) {
  let message = error instanceof Error ? error.message : String(error);
  for (const name of environmentNames) {
    const value = process.env[name];
    if (value) message = message.split(value).join('[REDACTED]');
  }
  return message;
}

function isInside(candidate, root) {
  const comparisonCandidate = process.platform === 'win32' ? path.resolve(candidate).toLowerCase() : path.resolve(candidate);
  const comparisonRoot = process.platform === 'win32' ? path.resolve(root).toLowerCase() : path.resolve(root);
  return comparisonCandidate === comparisonRoot || comparisonCandidate.startsWith(`${comparisonRoot}${path.sep}`);
}

function createOutputResolver(projectRoot, flowConfig, gatewayName) {
  const configuredRoots = Array.isArray(flowConfig.screenshotRoots) && flowConfig.screenshotRoots.length
    ? flowConfig.screenshotRoots
    : [flowConfig.scratchRoot, flowConfig.artifactRoot];
  const allowedRoots = configuredRoots.map((root) => path.resolve(projectRoot, root));
  if (allowedRoots.some((root) => !isInside(root, projectRoot) || root === path.resolve(projectRoot))) {
    throw new Error('Screenshot roots must be subdirectories of the project.');
  }

  return (output) => {
    if (typeof output !== 'string' || !output.trim()) {
      throw new Error('Screenshot output must be a non-empty path.');
    }

    const candidate = path.isAbsolute(output) ? path.resolve(output) : path.resolve(projectRoot, output);
    if (!allowedRoots.some((root) => isInside(candidate, root))) {
      throw new Error(`Screenshots may be written only under the configured ${gatewayName} output roots.`);
    }
    if (path.extname(candidate).toLowerCase() !== '.png') {
      throw new Error('Screenshot output must use a .png extension.');
    }
    for (let current = candidate; current !== path.dirname(current); current = path.dirname(current)) {
      if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error('Screenshot paths must not traverse symbolic links or junctions.');
      if (current === path.resolve(projectRoot)) break;
    }
    return candidate;
  };
}

function parseInteger(value, name, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}.`);
  }
  return value;
}

function createGateway(options) {
  const {
    projectRoot,
    gatewayName,
    flowConfig,
    check,
    createDriver,
    platform,
    closeSession,
    assertTarget = async () => {},
    readyMetadata = async () => ({}),
    heartbeatSeconds = 0,
    extraSecretEnvironmentNames = [],
    argv = process.argv.slice(2),
    helpLines = []
  } = options;

  let driver;
  const refs = new ElementRefs();
  let dumpSequence = 0;
  let observationBlocked = false;
  let secretSubmittedAt = 0;
  let secretSubmitRefs;
  let manualAuthActive = false;
  let closing = false;
  let closePromise;
  let cleanupErrorReported = false;
  let heartbeatTimer;
  let input;
  let commandChain = Promise.resolve();
  const configuredSecretNames = secretNames(flowConfig);
  const redactedEnvironmentNames = [...new Set([...configuredSecretNames, ...extraSecretEnvironmentNames])];
  const resolveAllowedOutput = createOutputResolver(projectRoot, flowConfig, gatewayName);

  function emit(payload) {
    if (options.emit) options.emit(payload);
    else process.stdout.write(`${JSON.stringify(payload)}\n`);
  }

  function assertAllowed(action) {
    const permission = permissionForAction[action];
    if (!permission || !flowConfig.allowedOperations.includes(permission)) {
      throw new Error(`Action is not allowlisted: ${action}`);
    }
  }

  function assertObservationAllowed(action) {
    if (observationBlocked) {
      throw new Error(`${action} is blocked after secret entry. Submit the secret and obtain confirmation before resuming observation.`);
    }
  }

  function invalidateRefs() { refs.invalidate(); }
  function getFreshElement(ref) { return refs.get(ref); }

  async function clickCoordinates(x, y, holdMilliseconds = 100) {
    await driver.performActions([{
      type: 'pointer',
      id: 'finger1',
      parameters: { pointerType: 'touch' },
      actions: [
        { type: 'pointerMove', duration: 0, x, y },
        { type: 'pointerDown', button: 0 },
        { type: 'pause', duration: holdMilliseconds },
        { type: 'pointerUp', button: 0 }
      ]
    }]);
  }

  async function clickSemanticTarget(element) {
    const candidate = await platform.resolveElement(driver, element);
    if (candidate) return candidate.click();
    assertAllowed('tapPoint');
    const point = centerOf(element.bounds);
    await clickCoordinates(point.x, point.y);
  }

  async function currentPackage(source) {
    if (observationBlocked) return undefined;
    return platform.foregroundApp(driver, source);
  }

  async function getStatus(source) {
    const foregroundPackage = await currentPackage(source);
    const windowSize = await driver.getWindowSize();
    return {
      ...(foregroundPackage ? { currentPackage: foregroundPackage } : {}),
      ...(flowConfig.activity ? { configuredActivity: flowConfig.activity } : {}),
      windowSize,
      observationBlocked
    };
  }

  function closeDriver() {
    if (!closePromise) {
      closing = true;
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      closePromise = Promise.resolve().then(closeSession).finally(() => {
        driver = undefined;
        input?.close();
      });
    }
    return closePromise;
  }

  function reportCleanupFailure() {
    process.exitCode = 1;
    if (cleanupErrorReported) return;
    cleanupErrorReported = true;
    emit({ ok: false, event: 'cleanupError', code: 'CLEANUP_FAILED',
      error: 'Session cleanup failed; the provider may retain it until timeout.' });
  }

  async function shutdown() {
    try { await closeDriver(); } catch { reportCleanupFailure(); }
  }

  async function handleCommand(command) {
    if (!command || typeof command !== 'object' || Array.isArray(command)) {
      throw new Error('Each command must be a JSON object.');
    }
    const action = command.action;
    assertAllowed(action);
    if (closing && action !== 'close') throw new Error('Session is closed.');
    if (observationBlocked && !['status', 'submitSecret', 'completeManualAuth', 'resumeObservation', 'wait', 'close'].includes(action)) assertObservationAllowed(action);
    if (['type', 'swipe', 'back', 'home'].includes(action) && !refs.latest) throw new Error('Run dump immediately before this action.');

    // Check before any UI read or mutation, including coordinate/navigation variants.
    // A failed check invalidates refs so they cannot be reused after returning to the app.
    if (['dump', 'tap', 'tapPoint', 'type', 'swipe', 'longpress', 'longPress', 'back', 'home'].includes(action)) {
      try { await assertTarget(driver); } catch (error) { invalidateRefs(); throw error; }
    }

    switch (action) {
      case 'status':
        return { ok: true, event: 'status', ...(await getStatus()) };

      case 'dump': {
        assertObservationAllowed('dump');
        invalidateRefs();
        const source = await driver.getPageSource();
        const parsed = platform.normalizeSource(source);
        const maximum = Number.isInteger(flowConfig.maxDumpElements) ? flowConfig.maxDumpElements : 300;
        const visible = refs.replace(parsed.slice(0, maximum));
        dumpSequence += 1;
        return {
          ok: true,
          event: 'dump',
          sequence: dumpSequence,
          screen: await getStatus(source),
          elements: visible.map(publicElement),
          truncated: parsed.length > visible.length
        };
      }

      case 'screenshot': {
        assertObservationAllowed('screenshot');
        await assertTarget(driver);
        const output = resolveAllowedOutput(command.output);
        fs.mkdirSync(path.dirname(output), { recursive: true });
        await driver.saveScreenshot(output);
        return { ok: true, event: 'screenshot', output: path.relative(projectRoot, output) };
      }

      case 'launch':
        assertObservationAllowed('launch');
        invalidateRefs();
        await driver.activateApp(flowConfig.appId);
        return { ok: true, event: 'action', action: 'launch', appId: flowConfig.appId };

      case 'tap': {
        assertObservationAllowed('tap');
        const element = getFreshElement(command.target);
        invalidateRefs();
        await clickSemanticTarget(element);
        return { ok: true, event: 'action', action: 'tap', target: command.target };
      }

      case 'tapPoint': {
        assertObservationAllowed('tapPoint');
        if (!refs.latest) throw new Error('Run dump immediately before using the coordinate fallback.');
        if (command.reason !== 'noAccessibleElement') {
          throw new Error('tapPoint requires reason=noAccessibleElement.');
        }
        const size = await driver.getWindowSize();
        const point = command.point || {};
        const x = parseInteger(point.x, 'point.x', 0, size.width);
        const y = parseInteger(point.y, 'point.y', 0, size.height);
        invalidateRefs();
        await clickCoordinates(x, y);
        return { ok: true, event: 'action', action: 'tapPoint' };
      }

      case 'type': {
        assertObservationAllowed('type');
        if (typeof command.text !== 'string' || !command.text.length || command.text.length > 500) {
          throw new Error('Non-secret text must contain 1 to 500 characters.');
        }
        const configuredSecrets = configuredSecretNames.map((name) => process.env[name]).filter(Boolean);
        if (configuredSecrets.some((secret) => command.text.includes(secret))) {
          throw new Error('A configured secret cannot be sent through type. Use typeSecret with its environment name.');
        }
        invalidateRefs();
        await driver.keys(command.text);
        return { ok: true, event: 'action', action: 'type', characterCount: command.text.length };
      }

      case 'beginManualAuth': {
        assertObservationAllowed('beginManualAuth');
        if (!['manual', 'savedTestAccount'].includes(flowConfig.authentication?.allowedMode)) {
          throw new Error('Manual authentication is disabled.');
        }
        if (command.confirmAuth !== true) throw new Error('beginManualAuth requires confirmAuth=true from the user.');
        if (!refs.latest) throw new Error('Take a safe dump before beginning manual authentication.');
        await assertTarget(driver);
        // Block before handing control to the user; no secret is passed to the gateway.
        observationBlocked = true;
        manualAuthActive = true;
        secretSubmittedAt = 0;
        secretSubmitRefs = undefined;
        invalidateRefs();
        return { ok: true, event: 'manualAuthStarted', observationBlocked: true };
      }

      case 'completeManualAuth': {
        if (!manualAuthActive || !observationBlocked) throw new Error('No manual authentication is active.');
        if (secretSubmittedAt) throw new Error('Manual submission was already confirmed; wait and resume observation.');
        if (command.confirmAuth !== true || command.confirmSubmitted !== true) {
          throw new Error('completeManualAuth requires confirmAuth=true and confirmSubmitted=true from the user.');
        }
        await assertTarget(driver);
        secretSubmittedAt = Date.now();
        return { ok: true, event: 'manualAuthCompleted', observationBlocked: true };
      }

      case 'typeSecret': {
        assertObservationAllowed('typeSecret');
        if (flowConfig.authentication?.allowedMode !== 'savedTestAccount') throw new Error('Saved test account authentication is disabled.');
        if (command.confirmAuth !== true) {
          throw new Error('typeSecret requires confirmAuth=true for this authentication run.');
        }
        if (!refs.latest) {
          throw new Error('Run a safe dump after focusing the empty secret field and before typeSecret.');
        }
        if (!configuredSecretNames.includes(command.secretName)) {
          throw new Error('Secret name is not allowlisted.');
        }
        const secret = process.env[command.secretName];
        if (!secret) throw new Error(`Missing allowlisted environment value: ${command.secretName}`);
        await assertTarget(driver);
        const foregroundPackage = await currentPackage();
        if (foregroundPackage !== flowConfig.appId) {
          throw new Error(`Secret entry is allowed only while ${flowConfig.appId} is foreground.`);
        }
        secretSubmitRefs = refs.latest;
        invalidateRefs();
        observationBlocked = true;
        try { await driver.keys(secret); } catch { throw new Error('Secret entry failed; observation remains blocked. Close the session or use the authorized submission path.'); }
        secretSubmittedAt = command.secretName === flowConfig.authentication?.otpSecretName ? Date.now() : 0;
        return { ok: true, event: 'secretTyped', secretName: command.secretName, observationBlocked: true };
      }

      case 'submitSecret': {
        if (!observationBlocked || manualAuthActive) throw new Error('submitSecret is available only after typeSecret.');
        if (command.confirmAuth !== true) {
          throw new Error('submitSecret requires confirmAuth=true for this authentication run.');
        }
        await assertTarget(driver);
        if (command.target === 'ENTER') {
          await driver.keys('\uE007');
        } else {
          const target = secretSubmitRefs?.get(command.target);
          if (!target || !target.enabled) throw new Error('Secret submit requires an enabled target from the last safe dump.');
          secretSubmitRefs = undefined;
          await clickSemanticTarget(target);
        }
        secretSubmitRefs = undefined;
        invalidateRefs();
        secretSubmittedAt = Date.now();
        return { ok: true, event: 'secretSubmitted', observationBlocked: true };
      }

      case 'resumeObservation':
        if (!observationBlocked) throw new Error('Observation is not currently blocked.');
        if (command.confirmSecretScreenCleared !== true) {
          throw new Error('resumeObservation requires confirmSecretScreenCleared=true from the user.');
        }
        if (!secretSubmittedAt || Date.now() - secretSubmittedAt < 2000) {
          throw new Error('Wait for the secret submission to navigate before resuming observation.');
        }
        await assertTarget(driver);
        observationBlocked = false;
        manualAuthActive = false;
        secretSubmitRefs = undefined;
        invalidateRefs();
        secretSubmittedAt = 0;
        return { ok: true, event: 'observationResumed' };

      case 'swipe': {
        assertObservationAllowed('swipe');
        const size = await driver.getWindowSize();
        const from = command.from || {};
        const to = command.to || {};
        const x1 = parseInteger(from.x, 'from.x', 0, size.width);
        const y1 = parseInteger(from.y, 'from.y', 0, size.height);
        const x2 = parseInteger(to.x, 'to.x', 0, size.width);
        const y2 = parseInteger(to.y, 'to.y', 0, size.height);
        const duration = parseInteger(command.duration ?? 600, 'duration', 100, 5000);
        invalidateRefs();
        await driver.performActions([{
          type: 'pointer',
          id: 'finger1',
          parameters: { pointerType: 'touch' },
          actions: [
            { type: 'pointerMove', duration: 0, x: x1, y: y1 },
            { type: 'pointerDown', button: 0 },
            { type: 'pause', duration: 100 },
            { type: 'pointerMove', duration, x: x2, y: y2 },
            { type: 'pointerUp', button: 0 }
          ]
        }]);
        return { ok: true, event: 'action', action: 'swipe' };
      }

      case 'longPress':
      case 'longpress': {
        assertObservationAllowed('longpress');
        const element = getFreshElement(command.target);
        const point = centerOf(element.bounds);
        const duration = parseInteger(command.duration ?? 1000, 'duration', 500, 5000);
        invalidateRefs();
        await clickCoordinates(point.x, point.y, duration);
        return { ok: true, event: 'action', action: 'longpress', target: command.target };
      }

      case 'back':
        assertObservationAllowed('back');
        invalidateRefs();
        await platform.back(driver);
        return { ok: true, event: 'action', action: 'back' };

      case 'home':
        assertObservationAllowed('home');
        invalidateRefs();
        await platform.home(driver);
        return { ok: true, event: 'action', action: 'home' };

      case 'wait': {
        const milliseconds = parseInteger(command.milliseconds ?? 1000, 'milliseconds', 100, 10000);
        await driver.pause(milliseconds);
        invalidateRefs();
        return { ok: true, event: 'wait', milliseconds };
      }

      case 'close':
        await closeDriver();
        return { ok: true, event: 'closed' };

      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }

  function enqueue(operation) {
    commandChain = commandChain.then(operation, operation);
    return commandChain;
  }

  function startHeartbeat() {
    if (!Number.isInteger(heartbeatSeconds) || heartbeatSeconds <= 0) return;
    heartbeatTimer = setInterval(() => {
      enqueue(async () => {
        if (!closing && driver) {
          try {
            await driver.getWindowSize();
          } catch (error) {
            process.exitCode = 1;
            emit({ ok: false, event: 'heartbeatError', error: 'Session heartbeat failed. The flow is incomplete; closing this session.' });
            await shutdown();
          }
        }
      }).catch(reportCleanupFailure);
    }, heartbeatSeconds * 1000);
  }

  function printHelp() {
    process.stdout.write(
      `Usage: node session.js [--check]\n\n` +
      `  --check  Validate dependencies, configuration, and target availability without opening an Appium session.\n` +
      `  default  Start one persistent ${gatewayName} Appium session and accept JSON-line commands on stdin.\n` +
      helpLines.map((line) => `  ${line}\n`).join('')
    );
  }

  async function runCheck() {
    validateFlowConfiguration(flowConfig, gatewayName);
    for (const rootName of [flowConfig.scratchRoot, flowConfig.artifactRoot]) {
      resolveAllowedOutput(path.join(rootName, 'probe.png'));
    }
    const details = await check();
    emit({
      ok: true,
      event: 'preflight',
      gateway: gatewayName,
      client: 'WebdriverIO',
      automationServer: 'Appium',
      driver: platform.automationName,
      allowedSecretNames: configuredSecretNames,
      ...details
    });
  }

  async function startSession() {
    validateFlowConfiguration(flowConfig, gatewayName);
    driver = await createDriver();
    const sessionMetadata = await readyMetadata(driver);
    startHeartbeat();
    emit({
      ok: true,
      event: 'ready',
      gateway: gatewayName,
      client: 'WebdriverIO',
      automationServer: 'Appium',
      driver: platform.automationName,
      appId: flowConfig.appId,
      ...sessionMetadata
    });

    if (options.interactive === false) return;
    input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity, terminal: false });
    input.on('line', (line) => {
      enqueue(async () => {
        if (!line.trim() || closing) return;
        try {
          let command;
          try { command = JSON.parse(line); }
          catch { throw Object.assign(new Error('Command must be valid JSON.'), { code: 'INVALID_COMMAND' }); }
          const response = await handleCommand(command);
          emit(response);
          if (command.action === 'close') {
            input.close();
            process.exitCode = process.exitCode || 0;
          }
        } catch (error) {
          if (closing) reportCleanupFailure();
          else emit({ ok: false, event: 'commandError', code: error.code || 'COMMAND_FAILED', error: observationBlocked ? 'Command failed while observation is blocked; secret screen protection remains active.' : sanitizeError(error, redactedEnvironmentNames) });
        }
      });
    });
    input.on('close', () => enqueue(shutdown).catch(reportCleanupFailure));
  }

  async function main() {
    const [argument, ...remaining] = argv;
    if (argument === '--help' || argument === '-h') {
      printHelp();
      return;
    }
    if (argument === '--check') {
      if (remaining.length) throw new Error(`Unknown argument: ${remaining[0]}`);
      await runCheck();
      return;
    }
    if (argument) throw new Error(`Unknown argument: ${argument}`);
    await startSession();
  }

  return { handleCommand, start: main, close: closeDriver, enqueue, shutdown };
}

function runGateway(options) {
  const gateway = createGateway(options);
  const redact = [...secretNames(options.flowConfig), ...(options.extraSecretEnvironmentNames || [])];
  for (const signal of ['SIGINT', 'SIGTERM']) {
    const handler = () => gateway.enqueue(async () => {
      await gateway.shutdown();
      process.exit(process.exitCode || 0);
    });
    process.once(signal, handler);
  }
  // Signals arriving during connection creation queue behind startup, so a late session
  // cannot escape its owner's cleanup.
  return gateway.enqueue(() => gateway.start()).catch(async (error) => {
    await gateway.shutdown();
    process.stdout.write(`${JSON.stringify({ ok: false, event: 'fatal', code: error.code || 'STARTUP_FAILED', error: sanitizeError(error, redact) })}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  createOutputResolver,
  loadProjectEnvironment,
  createGateway,
  runGateway,
  secretNames,
  validateFlowConfiguration
};
