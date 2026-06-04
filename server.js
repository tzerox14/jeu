const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const server = http.createServer((req, res) => {
  const filePath = path.join(__dirname, 'index.html');
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(data);
  });
});

const wss = new WebSocket.Server({ server });

const TICK_RATE = 60;
const GRAVITY = 0.6;
const JUMP_FORCE = -14;
const MOVE_SPEED = 5;
const GROUND_Y = 520;
const STAGE_W = 1200;
const STAGE_H = 600;

const PLATFORMS = [
  { x: 0,    y: 540, w: 1200, h: 60 },
  { x: 150,  y: 380, w: 200,  h: 20 },
  { x: 480,  y: 300, w: 240,  h: 20 },
  { x: 850,  y: 380, w: 200,  h: 20 },
  { x: 280,  y: 200, w: 180,  h: 20 },
  { x: 740,  y: 200, w: 180,  h: 20 },
];

const COLORS = ['#e74c3c','#3498db','#2ecc71','#f39c12','#9b59b6'];
const NAMES_COLORS = ['Rouge','Bleu','Vert','Orange','Violet'];

let players = {};
let gameState = 'lobby';
let gameLoop = null;
let roundTimer = 0;

function createPlayer(id, name, colorIdx) {
  const spawnX = [200, 900, 550, 350, 750][colorIdx] || 400;
  return {
    id, name,
    color: COLORS[colorIdx],
    colorName: NAMES_COLORS[colorIdx],
    x: spawnX, y: 300,
    vx: 0, vy: 0,
    onGround: false,
    jumpsLeft: 2,
    stocks: 3,
    damage: 0,
    facing: colorIdx < 2 ? 1 : -1,
    attacking: false,
    attackTimer: 0,
    attackType: null,
    dodging: false,
    dodgeTimer: 0,
    dodgeCooldown: 0,
    hitCooldown: 0,
    dead: false,
    respawnTimer: 0,
    inputs: { left:false, right:false, jump:false, jumpPressed:false, light:false, heavy:false, dodge:false },
    alive: true,
  };
}

function rectOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx+bw && ax+aw > bx && ay < by+bh && ay+ah > by;
}

function getHitbox(p) {
  return { x: p.x - 20, y: p.y - 40, w: 40, h: 48 };
}

function getAttackBox(p) {
  const reach = p.attackType === 'heavy' ? 80 : 55;
  const ox = p.facing * 28;
  return { x: p.x + ox - 20, y: p.y - 35, w: reach, h: 40 };
}

function applyHit(attacker, victim, type) {
  if (victim.hitCooldown > 0 || victim.dodging) return;
  const dmgAdd = type === 'heavy' ? 14 : 7;
  victim.damage = Math.min(victim.damage + dmgAdd, 999);
  const kb = (type === 'heavy' ? 9 : 5) * (1 + victim.damage / 80);
  const dir = victim.x > attacker.x ? 1 : -1;
  victim.vx = dir * kb;
  victim.vy = type === 'heavy' ? -kb * 0.7 : -kb * 0.3;
  victim.hitCooldown = 30;
}

function tickGame() {
  const pList = Object.values(players).filter(p => p.alive && !p.dead);

  for (const p of pList) {
    if (p.respawnTimer > 0) {
      p.respawnTimer--;
      if (p.respawnTimer === 0) respawnPlayer(p);
      continue;
    }

    if (p.hitCooldown > 0) p.hitCooldown--;
    if (p.dodgeCooldown > 0) p.dodgeCooldown--;

    if (p.dodging) {
      p.dodgeTimer--;
      if (p.dodgeTimer <= 0) p.dodging = false;
    }

    if (p.attacking) {
      p.attackTimer--;
      if (p.attackTimer <= 0) p.attacking = false;
    }

    if (!p.dodging && !p.attacking) {
      if (p.inputs.left)  { p.vx = -MOVE_SPEED; p.facing = -1; }
      if (p.inputs.right) { p.vx =  MOVE_SPEED; p.facing =  1; }
      if (!p.inputs.left && !p.inputs.right) p.vx *= 0.75;

      if (p.inputs.jumpPressed && p.jumpsLeft > 0) {
        p.vy = JUMP_FORCE;
        p.jumpsLeft--;
        p.onGround = false;
        p.inputs.jumpPressed = false;
      }

      if (p.inputs.light && !p.attacking) {
        p.attacking = true; p.attackType = 'light'; p.attackTimer = 14;
      }
      if (p.inputs.heavy && !p.attacking) {
        p.attacking = true; p.attackType = 'heavy'; p.attackTimer = 22;
      }
      if (p.inputs.dodge && p.dodgeCooldown === 0) {
        p.dodging = true; p.dodgeTimer = 18; p.dodgeCooldown = 55;
        p.vx = p.facing * 9;
      }
    }

    p.vy += GRAVITY;
    p.x += p.vx;
    p.y += p.vy;

    p.onGround = false;
    for (const plat of PLATFORMS) {
      if (p.vx * 0 === 0 && p.vy >= 0 &&
          p.x > plat.x && p.x < plat.x + plat.w &&
          p.y >= plat.y - 2 && p.y <= plat.y + p.vy + 2) {
        p.y = plat.y;
        p.vy = 0;
        p.onGround = true;
        p.jumpsLeft = 2;
      }
    }

    if (p.x < -150 || p.x > STAGE_W + 150 || p.y > STAGE_H + 100 || p.y < -200) {
      killPlayer(p);
      continue;
    }

    if (p.attacking && p.attackTimer < (p.attackType === 'heavy' ? 18 : 10)) {
      const abox = getAttackBox(p);
      for (const other of pList) {
        if (other.id === p.id) continue;
        const hbox = getHitbox(other);
        if (rectOverlap(abox.x, abox.y, abox.w, abox.h, hbox.x, hbox.y, hbox.w, hbox.h)) {
          applyHit(p, other, p.attackType);
        }
      }
    }

    p.inputs.jumpPressed = false;
    p.inputs.light = false;
    p.inputs.heavy = false;
    p.inputs.dodge = false;
  }

  checkWin();
  broadcast({ type: 'gameState', players: serializePlayers(), platforms: PLATFORMS });
}

function killPlayer(p) {
  p.stocks--;
  p.damage = 0;
  if (p.stocks <= 0) {
    p.alive = false;
    p.dead = true;
    broadcast({ type: 'playerDied', id: p.id, name: p.name });
  } else {
    p.dead = true;
    p.respawnTimer = 120;
    broadcast({ type: 'playerKilled', id: p.id, stocks: p.stocks });
  }
}

function respawnPlayer(p) {
  p.x = 600; p.y = 100;
  p.vx = 0; p.vy = 0;
  p.dead = false;
  p.hitCooldown = 60;
}

function checkWin() {
  const alive = Object.values(players).filter(p => p.alive);
  if (alive.length === 1 && Object.keys(players).length > 1) {
    endGame(alive[0]);
  } else if (alive.length === 0) {
    endGame(null);
  }
}

function endGame(winner) {
  if (gameState !== 'playing') return;
  gameState = 'ended';
  clearInterval(gameLoop);
  gameLoop = null;
  broadcast({ type: 'gameOver', winner: winner ? { id: winner.id, name: winner.name, color: winner.color } : null });
}

function serializePlayers() {
  return Object.values(players).map(p => ({
    id: p.id, name: p.name, color: p.color,
    x: Math.round(p.x), y: Math.round(p.y),
    vx: p.vx, vy: p.vy, facing: p.facing,
    stocks: p.stocks, damage: p.damage,
    attacking: p.attacking, attackType: p.attackType,
    dodging: p.dodging, hitCooldown: p.hitCooldown,
    alive: p.alive, dead: p.dead, respawnTimer: p.respawnTimer,
  }));
}

function startGame() {
  gameState = 'playing';
  Object.values(players).forEach(p => {
    const idx = Object.keys(players).indexOf(p.id);
    const fresh = createPlayer(p.id, p.name, idx);
    Object.assign(p, fresh);
  });
  gameLoop = setInterval(tickGame, 1000 / TICK_RATE);
  broadcast({ type: 'gameStart', platforms: PLATFORMS });
}

function broadcast(msg) {
  const data = JSON.stringify(msg);
  wss.clients.forEach(ws => { if (ws.readyState === WebSocket.OPEN) ws.send(data); });
}

let colorIndex = 0;

wss.on('connection', ws => {
  let playerId = null;

  ws.send(JSON.stringify({
    type: 'init',
    gameState,
    playerCount: Object.keys(players).length,
    players: serializePlayers(),
    platforms: PLATFORMS,
  }));

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'join') {
      if (Object.keys(players).length >= 5) {
        ws.send(JSON.stringify({ type: 'error', msg: 'Partie pleine (5 joueurs max)' }));
        return;
      }
      const name = (msg.name || 'Joueur').slice(0, 16);
      playerId = 'p_' + Date.now() + '_' + Math.random().toString(36).slice(2,6);
      const idx = colorIndex++ % 5;
      players[playerId] = createPlayer(playerId, name, idx);
      ws.playerId = playerId;
      ws.send(JSON.stringify({ type: 'joined', id: playerId, color: COLORS[idx], colorName: NAMES_COLORS[idx] }));
      broadcast({ type: 'lobby', players: Object.values(players).map(p => ({ id: p.id, name: p.name, color: p.color })), gameState });
    }

    if (msg.type === 'startGame' && gameState === 'lobby') {
      if (Object.keys(players).length >= 1) startGame();
    }

    if (msg.type === 'restart' && gameState === 'ended') {
      gameState = 'lobby';
      colorIndex = 0;
      players = {};
      broadcast({ type: 'lobby', players: [], gameState: 'lobby' });
    }

    if (msg.type === 'inputs' && playerId && players[playerId]) {
      const p = players[playerId];
      const i = msg.inputs;
      p.inputs.left = !!i.left;
      p.inputs.right = !!i.right;
      if (i.jump && !p.inputs.jump) p.inputs.jumpPressed = true;
      p.inputs.jump = !!i.jump;
      if (i.light) p.inputs.light = true;
      if (i.heavy) p.inputs.heavy = true;
      if (i.dodge) p.inputs.dodge = true;
    }
  });

  ws.on('close', () => {
    if (playerId && players[playerId]) {
      delete players[playerId];
      broadcast({ type: 'lobby', players: Object.values(players).map(p => ({ id: p.id, name: p.name, color: p.color })), gameState });
      if (gameState === 'playing') checkWin();
    }
  });
});

const PORT = 3000;
server.listen(PORT, '0.0.0.0', () => {
  const { networkInterfaces } = require('os');
  const nets = networkInterfaces();
  let localIP = 'localhost';
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) localIP = net.address;
    }
  }
  console.log('\n🎮  Serveur lancé !');
  console.log(`👉  Ton IP locale : http://${localIP}:${PORT}`);
  console.log(`🔗  Tes potes ouvrent ce lien dans leur navigateur\n`);
});
