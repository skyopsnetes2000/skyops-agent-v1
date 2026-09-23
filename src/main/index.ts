/**
 * SkyOps Agent V1 - Main Entrypoint
 */

import { AgentRuntime } from '../runtime/AgentRuntime.ts';
import { Logger } from '../observability/Logger.ts';

const logger = new Logger('main');

async function bootstrap() {
  logger.info('SkyOps Agent process initializing');

  const runtime = new AgentRuntime();

  // Handle graceful shutdown on OS signals
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, initiating graceful shutdown`);
    try {
      await runtime.stop();
      process.exit(0);
    } catch (err) {
      logger.error('Error during shutdown', undefined, err);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled Promise Rejection detected', undefined, reason);
  });

  process.on('uncaughtException', (err) => {
    logger.error('Uncaught Exception detected', undefined, err);
  });

  try {
    await runtime.start();
  } catch (err) {
    logger.error('Agent failed to start', undefined, err);
    process.exit(1);
  }
}

if (process.env.NODE_ENV !== 'test') {
  bootstrap().catch((err) => {
    console.error('Fatal bootstrap error:', err);
    process.exit(1);
  });
}

export { bootstrap };
