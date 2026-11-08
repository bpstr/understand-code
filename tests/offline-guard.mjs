/** Fail closed if a prepared regression tries a network or application transport. */
import net from 'node:net';
import tls from 'node:tls';
import http from 'node:http';
import https from 'node:https';
import dgram from 'node:dgram';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
const deny = () => { throw new Error('Prepared tests must stay offline; network/provider/application execution is forbidden'); };
net.Socket.prototype.connect = deny;
net.connect = deny; net.createConnection = deny;
tls.connect = deny; http.request = deny; http.get = deny; https.request = deny; https.get = deny;
dgram.createSocket = deny;
globalThis.fetch = deny;
globalThis.WebSocket = class { constructor() { deny(); } };
for (const name of ['spawn', 'exec', 'execFile', 'execSync', 'fork']) childProcess[name] = deny;
for (const name of ['spawnSync', 'execFileSync']) {
  const original = childProcess[name];
  childProcess[name] = (command, args, options) => {
    if (command !== 'git' || !Array.isArray(args) || options?.shell) deny();
    const commandIndex = args[0] === '-C' ? 2 : 0;
    if (!['rev-parse', 'ls-files', 'diff', 'status', 'init', 'config', 'add', 'commit', 'mv', 'worktree', 'rm', 'show'].includes(args[commandIndex])) deny();
    return original.call(childProcess, command, args, options);
  };
}
syncBuiltinESMExports();
