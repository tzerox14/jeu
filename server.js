const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, 'public')));

// Game state
const rooms = {};

function createRoom(roomId) {
  return {
    id: roomId,
    players: {},
    traps: initTraps(),
    gameStarted: false,
    gameOver: false,
    startTime: null,
  };
}

function initTraps() {
  return [
    { id: 'trap_pit1',   label: '💥 FOSSE Zone A',    type: 'pit',   pos: [0, 0, -28],   used: false, activated: false },
    { id: 'trap_wall1',  label: '🧱 MUR Zone B',      type: 'wall',  pos: [0, 0, -55],   used: false, activated: false },
    { id: 'trap_fire1',  label: '🔥 FLAMMES Zone C',  type: 'fire',  pos: [0, 0, -82],   used: false, activated: false },
    { id: 'trap_pit2',   label: '💥 FOSSE Zone D',    type: 'pit',   pos: [0, 0, -105],  used: false, activated: false },
    { id: 'trap_spike1', label: '⚡ PICS Zone E',     type: 'spike', pos: [0, 0, -128],  used: false, activated: false },
    { id: 'trap_wall2',  label: '🧱 MUR Zone F',      type: 'wall',  pos: [0, 0, -150],  used: false, activated: false },
    { id: 'trap_fire2',  label: '🔥 FLAMMES Zone G',  type: 'fire',  pos: [0, 0, -170],  used: false, activated: false },
    { id: 'trap_pit3',   label: '💥 FOSSE Finale',    type: 'pit',   pos: [0, 0, -188],  used: false, activated: false },
  ];
}

function broadcast(room, msg, excludeId = null) {
  Object.entries(room.players).forEach(([id, p]) => {
    if (id !== excludeId && p.ws && p.ws.readyState === WebSocket.OPEN) {
      p.ws.send(JSON.stringify(msg));
    }
  });
}

function broadcastAll(room, msg) {
  broadcast(room, msg, null);
}

wss.on('connection', (ws) => {
  let playerId = Math.random().toString(36).slice(2);
  let roomId = null;

  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }

    if (msg.type === 'join') {
      roomId = msg.roomId || 'default';
      if (!rooms[roomId]) rooms[roomId] = createRoom(roomId);
      const room = rooms[roomId];

      // Assign role
      const runnerExists = Object.values(room.players).some(p => p.role === 'runner');
      const trapperExists = Object.values(room.players).some(p => p.role === 'trapper');
      let role = msg.role;
      if (!role) role = !runnerExists ? 'runner' : !trapperExists ? 'trapper' : 'runner';

      room.players[playerId] = {
        id: playerId,
        ws,
        role,
        name: msg.name || (role === 'runner' ? 'Runner' : 'Piégeur'),
        pos: { x: 0, y: 1, z: -2 },
        deaths: 0,
      };

      ws.send(JSON.stringify({
        type: 'welcome',
        playerId,
        role,
        roomId,
        traps: room.traps,
        players: getPublicPlayers(room),
        gameStarted: room.gameStarted,
      }));

      broadcast(room, {
        type: 'playerJoined',
        playerId,
        role,
        name: room.players[playerId].name,
        players: getPublicPlayers(room),
      }, playerId);

      // Auto-start if both roles present
      const hasRunner = Object.values(room.players).some(p => p.role === 'runner');
      const hasTrapper = Object.values(room.players).some(p => p.role === 'trapper');
      if (hasRunner && hasTrapper && !room.gameStarted) {
        room.gameStarted = true;
        room.startTime = Date.now();
        broadcastAll(room, { type: 'gameStart', startTime: room.startTime });
      }
    }

    else if (msg.type === 'move') {
      const room = rooms[roomId];
      if (!room || !room.players[playerId]) return;
      room.players[playerId].pos = msg.pos;
      broadcast(room, {
        type: 'playerMoved',
        playerId,
        pos: msg.pos,
        rot: msg.rot,
      }, playerId);
    }

    else if (msg.type === 'activateTrap') {
      const room = rooms[roomId];
      if (!room) return;
      const trap = room.traps.find(t => t.id === msg.trapId);
      if (!trap || trap.used) return;
      trap.used = true;
      trap.activated = true;
      trap.activatedAt = Date.now();
      broadcastAll(room, {
        type: 'trapActivated',
        trapId: msg.trapId,
        activatedBy: playerId,
      });
    }

    else if (msg.type === 'died') {
      const room = rooms[roomId];
      if (!room || !room.players[playerId]) return;
      room.players[playerId].deaths++;
      broadcastAll(room, {
        type: 'playerDied',
        playerId,
        reason: msg.reason,
        deaths: room.players[playerId].deaths,
      });
    }

    else if (msg.type === 'win') {
      const room = rooms[roomId];
      if (!room || room.gameOver) return;
      room.gameOver = true;
      const elapsed = ((Date.now() - room.startTime) / 1000).toFixed(1);
      broadcastAll(room, {
        type: 'gameOver',
        winnerId: playerId,
        time: elapsed,
        deaths: room.players[playerId]?.deaths || 0,
      });
    }

    else if (msg.type === 'restart') {
      const room = rooms[roomId];
      if (!room) return;
      room.traps = initTraps();
      room.gameOver = false;
      room.gameStarted = true;
      room.startTime = Date.now();
      Object.values(room.players).forEach(p => p.deaths = 0);
      broadcastAll(room, {
        type: 'restart',
        traps: room.traps,
        startTime: room.startTime,
      });
    }
  });

  ws.on('close', () => {
    const room = rooms[roomId];
    if (!room || !room.players[playerId]) return;
    const role = room.players[playerId].role;
    delete room.players[playerId];
    broadcast(room, { type: 'playerLeft', playerId, role }, null);
    if (Object.keys(room.players).length === 0) delete rooms[roomId];
  });
});

function getPublicPlayers(room) {
  return Object.values(room.players).map(p => ({
    id: p.id, role: p.role, name: p.name, pos: p.pos, deaths: p.deaths,
  }));
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🎮 TRAP RUNNER server running on http://localhost:${PORT}`));
