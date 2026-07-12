import { loadConfig } from './config.js';
import { createHttpApp } from './httpApp.js';
import { getServerDisplayName } from './mcp/server.js';

const config = loadConfig();
const app = createHttpApp(config);

app.listen(config.port, config.host, () => {
  console.log(`${getServerDisplayName()} Streamable HTTP endpoint listening on http://${config.host}:${config.port}/mcp`);
});
