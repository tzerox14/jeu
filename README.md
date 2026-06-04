# 🎮 TRAP RUNNER — Multijoueur

## Lancer le jeu

### Installation (une seule fois)
```bash
npm install
```

### Démarrer le serveur
```bash
node server.js
```

Le jeu est accessible sur **http://localhost:3000**

---

## Comment jouer en multijoueur

1. Lance le serveur (`node server.js`)
2. Le Runner et le Piégeur ouvrent **http://TON-IP:3000** dans leur navigateur
3. Entrez le **même code de salle** (ex: `amis2024`)
4. Choisissez votre rôle : Runner ou Piégeur
5. La partie démarre automatiquement quand les 2 joueurs sont connectés

> Pour trouver ton IP : `ipconfig` (Windows) ou `ifconfig` (Mac/Linux)

---

## Contrôles

### Runner (1ère personne)
- **WASD / Flèches** : Se déplacer
- **Espace** : Sauter
- **Souris** : Regarder (cliquer sur le jeu pour capturer)
- **ESC** : Libérer la souris

### Piégeur (vue de dessus)
- **Clic droit + Glisser** : Déplacer la caméra
- **Molette** : Zoom in/out
- **Boutons en bas** : Activer les pièges (1 usage chacun !)

---

## Les pièges
| Piège | Effet | Usage |
|-------|-------|-------|
| 💥 Fosse | Le sol disparaît | 1x |
| 🧱 Mur | Un mur surgit | 1x |
| 🔥 Flammes | Jets de feu (3.5s) | 1x |
| ⚡ Pics | Pics surgissent (2.5s) | 1x |

---

## Hébergement en ligne (pour jouer avec des amis à distance)

### Option gratuite : Railway / Render / Fly.io
1. Push le code sur GitHub
2. Connecte Railway.app à ton repo
3. Deploy — Railway détecte automatiquement Node.js
4. Partage le lien à tes amis !

### Variables d'environnement
- `PORT` : port du serveur (défaut: 3000)
