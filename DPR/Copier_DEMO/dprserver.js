// === server.js (Node.js TCP Server for DPR) ===
const net = require('net');

const PORT = 9090;
const MANAGER_CODE = '54305430';
const clientsByTag = new Map(); // tag => Set<net.Socket>
const tagBySocket = new WeakMap(); // socket => tag
const clientInfoBySocket = new Map(); // socket => { tag, addr }
let managerSocket = null;

process.on('uncaughtException', (err) => {
    console.error('[UNCAUGHT_EXCEPTION]', err);
});

process.on('unhandledRejection', (err) => {
    console.error('[UNHANDLED_REJECTION]', err);
});

function removeSocketFromTag(socket) {
    const tag = tagBySocket.get(socket);
    if (!tag) return;
    const set = clientsByTag.get(tag);
    if (set) {
        set.delete(socket);
        if (set.size === 0) clientsByTag.delete(tag);
    }
    tagBySocket.delete(socket);
    const info = clientInfoBySocket.get(socket);
    if (info) info.tag = null;
}

function registerSocketToTag(socket, tag) {
    const cleanTag = (tag || '').toUpperCase();
    removeSocketFromTag(socket);
    if (!cleanTag) return 0;
    let set = clientsByTag.get(cleanTag);
    if (!set) {
        set = new Set();
        clientsByTag.set(cleanTag, set);
    }
    set.add(socket);
    tagBySocket.set(socket, cleanTag);
    const info = clientInfoBySocket.get(socket);
    if (info) info.tag = cleanTag;
    return set.size;
}

function sendToTag(tag, messageObj) {
    const cleanTag = (tag || '').toUpperCase();
    const set = clientsByTag.get(cleanTag);
    if (!set) return 0;
    let sent = 0;
    const payload = JSON.stringify(messageObj) + '\n';
    set.forEach((socket) => {
        if (!socket || socket.destroyed) {
            if (socket) removeSocketFromTag(socket);
            return;
        }
        try {
            socket.write(payload);
            sent += 1;
        } catch (err) {
            console.error(`[SEND ERROR] tag=${cleanTag} ${err.message}`);
            removeSocketFromTag(socket);
            try {
                socket.destroy();
            } catch {}
        }
    });
    return sent;
}

function broadcastAll(messageObj) {
    let sent = 0;
    const payload = JSON.stringify(messageObj) + '\n';
    clientsByTag.forEach((set) => {
        set.forEach((socket) => {
            if (!socket || socket.destroyed) {
                if (socket) removeSocketFromTag(socket);
                return;
            }
            try {
                socket.write(payload);
                sent += 1;
            } catch (err) {
                console.error(`[SEND ERROR] broadcast ${err.message}`);
                removeSocketFromTag(socket);
                try {
                    socket.destroy();
                } catch {}
            }
        });
    });
    return sent;
}

function parseAndDispatch(command) {
    const parts = command.trim().split(/\s+/);
    const type = parts[0]?.toLowerCase();
    const volume = parseFloat(parts[1]);
    const target = parts[2]?.toUpperCase();
    let sent = 0;

    switch (type) {
        case 'buy':
        case 'sell':
        case 'hedge':
            if (!isNaN(volume) && target) {
                sent = sendToTag(target, { action: type.toUpperCase(), lot: volume });
                if (sent === 0 && managerSocket && !managerSocket.destroyed) {
                    managerSocket.write(`NO_CLIENTS_FOR_TAG ${target}\n`);
                }
                console.log(`[COMMAND] ${type.toUpperCase()} ${volume} ${target} -> ${sent}`);
            } else {
                console.log('[ERROR] Invalid trade command format');
            }
            break;
        case 'close':
            if (parts[1]?.toLowerCase() === 'all' && parts[2]?.toLowerCase() === 'buy') {
                const closeTag = parts[3]?.toUpperCase();
                if (closeTag) {
                    sent = sendToTag(closeTag, { action: 'CLOSE_BUYS' });
                    if (sent === 0 && managerSocket && !managerSocket.destroyed) {
                        managerSocket.write(`NO_CLIENTS_FOR_TAG ${closeTag}\n`);
                    }
                    console.log(`[COMMAND] CLOSE_BUYS ${closeTag} -> ${sent}`);
                } else {
                    sent = broadcastAll({ action: 'CLOSE_BUYS' });
                    console.log(`[COMMAND] CLOSE_BUYS ALL -> ${sent}`);
                }
            } else if (parts[1]?.toLowerCase() === 'all' && parts[2]?.toLowerCase() === 'sell') {
                const closeTag = parts[3]?.toUpperCase();
                if (closeTag) {
                    sent = sendToTag(closeTag, { action: 'CLOSE_SELLS' });
                    if (sent === 0 && managerSocket && !managerSocket.destroyed) {
                        managerSocket.write(`NO_CLIENTS_FOR_TAG ${closeTag}\n`);
                    }
                    console.log(`[COMMAND] CLOSE_SELLS ${closeTag} -> ${sent}`);
                } else {
                    sent = broadcastAll({ action: 'CLOSE_SELLS' });
                    console.log(`[COMMAND] CLOSE_SELLS ALL -> ${sent}`);
                }
            } else if (parts[1] === 'all') {
                if (target) {
                    sent = sendToTag(target, { action: 'CLOSE_ALL' });
                    if (sent === 0 && managerSocket && !managerSocket.destroyed) {
                        managerSocket.write(`NO_CLIENTS_FOR_TAG ${target}\n`);
                    }
                    console.log(`[COMMAND] CLOSE_ALL ${target} -> ${sent}`);
                } else {
                    sent = broadcastAll({ action: 'CLOSE_ALL' });
                    console.log(`[COMMAND] CLOSE_ALL ALL -> ${sent}`);
                }
            } else if (parts[1] === 'profits' && target) {
                sent = sendToTag(target, { action: 'CLOSE_PROFITS' });
                if (sent === 0 && managerSocket && !managerSocket.destroyed) {
                    managerSocket.write(`NO_CLIENTS_FOR_TAG ${target}\n`);
                }
                console.log(`[COMMAND] CLOSE_PROFITS ${target} -> ${sent}`);
            } else {
                console.log('[ERROR] Invalid close command');
            }
            break;
        default:
            console.log('[ERROR] Unknown command:', command);
    }
}

const server = net.createServer();

server.on('connection', (socket) => {
    console.log('[NEW CONNECTION]');
    socket.setKeepAlive(true, 30000);
    socket.setNoDelay(true);
    socket._buf = '';

    let isActivated = false;
    let isManager = false;
    let clientCode = null;
    clientInfoBySocket.set(socket, { tag: null, addr: `${socket.remoteAddress}:${socket.remotePort}` });

    socket.on('data', (data) => {
        socket._buf += data.toString('utf8');
        let idx = socket._buf.indexOf('\n');
        while (idx !== -1) {
            const line = socket._buf.slice(0, idx).trim();
            socket._buf = socket._buf.slice(idx + 1);
            if (line === '') {
                idx = socket._buf.indexOf('\n');
                continue;
            }
            const msg = line;
            console.log(`[RECEIVED] ${msg}`);

            if (!isActivated) {
                if (msg === MANAGER_CODE) {
                    isManager = true;
                    isActivated = true;
                    managerSocket = socket;
                    socket.write('MANAGER_AUTHORIZED\n');
                    console.log('[MANAGER CONNECTED]');
                } else {
                    isActivated = true;
                    clientCode = msg || Math.random().toString(36).substr(2, 6);
                    socket.write('VALID\n');
                    console.log(`[EA CONNECTED] ${clientCode}`);
                }
            } else {
                if (isManager) {
                    parseAndDispatch(msg);
                } else if (msg.startsWith('BROKER ')) {
                    const broker = msg.split(' ')[1]?.toUpperCase();
                    const count = registerSocketToTag(socket, broker);
                    console.log(`[ASSIGNING BROKER] ${clientCode} -> ${broker} (${count})`);
                    if (broker && socket && !socket.destroyed) {
                        socket.write(`REGISTERED ${broker} COUNT ${count}\n`);
                    }
                    const info = clientInfoBySocket.get(socket);
                    const remote = info?.addr || `${socket.remoteAddress}:${socket.remotePort}`;
                    console.log(`[EA_REGISTER] tag=${broker} count=${count} remote=${remote}`);
                } else {
                    console.log(`[IGNORED FROM ${clientCode}] ${msg}`);
                }
            }
            idx = socket._buf.indexOf('\n');
        }
    });

    socket.on('end', () => {
        console.log(`[DISCONNECTED] ${clientCode || 'Unknown'}`);
        removeSocketFromTag(socket);
        clientInfoBySocket.delete(socket);
        if (socket === managerSocket) managerSocket = null;
    });

    socket.on('error', (err) => {
        console.log(`[SOCKET ERROR]`, err.message);
        removeSocketFromTag(socket);
        clientInfoBySocket.delete(socket);
        if (socket === managerSocket) managerSocket = null;
    });
});

server.listen(PORT, () => {
    console.log(`🚀 DPR TCP server is running on port ${PORT}`);
});
