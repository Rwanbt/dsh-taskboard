# Remédiation de l’audit autonomie — 12 novembre 2026

Réponse opérationnelle à [`AUDIT-AUTONOMIE-2026-11-12.md`](AUDIT-AUTONOMIE-2026-11-12.md).
Chaque correction est couverte par un test de régression dans la composition réelle
(routes/services/tools ou hôte Agent Board simulé), avec des ledgers temporaires.

Commits de référence : Taskboard `ee04bfc` (`fix(security,autonomy): close the audit
P0/P1 gaps`), Agent Board `9cd8d33` (`fix(superagent): enforce readiness, pause, model
and fallback contracts`), intégré depuis sur `dev` en `c4f1d2a` (la branche
`feat/superagent-ux-polish` a été fusionnée puis supprimée).

## 1. État des constats

| ID | Constat | État | Preuve / test |
| --- | --- | --- | --- |
| A01 | Lancement d’une carte non prête (backlog, bloquée, attente humaine, prérequis manquant) | **Corrigé** | `tests/qa/audit-remediation.spec.ts` (A08), `tests/goal6-superagent-host.test.js` (readiness A01), `src/orchestrator/readiness.js` |
| A02 | Permission d’exécution fail-open | **Corrigé** | `tests/qa/audit-remediation.spec.ts` (A02), `tests/scheduled-session.spec.ts` |
| A03 | Actions mutantes sans exécuteur | **Partiellement corrigé** : `create_task`, `update_task`, `comment` opérationnels via l’API publique ; les autres restent explicitement indisponibles | `tests/public-api.spec.ts`, `tests/goal6-superagent-host.test.js` (A03), `tests/superagent-brain.test.js` |
| A04 | Réconciliation invalide une exécution externe vivante | **Corrigé** | `tests/qa/audit-external-reconcile.spec.ts` |
| A05 | Pause pendant l’analyse ignorée | **Corrigé** | `tests/goal6-superagent-host.test.js` (A05) |
| A06 | Modèle enregistré non appliqué | **Corrigé** (recyclage à la frontière suivante, modèle actif publié) | `tests/goal6-superagent-host.test.js` (A06) |
| A07 | Fallbacks du cerveau décoratifs | **Corrigé** (bascule bornée sur échec retryable) | `tests/goal6-superagent-host.test.js` (A07) |
| A08 | `blocked`/`waitingForHuman` non respectés | **Corrigé** sur scheduler, exécution automatique et claim public | `tests/qa/audit-remediation.spec.ts` (A08) |
| A09 | One-shot perdu après crash | **Corrigé** : réarmement si jamais démarré, sinon marqueur de reprise explicite | `tests/qa/audit-remediation.spec.ts` (A09) |
| A10 | Checklist interprojet | **Corrigé** | `tests/qa/audit-remediation.spec.ts` (A10) |
| A11 | Sync externe globale/étrangère par un agent | **Corrigé** : sync globale réservée à l’opérateur, push borné au projet | `tests/qa/audit-remediation.spec.ts` (A11) |
| A12 | Matrice de capacités incomplète | **Corrigé** : 13 actions publiées, raisons honnêtes | `tests/connectors.test.js`, `tests/goal6-superagent-host.test.js` |
| A13 | 25 premières cartes seulement | **Atténué** : tri par préparation, drapeaux/readiness exposés, troncature explicite ; la borne 25 reste | `src/host/index.js`, `src/superagent/brain.js` |
| A14 | Run manuel permissif | **Non modifié** : décision de contrat ; documenté comme geste opérateur explicite | — |
| A15 | Rapport impossible après claim manuel | **Corrigé** : rapport porté par la tâche et affiché | `tests/qa/audit-remediation.spec.ts` (A15), `src/client/board/*` |

## 2. Détail des changements

### Taskboard

- **Garde de préparation** (`src/host/execution.ts`) : refus des déclencheurs automatiques
  sur carte `blocked` ou `waitingForHuman`, refus d’un one-shot marqué `recoveryRequired`,
  réarmement sûr après interruption.
- **Permission fail-closed** : une permission explicite différente du défaut de la carte
  doit être appliquée et vérifiée ; sinon la session est créée puis fermée sans recevoir
  le prompt, l’exécution échoue et la carte revient en `todo`.
- **Réconciliation** : les exécutions `managedBy: 'external'` ne sont plus invalidées par
  un redémarrage ; leur bail d’activité est prolongé par les opérations publiques
  (`session`, `attempts`, `handoff`) et expire après 24 h. Enveloppe et `attempts`
  restent cohérents.
- **Frontières** : checklist soumise à `assertProjectAccess` ; sync externe globale
  refusée aux sessions agent, push d’une carte étrangère refusé.
- **Rapport manuel** : nouveau champ `TaskRecord.report`, écrit par
  `taskboard_execution_report` quand la session détient le claim ; affiché dans la
  carte et le détail.
- **API publique** : `POST /tasks`, `POST /tasks/:id/update`,
  `POST /tasks/:id/comments` (Bearer, `taskWrite: true` dans `/meta`) ; pas de `done`,
  pas de modification d’`execution`/`model`/`preset`.
- **Scheduler** : les cartes en attente humaine ne consomment ni ne mettent en file une
  fenêtre planifiée ; la reprise est réévaluée à chaque point atomique.

### Agent Board

- **Readiness unique** (`src/orchestrator/readiness.js`) partagée par la porte de
  lancement et la supervision : `todo` uniquement, non trashée, non bloquée, sans attente
  humaine, prérequis `done`.
- **Contrôles après await** : Stop, pause du mandat, pause du cerveau et statut du cerveau
  sont revérifiés après la réponse du modèle, après la réparation et avant chaque action.
- **Modèle** : changement de modèle/effort → recyclage à la frontière suivante ; le
  modèle actif est publié dans `runtime.activeModel` à côté du modèle configuré.
- **Fallback cerveau** : bascule bornée sur `timeout`, `session_gone`, `no_session`,
  `followup_failed`, `session_create_failed` ; jamais sur un refus de politique ; budget
  horaire respecté.
- **Capacités** : les 13 actions sont publiées ; `create_task`/`update_task`/`comment`
  sont disponibles quand le token public local existe, sinon
  `taskboard_writes_unavailable`.
- **Contexte du cerveau** : cartes prêtes d’abord, puis attente humaine, puis le reste ;
  `ready`, `blocked`, `waitingForHuman`, `dependsOn` et le nombre de cartes omises sont
  transmis.

## 3. Vérifications

```powershell
# Taskboard
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vitest/vitest.mjs run
# Agent Board
node --check src/host/index.js
$testFiles = @(Get-ChildItem tests -Filter '*.test.js' -File | ForEach-Object FullName)
node --test @testFiles
```

Résultats au 12/11/2026 : Taskboard **93 fichiers / 1 242 tests**, Agent Board
**594 tests**, `tsc --noEmit` et `node --check` OK.

## 4. Limites et suites

- **A03 reste partiel** : `schedule` (modification d’une planification existante),
  `push_branch`, `open_pr`, `merge`, `delete_task`, `secrets`, `policy_change` n’ont
  toujours pas d’exécuteur dans le cycle du cerveau. Ils sont publiés indisponibles
  (raison explicite) et non simulés. Les actions critiques gardent leur décision humaine.
- **A14** : la relance manuelle permissive est un geste opérateur ; aucune intégration
  automatique ne doit l’utiliser. Une séparation route manuelle / route automatique reste
  à décider.
- **A13** : la borne de 25 cartes demeure ; le tri et la troncature explicite évitent la
  cécité silencieuse, pas la limite de contexte.
- **Token public local** : l’Agent Board lit `$DSH_HOME/taskboard/public-api.token`
  (0600) pour les écritures. C’est un secret local de même utilisateur ; le fichier ne
  doit pas être partagé. Sans lui, les écritures sont indisponibles, jamais silencieuses.
- **Validation réelle** : les tests utilisent des hôtes et ledgers isolés, pas le GUI
  authentifié ni un fournisseur LLM réel. Les artefacts doivent être reconstruits et
  rechargés avant un essai de bout en bout.

## 5. Comportements à connaître

- Une carte `waitingForHuman` n’est plus claimable par l’API publique et ne part plus en
  exécution automatique ; une relance manuelle reste possible.
- Un one-shot interrompu après démarrage reste en `scheduled` avec
  `execution.recoveryRequired` et un commentaire système ; il ne repart qu’après une
  relance manuelle explicite.
- Une permission explicite non applicable fait échouer le démarrage au lieu d’hériter
  d’un preset plus large.
- Le sync externe global n’est plus accessible depuis un outil agent ; le push d’une
  carte reste possible dans le projet de la session.
