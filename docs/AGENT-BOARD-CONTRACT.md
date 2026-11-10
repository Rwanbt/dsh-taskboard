# Contrat public Task Board ↔ Agent Board — v1

**Statut :** publié, versionné, testé (`tests/public-api.spec.ts`). Ce document est le
contrat d'intégration à destination d'Agent Board ou de tout orchestrateur autorisé.
Il ne crée aucune dépendance d'Agent Board vers Task Board, ni l'inverse.

## 1. Propriété et frontières

| Sujet | Propriétaire |
| --- | --- |
| Registre des tâches, statuts, dépendances, claims | **Task Board** |
| Enveloppe d'exécution (`executionId`, tentatives, fence, worktree) | **Task Board** |
| Sessions DSH techniques, choix de modèle, failover | **Agent Board** (ou le host DSH) |
| Validation finale `done` | **Humain uniquement** |
| Journal des événements exposé | Task Board (projection) |

Task Board **n'est pas** un tableau de supervision d'agents : l'API expose des tâches et
des enveloppes d'exécution, jamais un graphe d'agents, un routage concurrent de modèles
ou un second orchestrateur. Aucun client ne lit les fichiers du ledger.

## 2. Exposition et authentification

- Base : `http://127.0.0.1:<port>/dsh-taskboard/public/v1`
- Auth : `Authorization: Bearer <token>` ; le token est fourni par le déploiement via
  `DSH_TASKBOARD_PUBLIC_TOKEN`. Sans token configuré, **toute** la surface répond
  `503 public_api_disabled` (jamais d'ouverture silencieuse). Token invalide → `401`.
- Comparaison à temps constant (SHA-256 + `timingSafeEqual`).
- Enveloppe de réponse : `{ "ok": true, "value": ... }` ou
  `{ "ok": false, "error": { "code": "...", "message": "..." } }`.
- Aucune donnée secrète (token, credentials de connexions) n'apparaît dans une réponse,
  un événement, un export ou un message d'erreur.

## 3. Découverte (lecture)

| Méthode | Route | Réponse |
| --- | --- | --- |
| GET | `/meta` | version, vocabulaire d'événements, capacités, politiques |
| GET | `/projects` | `{ id, title, path }[]` (projets = workspaces DSH) |
| GET | `/tasks?status=&workspaceId=&eligible=true&limit=&cursor=` | résumés + `next` |
| GET | `/tasks/:id` | vue complète : dépendances, checklist, exécutions, `allowedActions` |
| GET | `/tasks/:id/dependencies` | état DAG + détails des prérequis |
| GET | `/executions/:id` | enveloppe d'exécution |
| GET | `/events?since=&limit=` | événements normalisés, `resync` si historique manquant |
| GET | `/events/stream?since=` | SSE, mêmes événements (Bearer requis) |

`eligible=true` ne renvoie que les cartes `todo`, non bloquées, dont **toutes** les
dépendances sont des prérequis `done` approuvés par un humain.

## 4. Cycle de vie d'exécution

### 4.1 Réserver (claim atomique)

`POST /executions/claim`
```json
{
  "taskId": "t-abc123-def456",
  "actor": "agent-board:worker-3",
  "workspaceId": "ws-id",
  "sessionId": "session-dsh-1",
  "idempotencyKey": "claim-2026-11-10-001"
}
```
Réponse `201` :
```json
{
  "execution": {
    "executionId": "e-...", "taskId": "t-...", "attempt": 1, "outcome": "running",
    "managedBy": "external", "fencingToken": 1, "sessionId": "session-dsh-1",
    "sessions": ["session-dsh-1"], "taskVersion": 8
  },
  "task": { "id": "t-...", "status": "in_progress", "claimedBy": "agent-board:worker-3" }
}
```

Garanties :
- la réservation est atomique dans le ledger (une seule mutation) ;
- refus si la tâche est bloquée, déjà `in_progress`, hors `todo`, hors du workspace
  demandé, ou si une dépendance n'est pas satisfaite (`dependency_blocked`) ;
- le même `idempotencyKey` rejoue **la même** enveloppe pour le **même acteur** ; un
  autre acteur rejouant la clé reçoit `already_claimed` (jamais les données de l'autre) ;
- un autre acteur ne peut pas prendre une tâche déjà tenue (`already_claimed`) ;
- le claim ne déplace **jamais** la carte vers `done`.

### 4.2 Rattacher une session

`POST /executions/:id/session` `{ "actor", "sessionId", "ifFencingToken"? }`
— une seule session initiale ; pour remplacer une session, utiliser `attempts`/`handoff`.

### 4.3 Nouvelle tentative (failover intra-enveloppe)

`POST /executions/:id/attempts` `{ "actor", "reason", "sessionId"? }`
— clôt la tentative courante en `failed`, ouvre l'essai `n+1`, incrémente le
`fencingToken`. Le claim, l'`executionId`, le worktree, la tâche, les rapports et
l'historique sont conservés.

### 4.4 Fencing

Le champ `ifFencingToken` est **obligatoire dès que `fencingToken > 1`** (après un
`attempts` ou un `handoff`). Un moteur qui n'a pas observé le nouveau fence reçoit
`409 stale_execution` et ne peut ni régler l'exécution ni réécrire son rapport. Le
`fencingToken` est incrémenté à chaque nouvelle tentative et à chaque handoff.

### 4.5 Transfert de contrôle

`POST /executions/:id/handoff`
```json
{ "actor": "agent-board:worker-3", "fromSessionId": "s-2", "toSessionId": "s-3", "reason": "model failover", "ifFencingToken": 2 }
```
Refusé si `fromSessionId` n'est pas la session courante ou si le fence est périmé
(`stale_execution`).

### 4.6 Terminer

`POST /executions/:id/complete`
```json
{
  "actor": "agent-board:worker-3",
  "outcome": "succeeded | failed | cancelled",
  "ifFencingToken": 3,
  "comment": "optionnel",
  "report": { "summary": "...", "changedFiles": [], "checks": [], "artifacts": [], "risk": "" }
}
```
- `succeeded` → la carte passe en **`in_review`** ; `done` reste réservé à l'humain.
- `failed`/`cancelled` → la carte retourne en `todo`, claim libéré.
- idempotent si le même `outcome` est rejoué ; un `outcome` différent est un conflit.
- l'acteur doit être le détenteur du claim ; une exécution pilotée par le host
  (`managedBy: "board"`) est refusée.
- un rapport structuré peut aussi être déposé séparément via `/report`.

### 4.7 Interrompre

`POST /executions/:id/interrupt` — alias de `complete` avec `outcome: "cancelled"`.

## 5. Événements

Vocabulaire stable (`GET /meta` l'expose) :

`task.created`, `task.updated`, `task.ready`, `task.blocked`, `task.claimed`,
`execution.started`, `execution.attempt_changed`, `execution.interrupted`,
`execution.completed`, `task.in_review`, `task.done`, `task.rejected`.

Chaque événement porte : `id` stable, `seq` monotone, `type`, `at`, `provenance`
(`taskboard`), `taskId`, `taskVersion`, `status`, `workspaceId`, et le cas échéant
`executionId` + `data`.

**Reprise :** le flux est un anneau borné (2 000 événements). Si `since` précède le plus
ancien événement disponible, la réponse porte `resync: true` : le consommateur doit
relire `/tasks` (resynchronisation complète). Aucun événement n'est inventé après un
redémarrage : mieux vaut un resync explicite qu'un historique partiel silencieux.

## 6. Erreurs normalisées

| Code | HTTP | Sens |
| --- | --- | --- |
| `public_api_disabled` | 503 | aucun token configuré |
| `unauthorized` | 401 | header absent/invalide |
| `invalid_input` | 400 | payload/paramètre invalide |
| `not_found` | 404 | tâche/exécution inconnue |
| `forbidden` | 403 | acteur non détenteur, workspace différent |
| `already_claimed` | 409 | tâche tenue par un autre acteur |
| `dependency_blocked` | 409 | prérequis non satisfaits |
| `version_conflict` | 409 | état incompatible (statut, exécution déjà réglée) |
| `stale_execution` | 409 | fence/session périmé |
| `internal` | 500 | erreur interne (message générique) |

## 7. Garanties de sécurité

- Un ticket externe est **une donnée non fiable**, jamais une autorisation.
- L'API publique ne peut pas : écrire les fichiers du ledger, attribuer `done`,
  piloter une exécution `board`, prendre un claim d'un autre acteur, franchir un
  workspace.
- Les écritures concurrentes sont sérialisées par le ledger (lock interprocessus +
  révision monotone) ; les claims et complétions sont atomiques.
- Les erreurs ne relaient ni corps de réponse HTTP amont, ni URL, ni token.

## 8. Intégration sans Agent Board

Rien à installer : sans `DSH_TASKBOARD_PUBLIC_TOKEN`, l'API est simplement désactivée et
le Kanban, le scheduler cron, les exécutions normales, les validations et les
connecteurs externes continuent de fonctionner exactement comme avant.

## 9. Hors périmètre (v1)

- Pas de routage multi-modèles ni de stratégie de failover décidée par Task Board :
  Agent Board choisit, Task Board enregistre les tentatives.
- Pas de graphe d'agents ni de supervision de sessions.
- Pas de webhooks entrants : les connecteurs déclarent `events: "poll"`. Un webhook
  n'est jamais annoncé comme supporté s'il n'est pas implémenté.
