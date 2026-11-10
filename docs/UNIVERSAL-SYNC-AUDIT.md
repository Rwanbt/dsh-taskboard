# Task Board — audit baseline et matrice de capacités (2026-11-10)

Ce document est la photographie **vérifiée sur le code** de l'état du dépôt avant la
campagne « synchronisation universelle ». Il ne reprend pas les affirmations du README :
chaque chiffre a été mesuré, chaque « absent » a été vérifié dans les sources.

## 1. Baseline mesurée

| Élément | Valeur réelle | Preuve |
| --- | --- | --- |
| Branche de référence | `dev` = `775c1f1` (v0.10.2) | `git log dev` |
| État local initial | `main` = `dev` + 2 commits GitHub non poussés, `package.json` 0.11.0 | `git log dev..main`, `git show dev:package.json` |
| Tests annoncés README | 1 026 (v0.10.2) | README |
| Tests réels | **1 061 tests / 78 fichiers**, tous verts | `npm test` (2026-11-10) |
| Typecheck | propre | `npm run typecheck` |
| Build | script `tsdown` présent, non rejoué avant campagne | `package.json` |
| E2E réels | git worktree/mirror/auto-commit, `tests/issue-94.spec.ts`, `tests/mirror-real-git.spec.ts` | tests |

> Constat : le chiffre du README est périmé (1 026 → 1 061). Il sera réaligné en fin de
> campagne, avec la version réellement livrée.

## 2. Matrice fonctionnelle (avant campagne)

### Cœur Task Board — à préserver

| Capacité | État | Détail vérifié |
| --- | --- | --- |
| Kanban 5 colonnes | **Implémenté/testé** | `shared/protocol.ts` `MAIN_STATUSES`, `TaskBoard.tsx`, tests client |
| Groupement par projet | **Implémenté/testé** | `workspaceId`, `TaskBoard` sticky group head |
| Sous-tâches + dépendances DAG | **Implémenté/testé** | `shared/dependencies.ts`, `shared/hierarchy.ts`, `tests/dependencies.spec.ts`, `hierarchy.spec.ts` |
| Planification manuelle/différée/cron | **Implémenté/testé** | `shared/protocol.ts` `parseCron`, `host/scheduler.ts`, `scheduled-session.ts` |
| Claims et réservations | **Implémenté/testé** | `todo→in_progress`, `claimedBy`, `tests/stale-claim.spec.ts` |
| Isolation Git worktree | **Implémenté/testé (git réel)** | `host/git.ts`, `host/isolation.ts`, `tests/mirror-real-git.spec.ts` |
| Exécution via sessions DSH | **Implémenté/testé** | `host/execution.ts` |
| Checklist DoD | **Implémenté/testé** | `checklist` + `taskboard_checklist` |
| Rapports d'exécution | **Implémenté/testé** | `ExecutionReport`, `taskboard_execution_report` |
| Commentaires/historique | **Implémenté/testé** | `comments`, SSE `change` |
| Validation humaine (`done`) | **Implémenté/testé** | gate `in_review→done`, seul l'utilisateur (routes GUI) ; tools agents ne peuvent pas `done` |
| Import/export/persistance | **Implémenté/testé** | `routes.ts` import/export, `host/store.ts` lock + écriture atomique |

### Synchronisation externe — avant campagne

| Capacité | État | Détail vérifié |
| --- | --- | --- |
| ZenTao | **Implémenté/testé (mock)** | `host/zentao.ts`, lecture seule |
| TAPD | **Implémenté/testé (mock)** | `host/tapd.ts`, lecture seule |
| GitHub Issues | **Implémenté/testé (mock)** | `host/github.ts` (0.11.0), lecture + écriture opt-in |
| GitLab / Gitea / Forgejo | **Absent** | aucun fichier |
| Bitbucket / Azure DevOps | **Absent** | aucun fichier |
| Jira / Linear / Trello / GitHub Projects / GitLab Boards | **Absent** | aucun fichier |
| Contrat d'adaptateur versionné | **Partiel** | `ProviderDescriptor` + `ExternalProviderRegistry`, sans version ni capacités déclaratives vérifiées |
| Capacités déclaratives vs réelles | **Partiel** | flags `write`/`dedupe` non vérifiés contre l'implémentation |
| Multi-connexions | **Absent** | une seule connexion persistée (`{config}`) |
| Identité externe canonique multiple | **Absent** | un seul `task.external` (une référence) |
| Autorité de champ configurable | **Absent** | merge trois voies figé |
| Write-back explicitement opt-in | **Partiel** | activé par la seule capacité `write` du provider |
| Prévisualisation de synchronisation | **Absent** | — |
| Webhooks / signature | **Absent** | polling uniquement |
| Backoff / rate-limit | **Partiel** | retries 429/5xx + `retry-after`, pas de circuit breaker |
| Idempotence des pushes | **Partiel** | diff sur `pushBase`, pas de clé d'idempotence explicite |
| Purge/reprise crash | **Partiel** | pas de journal de synchronisation durable |

### Contrat Agent Board — avant campagne

| Capacité | État | Détail |
| --- | --- | --- |
| Lecture des tâches via API publique | **Absent** | routes GUI `/dsh-taskboard/*` non authentifiées, non versionnées |
| Cycle de vie d'exécution pilotable par un moteur externe | **Absent** | exécution pilotée uniquement par le host DSH |
| Enregistrement de tentatives / failover de session | **Absent** | `ExecutionRecord` a un seul `sessionId` |
| Événements normalisés pour consommateur | **Partiel** | SSE interne `change` avec kinds de stockage |
| Authentification des routes publiques | **Absent** | surface locale sans bearer token |
| Fonctionnement sans Agent Board | **Acquis** | aucun couplage existant |

## 3. Risques P0 identifiés

1. **Une seule connexion externe** : impossible de relier GitHub + Jira sur le même board.
2. **Capacités non vérifiées** : un descriptor pourrait annoncer `write` sans méthode,
   ou l'inverse.
3. **Write-back implicite** : la seule présence d'un provider capable d'écrire suffisait.
4. **Une seule référence externe par carte** : risque de doublons multi-plateformes.
5. **Aucune API d'exécution pour un orchestrateur externe** : Agent Board ne peut pas
   réserver une tâche atomiquement ni suivre une exécution.
6. **Aucun journal d'événements consommable** : reprise après crash non prouvée côté client.

## 4. Plan de vagues

| Vague | Contenu | État |
| --- | --- | --- |
| A | Audit baseline + contrat v1 + identité canonique + multi-connexions + write-back explicite | **livré dans la branche** |
| B | Contrat public Agent Board v1 (lecture, claims, tentatives, événements, auth) | en cours |
| C | Adaptateurs GitLab, Gitea/Forgejo, Jira, Linear (mock déterministe) | en cours (sous-agents) |
| D | UI multi-connexions + i18n + prévisualisation | à venir |
| E | Sécurité, performance, migrations, documentation | à venir |
| F | Campagne complète, E2E, rapport final | à venir |

## 5. Limites assumées

- Aucun credential réel n'est disponible : les connecteurs sont validés par **serveurs
  simulés déterministes**, jamais présentés comme validés en production.
- Bitbucket / Azure DevOps / Trello / GitHub Projects / GitLab Boards ne seront pas
  annoncés comme opérationnels sans implémentation réelle : ils resteront listés comme
  **non supportés**.
- Un échec E2E réel observé pendant la campagne (timeout `issue-94` sous charge) reste
  visible et sera rejoué isolément avant le verdict final.
