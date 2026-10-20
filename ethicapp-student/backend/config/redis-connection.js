/**
 * Drops a connection that stopped answering while still open and opens a new
 * one. node-redis rejects every queued and in-flight command on disconnect, so
 * the operations the caller gave up on are released instead of waiting
 * for Redis indefinitely. Commands already transmitted may still be applied if
 * Redis resumes; callers must tolerate late execution even after the client
 * releases its work.
 *
 * While the new connection is not ready, `disableOfflineQueue` rejects
 * commands immediately, so nothing accumulates during the reconnection.
 * @param {import('redis').RedisClientType} client
 * @param {Console} logger
 * @param {string} label Log prefix identifying the connection's owner.
 * @returns {() => Promise<void>}
 */
export function createConnectionResetter(client, logger, label) {
  let resetting = false;

  return async function resetConnection() {
    // Only a ready connection can hold commands that stalled; a client that is
    // already reconnecting rejects commands without queueing them.
    if (resetting || !client.isReady) {
      return;
    }

    resetting = true;
    logger.error(`[${label}] Redis stopped answering; resetting the connection.`);
    try {
      await client.disconnect();
    } catch (error) {
      logger.error(`[${label}] Redis disconnect failed:`, error.message);
    } finally {
      resetting = false;
    }

    client.connect().catch((error) => {
      logger.error(`[${label}] Redis reconnection failed:`, error.message);
    });
  };
}
