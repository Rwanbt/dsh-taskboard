# Audit Taskboard + Agent Board / Super Orchestrator

> **Mise à jour du 12/11/2026** : les corrections sont appliquées et couvertes par des
> tests de régression. Voir [`REMEDIATION-2026-11-12.md`](REMEDIATION-2026-11-12.md).
> A03 reste partiel (création/modification/commentaire opérationnels ; les autres
> actions sont honnêtement indisponibles) et A14 reste une décision de contrat.

Date : 12 novembre 2026. Verdict initial : **non prêt pour une autonomie complète et fiable**. Les cases de permission expriment des autorisations, pas toutes des capacités implémentées. Plusieurs chemins contournent les conditions de préparation ; la reprise et le contrôle du Super Agent présentent des défauts reproductibles.

## Périmètre et niveau de preuve

- Taskboard 0.13.0, commit `e722c28e1336cb47215acede457985837ffe1a85` ; dépôt et cible du lien installé : `D:\App\dsh-taskboard`.
- Agent Board 0.1.0, commit `caf41c0218a17d6f3aed0cbc4a934b61ddba00a0` ; source résolue du plugin monté : `D:\App\DSH-agent-board`.
- Les deux plugins sont actifs d’après l’inventaire runtime. Découverte des contrats DSH par Inspect, notamment `agents.create/get`.
- Audit code : UI de permissions, mandat, autorisation de lancement, boucle LLM, dispatch déterministe, sessions, permissions d’exécution, outils, routes, scheduler, API externe et réconciliation.
- **R** : reproduit avec les vrais modules, dans un hôte simulé/ledger temporaire, sans appel de modèle ni données utilisateur. **C** : établi par lecture du chemin de code ; scénario dégradé non provoqué sur l’installation réelle.
- L’accès HTTP direct au GUI existant est refusé par son contrôle de connexion (`unauthorized`). Ce refus est un garde-fou, pas un bug. Pas de contournement ni récupération de cookie. L’affichage et les valeurs exactes du mandat utilisateur ne sont donc pas certifiés dans le navigateur ; aucune prétention de validation E2E réelle du GUI.
- Aucun code de production, mandat utilisateur ou profil n’a été modifié. Les seuls ajouts au dépôt sont ce rapport et deux probes d’audit. Une réparation Windows distincte, autorisée, a été nécessaire avant les tests (annexe).

## Résumé priorisé

| ID | Priorité | Preuve | Blocage / risque |
|---|---|---|---|
| A01 | P0 | R | Le cycle LLM lance une carte backlog, bloquée, en attente humaine, avec prérequis manquant |
| A02 | P0 | C | Une permission d’exécution qui échoue à s’appliquer n’empêche pas le démarrage |
| A03 | P1 | R | Presque toutes les actions mutantes proposées par le Super Agent n’ont pas d’exécuteur |
| A04 | P1 | R | Réconciliation hôte invalide une exécution externe encore active ; completion refusée |
| A05 | P1 | R | Pause du Super Agent pendant l’analyse n’empêche pas son lancement ultérieur |
| A06 | P1 | R | Modèle enregistré changé, mais session et cycle suivants restent sur l’ancien modèle |
| A07 | P1 | C | Fallbacks du cerveau enregistrés sans mécanisme de bascule du cerveau |
| A08 | P1 | C | Scheduler/exécuteur Taskboard ne respectent pas blocked/waitingForHuman uniformément |
| A09 | P1 | C | One-shot interrompu : retour todo sans échéance ni remise en file automatique |
| A10 | P1 | C | Checklist modifiable par une session d’un autre projet |
| A11 | P1 | C | Outil de synchronisation externe non borné au projet appelant |
| A12 | P2 | C | Capacités UI incomplètes et parfois plus optimistes que le cycle réel |
| A13 | P2 | C | Contexte du cerveau limité aux 25 premières cartes, sans rotation explicite |
| A14 | P2 | C | Le lancement manuel permissif est réutilisable par intégration : sémantique à séparer |
| A15 | P1 | R | Carte reconnue manuellement : rapport structuré impossible sans exécution rattachable |

P0 = condition à fermer avant d’autoriser l’autonomie sur du travail réel. P1 = fonctionnalité essentielle ou reprise non fiable. P2 = ergonomie, échelle et cohérence qui rendent le diagnostic difficile. Ce classement porte sur les chemins accessibles sous leurs préconditions, pas sur une exploitation distante non authentifiée.

## 1. Permissions par action : matrice effective

Les 13 cases proviennent d’[Agent Board — hierarchy.js:634–648](<D:/App/DSH-agent-board/src/client/ui/hierarchy.js#L634-L648>), et non de Taskboard. Le contrat de niveau est dans [mandate.js:59–92](<D:/App/DSH-agent-board/src/contracts/mandate.js#L59-L92>).

| Action | Niveau minimal | Réalité du cycle autonome actuel |
|---|---|---|
| Lancer une session | L2 avec approbation ; L3/L4 sans approbation courante | Exécuteur présent, mais défaut A01 |
| Commenter | L3 | Aucun exécuteur du cycle ; route GitHub séparée possible si configurée |
| Créer une tâche | L3 | Aucun exécuteur du cycle ; création GitHub séparée possible, pas création Taskboard par le cycle |
| Modifier une tâche | L3 | Aucun exécuteur du cycle |
| Déléguer | L4 | Aucun dispatch d’action `delegate` du cycle ; ne pas confondre avec les métadonnées de délégation des lancements |
| Planifier | L3 | Aucun exécuteur du cycle |
| Pousser une branche | L3 | Aucun exécuteur du cycle |
| Ouvrir une PR | L4 | Route GitHub séparée, pas exécutée par le cycle LLM |
| Fusionner | L4 + décision humaine par occurrence | Aucun exécuteur du cycle |
| Écrire sur branche protégée | L4 + décision humaine | Aucun exécuteur du cycle |
| Supprimer une tâche | L4 + décision humaine | Aucun exécuteur du cycle |
| Accéder aux secrets | L4 + décision humaine | Aucun exécuteur du cycle |
| Modifier la politique | L4 + décision humaine | Aucun exécuteur du cycle |

Une case cochée ne peut pas lever un scope absent, un projet désactivé, un niveau insuffisant, Stop, une pause du mandat ou une décision critique obligatoire. Ces intersections sont intentionnelles. En revanche, une autorisation sans exécuteur ne satisfait pas l’objectif demandé d’un Super Orchestrator utilisable.

### A03 — Chaîne d’action interrompue après autorisation

**Preuve R** : le probe donne au mandat L4 `create_task:true`, fait proposer cette action, et observe `no_adapter_for_action`. Le résultat n’est pas une création.

- [index.js:1353–1362](<D:/App/DSH-agent-board/src/host/index.js#L1353-L1362>) : `IMPLEMENTED_ACTIONS` contient uniquement `launch`.
- [index.js:3103–3132](<D:/App/DSH-agent-board/src/host/index.js#L3103-L3132>) : après autorisation, seul `launch` est routé ; toute autre mutation retourne `no_adapter_for_action`.
- [brain.js:40–55](<D:/App/DSH-agent-board/src/superagent/brain.js#L40-L55>) : le modèle reçoit néanmoins tout le vocabulaire d’actions.

**Autre manque structurel** : le schéma de proposition contient action/projet/taskId/rationale/risque/effet, mais aucun payload opérationnel complet (titre/corps de nouvelle carte, patch versionné, branche/head/base de PR, échéance de planification). Brancher un simple switch ne suffit donc pas.

**Correction attendue** : contrat typé par action, registre unique `schema + authorize + readiness + execute + receipt`, payloads validés, concurrence/version, idempotence et audit. Implémenter les actions demandées ; en attendant, les afficher indisponibles, sans les présenter comme fonctionnelles.

### A12 — Le diagnostic de capacité ne représente pas toute la réalité

- [index.js:1353](<D:/App/DSH-agent-board/src/host/index.js#L1353>) : 10 actions dans la matrice publiée, contre 13 cases. `protected_branch_write`, `secrets`, `policy_change` n’y figurent pas.
- [inspector.js:683–709](<D:/App/DSH-agent-board/src/client/ui/inspector.js#L683-L709>) : faute de capability, l’UI retombe sur le mandat ; une case critique peut finir par signifier « approbation nécessaire » alors que l’exécuteur manque également.
- [index.js:1362–1415](<D:/App/DSH-agent-board/src/host/index.js#L1362-L1415>) : GitHub prêt peut rendre `comment/create_task/open_pr` disponibles, mais A03 reste vrai dans le cycle du cerveau.

**Correction** : distinguer explicitement « autorisation accordée », « implémenté », « intégration prête », « décision nécessaire » et « effectivement exécutable dans ce parcours ». Toutes les actions doivent avoir une entrée, et le même registre doit servir UI et exécution.

## 2. Lancement et contrôle du Super Agent

### A01 — Préparation de la carte non contrôlée au point de lancement

**Preuve R** : même hôte, vraie fonction `apply()`, backend board : une proposition visant une carte `backlog`, `blocked:true`, `waitingForHuman:true`, `dependsOn:['missing-prerequisite']` retourne `ok:true` et crée une session worker.

Le contrôle d’autorisation central [index.js:1574–1658](<D:/App/DSH-agent-board/src/host/index.js#L1574-L1658>) vérifie mandat, permissions, quota, session active, claim, planification et route. Il ne vérifie pas l’état todo, blocked, attente humaine ni les dépendances satisfaites. Le dispatch déterministe filtre des candidats, mais le cycle LLM appelle directement [launchTask:3120–3127](<D:/App/DSH-agent-board/src/host/index.js#L3120-L3127>). Le garde supplémentaire de [delegation.js:142–170](<D:/App/DSH-agent-board/src/orchestrator/delegation.js#L142-L170>) recherche notamment les cycles, pas les prérequis simplement non achevés.

**Impact** : travail prématuré, session créée sur carte non autorisée à exécuter, consommation de budget ; les outils de claim du worker peuvent ensuite refuser, mais trop tard pour garantir absence de démarrage. Le backend Taskboard peut refuser des prérequis supplémentaires ; le défaut est reproduit sur le backend board, pas affirmé identique pour tous les backends.

**Correction** : readiness unique, relue au dernier point avant effet et partagée par tick, assessment, approbation, dispatch, reprise. Vérifier taskId/projet réels, status, trash, blocked, waiting, dépendances, révision, claim et capacité. Tests négatifs séparés pour chaque condition, tous les backends.

### A05 — Pause du cerveau non réévaluée après attente du modèle

**Preuve R** : `/superagent/pause` est appelé avant de livrer la réponse du faux modèle. La réponse propose un lancement ; il se produit avec `ok:true`.

La pause locale est contrôlée en début de cycle [index.js:2987–3003](<D:/App/DSH-agent-board/src/host/index.js#L2987-L3003>), mais l’autorisation de lancement lit seulement la pause du mandat, pas le statut local du Super Agent [index.js:1339–1350](<D:/App/DSH-agent-board/src/host/index.js#L1339-L1350>). Après la réponse, le cycle continue et finit même par remettre le statut à idle [index.js:3193–3194](<D:/App/DSH-agent-board/src/host/index.js#L3193-L3194>).

**Correction** : génération/epoch de cycle, annulation ou invalidation à pause/stop/recycle/changement de mandat ; revalidation après chaque await et avant chaque mutation. Ne pas convertir une pause récente en idle. Tester séparément Stop global, Stop cerveau, pause cerveau, pause mandat et course avec création de session.

### A06 — Modèle choisi non appliqué au cycle suivant

**Preuve R** : première session avec modèle `one`, sauvegarde réussie du modèle `two`, deuxième cycle : une seule session existe toujours avec `agentOptions.model === 'one'`.

- [index.js:2839–2845](<D:/App/DSH-agent-board/src/host/index.js#L2839-L2845>) réutilise la session active sans comparer le modèle configuré.
- [index.js:3912–3924](<D:/App/DSH-agent-board/src/host/index.js#L3912-L3924>) enregistre le nouveau modèle « next_session », sans demander le recyclage à la frontière suivante.

**Correction** : exposer modèles configuré et réellement actif séparément ; marquer `recycleRequested` à modification, recycler entre cycles. Ne jamais interrompre une mutation déjà autorisée sans état de reprise.

### A07 — Fallbacks du cerveau décoratifs

**Preuve C** : les fallbacks sont validés et persistés [index.js:3893–3918](<D:/App/DSH-agent-board/src/host/index.js#L3893-L3918>), mais [superagentModel:2792–2795](<D:/App/DSH-agent-board/src/host/index.js#L2792-L2795>) retourne le modèle de l’identité ; la création utilise uniquement provider/model/effort [index.js:2853–2867](<D:/App/DSH-agent-board/src/host/index.js#L2853-L2867>). Les erreurs de cycle conduisent à un backoff, pas à une marche dans cette liste. Ne pas confondre les mécanismes de failover des workers, qui existent, avec ceux du cerveau.

**Correction** : même routeur borné pour le cerveau, causes retryables distinguées des refus de politique, cooldown, plafond d’essais, checkpoint et affichage de la route réellement utilisée. Un refus d’autorisation ne doit jamais déclencher une bascule destinée à le contourner.

### A13 — Cartes invisibles au cerveau à partir du rang 26

**Preuve C** : [index.js:3048–3055](<D:/App/DSH-agent-board/src/host/index.js#L3048-L3055>) transmet `scopedTasks.slice(0,25)` sans pagination/rotation ni sélection par préparation dans ce chemin. Le modèle reçoit aussi un sous-ensemble de champs, sans dépendances/blocked/waiting. Un grand historique placé devant les cartes prêtes peut cacher le travail utile à chaque cycle. Le scheduler déterministe peut encore traiter des cartes : ce n’est pas une preuve que tout le système est bloqué à 25.

**Correction** : projection de travail triée et équitable, candidats prêts + vrais blocages + compte de troncature et curseur. Ne pas compenser en supprimant les limites de contexte.

## 3. Permissions Taskboard et frontières de projet

### A02 — Application de permission fail-open

**Preuve C** : [index.ts:274–282](<../src/index.ts#L274-L282>) ignore service/session absents et exceptions du service de permission ; [execution.ts:861–866](<../src/host/execution.ts#L861-L866>) poursuit aussi après exception. Côté Agent Board, [index.js:1718–1735](<D:/App/DSH-agent-board/src/host/index.js#L1718-L1735>) englobe permission et éléments cosmétiques dans un catch silencieux.

**Scénario** : carte read-only, setter absent/en erreur : exécution possible avec preset préexistant/par défaut plus permissif. Non déclenché sur une vraie session utilisateur ; le risque dépend de cette configuration dégradée.

**Correction** : permission sécurité ≠ cosmétique. Appliquer dans le setup de création avant disponibilité du worker, lire et vérifier le résultat effectif, refuser et annuler proprement si impossible. Tester read-only/workspace-write/full-access, setter absent, setter qui lève, mismatch de lecture et session réutilisée.

### A10 — Checklist interprojet

**Preuve C** : [tools.ts:1319–1365](<../src/host/tools.ts#L1319-L1365>) contrôle version et archivage, mais n’appelle pas la garde de projet utilisée par update [tools.ts:917–926](<../src/host/tools.ts#L917-L926>).

**Scénario** : session du projet A connaissant ID/version de B peut ajouter/cocher/décocher sa DoD. Cela peut falsifier les indicateurs de préparation à l’acceptation ; cela ne permet pas, à lui seul, de passer done.

**Correction** : contrôler projet et droit d’écriture dans la mutation atomique ; tests interprojets pour add/check/uncheck et pour une session autre que le détenteur du claim.

### A11 — Synchronisation externe sans périmètre appelant

**Preuve C** : [tools.ts:1500–1508](<../src/host/tools.ts#L1500-L1508>) n’utilise aucun contexte d’appel, lance `sync()` global ou `pushTask(id)`. La configuration du connecteur n’est pas une autorisation de la session sur tous les projets.

**Scénario** : session A peut pousser B vers un tracker configuré en bidirectionnel. Aucune écriture distante n’a été faite durant l’audit.

**Correction** : périmètre explicite dérivé de l’appelant, vérifié avant chaque effet local/distant ; réserver le sync global à une action opérateur dédiée ; essais avec faux transport prouvant zéro requête interdite.

## 4. Attentes, planification et reprise

### A04 — Exécution externe invalidée au redémarrage

**Preuve R** : le test appelle les vrais `PublicApiService`, `ExecutionService` et `TaskStore` avec ledger temporaire :

1. claim distant → HTTP 201, `managedBy:'external'`, outcome running ;
2. `reconcile()` sans agent DSH local → outcome failed, erreur `interrupted by host restart`, carte todo, claim supprimé ;
3. completion distante succeeded → HTTP 409 `version_conflict`, `execution already settled with another outcome`.

L’enveloppe devient failed mais `attempts[0].outcome` reste running.

L’API admet une exécution externe sans session DSH [public-api.ts:376–381](<../src/host/public-api.ts#L376-L381>), tandis que la réconciliation considère tout running non adopté localement comme interrompu [execution.ts:1280–1321](<../src/host/execution.ts#L1280-L1321>).

**Correction** : lifecycle externe distinct avec lease/heartbeat/fencing durable ; absence d’agent local ≠ décès du worker distant. Expirer selon son contrat, de façon cohérente dans enveloppe et attempts. Tests de redémarrage, hôte indisponible, worker réellement mort, reprise et completion tardive.

### A08 — blocked et waitingForHuman non uniformes

**Preuve C** : le gate d’exécution [execution.ts:637–698](<../src/host/execution.ts#L637-L698>) vérifie status pour scheduled/comment, dépendances et claim, mais pas blocked/waitingForHuman. La mise en file [scheduler.ts:333–343](<../src/host/scheduler.ts#L333-L343>) ne filtre que statut/trash pour ce point d’entrée. Le claim public respecte blocked [public-api.ts:369–373](<../src/host/public-api.ts#L369-L373>), mais pas explicitement waitingForHuman.

**Correction** : définir contractuellement « indicateur » versus « interdiction d’exécuter ». Avec la sémantique utilisateur actuelle d’attente humaine, aucun chemin automatique ne doit relancer silencieusement la carte ; un éventuel forçage manuel doit être explicite, distinct, journalisé.

### A09 — One-shot muet après crash de son exécution

**Preuve C** : le scheduler consomme runAt lors de l’enqueue [scheduler.ts:333–343](<../src/host/scheduler.ts#L333-L343>), puis le gate consomme dispatchingRunAt [execution.ts:687–690](<../src/host/execution.ts#L687-L690>). La réconciliation remet todo sans réarmer ni convertir proprement en claim [execution.ts:1305–1318](<../src/host/execution.ts#L1305-L1318>). Une fois ces fenêtres consommées, aucun prochain événement ne subsiste pour ce one-shot.

**Correction** : politique explicite de reprise, sans replay aveugle d’effets : interrupted + diagnostic/action récupérable, nouvelle tentative avec idempotence et consentement conforme au mandat, ou conversion visible en todo manuel. Tester les crashs entre chaque transition durable.

### A14 — Relancer manuellement n’est pas équivalent à démarrer automatiquement

**Preuve C** : [routes.ts:1455–1469](<../src/host/routes.ts#L1455-L1469>) délègue directement le run ; [execution.ts:631–653](<../src/host/execution.ts#L631-L653>) précise volontairement que les reruns manuels gardent leur sémantique. Cela permet de reprendre des cartes autres que todo, contrairement au claim public strict.

Il s’agit d’abord d’une **décision de contrat à clarifier**, pas d’une preuve que les reruns humains sont un bug. Le risque apparaît quand une intégration automatique réutilise une route manuelle permissive. Séparer les commandes et tester les états backlog/done/canceled/archived, sans supprimer la possibilité humaine de reprendre du travail.

### A15 — Parcours claim manuel → rapport structuré interrompu

**Preuve R sur la carte d’audit elle-même** : après création, lecture et claim via `taskboard_move(todo→in_progress)`, le travail et la checklist sont disponibles, mais `taskboard_execution_report` refuse : `no running execution and no settled execution of yours to report on`. Le claim manuel n’a créé aucun enregistrement d’exécution auquel rattacher le rapport. La discipline demandant de soumettre ce rapport avant in_review est donc impossible dans ce parcours pourtant exposé aux agents. Le compte rendu a été conservé en commentaire ; aucune exécution fictive n’a été créée.

**Correction** : définir un vrai lifecycle d’exécution pour les claims manuels, ou un rapport de tâche versionné distinct des rapports d’exécution. Ne pas demander aux agents de lancer une deuxième session uniquement pour obtenir une enveloppe. Test E2E outil : create → read → claim → checklist → report → in_review, avec un unique propriétaire et sans duplication d’exécution.

## 5. Ce qui fonctionne / garde-fous à conserver

- Mandat restrictif par défaut ; liste vide ne signifie pas tous les projets.
- Scope, activation projet, niveaux, action accordée, quotas et approbations sont des conditions distinctes.
- Le contrat pur du mandat refuse correctement launch hors scope et delegate non accordé.
- Certaines actions critiques nécessitent volontairement une décision humaine même en L4.
- Taskboard done et satisfaction d’un prérequis restent une acceptation humaine ; in_review ne suffit pas. Une autonomie intégrale incluant l’acceptation finale nécessiterait une évolution de produit et une autorisation explicite, pas un contournement.
- API publique sans token : indisponible ; token invalide : refus. Ne pas désactiver cette protection pour résoudre des problèmes de connecteur.
- Worktree, auto-commit de settlement, idempotence, contrôle des versions, races Stop et reprise de workers possèdent déjà une couverture substantielle. Les résultats verts ne prouvent pas les chemins manquants ci-dessus.

## 6. Tests exécutés et reproductibilité

| Vérification | Résultat |
|---|---|
| Suite Taskboard avant ajout du probe | **91 fichiers, 1 227 tests réussis** |
| TypeScript Taskboard, avant et après ajout du probe | **OK** (fixture ajustée pour fournir `attach`) |
| Suite Agent Board, fichiers `tests/*.test.js` | **588 tests réussis** |
| Probe Super Agent | **4 anomalies reproduites** |
| Probe réconciliation externe | **1 test réussi reproduisant le défaut** |
| git diff --check | **OK** |

Artefacts :
- [audit-superagent-20261112.mjs](<../scripts/qa/audit-superagent-20261112.mjs>) : create_task non exécuté, modèle non appliqué, carte non prête lancée, pause en course ignorée. Le chemin d’import Agent Board est local à cette installation ; l’adapter pour exécuter ailleurs.
- [audit-external-reconcile.spec.ts](<../tests/qa/audit-external-reconcile.spec.ts>) : invalidation de claim externe par réconciliation.

```powershell
node scripts/qa/audit-superagent-20261112.mjs
node node_modules/vitest/vitest.mjs run tests/qa/audit-external-reconcile.spec.ts
node node_modules/vitest/vitest.mjs run
node node_modules/typescript/bin/tsc --noEmit
# Dans le dépôt Agent Board, Node 24 ne résout pas « --test tests/ » ici :
$testFiles = @(Get-ChildItem tests -Filter '*.test.js' -File | ForEach-Object FullName)
node --test @testFiles
```

Les probes sont des **caractérisations du défaut actuel** : leur succès confirme les anomalies, il ne les corrige pas. Après correction, les convertir en tests exigeant le comportement sûr. Les hôtes simulés ne prouvent ni la connexion réelle d’un fournisseur LLM ni le rendu du GUI. Les avertissements de certificat local manquant n’ont pas fait échouer les suites ; aucune confiance TLS n’a été désactivée.

## 7. Plan de remédiation et acceptation

### Lot 1 — Sécuriser les points d’effet (P0)
1. Readiness universelle et atomique avant chaque lancement (A01/A08/A14).
2. Application et vérification fail-closed de la permission avant exposition du worker (A02).
3. Époques de contrôle du cerveau et revalidation après await (A05).
4. Garde workspace checklist/sync, avec faux transport attestant zéro effet interdit (A10/A11).

**Acceptation** : matrice de tests `source × backend × état × scope × permission`, y compris course avec pause/Stop/changement de mandat. Zéro session, carte, push ou budget consommé en cas de refus avant effet.

### Lot 2 — Rendre les permissions réellement exécutables
5. Un seul registre exhaustif pour les 13 actions, avec schema, autorisation, disponibilité, exécuteur et receipt.
6. Brancher création/modification/commentaire Taskboard, délégation et planification.
7. Brancher push et PR sur les bons adaptateurs et les propositions du cerveau, pas seulement des routes UI.
8. Implémenter les actions critiques avec décision humaine attachée à l’effet exact, à usage unique. « secrets » doit désigner des opérations minimales et bornées, jamais une exposition générale de credentials au modèle.

**Acceptation** : chaque case donne lieu à un parcours positif testable ; décochée, elle provoque zéro effet pour la même requête. Si précondition manquante, UI et API publient la même cause. Tester replay, timeout après effet distant, annulation et redémarrage.

### Lot 3 — Fiabilité en autonomie prolongée
9. Lifecycle/lease externe durable et cohérence attempts/enveloppe (A04).
10. Reprise explicite des one-shots sans double effet (A09).
11. Recyclage entre cycles lors d’un changement de modèle et vrai fallback du cerveau (A06/A07).
12. Contexte équitable/paginé et évaluation des grands portefeuilles (A13).

**Acceptation** : scénarios sur 1/3/30 projets, plus de 25 cartes, erreurs 429/503, quota épuisé, credentials refusés, worker distant toujours vivant, hôte redémarré et reprise après délai. Aucun retry infini ni élargissement du mandat.

### Lot 4 — Validation dans l’installation réelle
13. Construire les artefacts affectés et vérifier leur version chargée ; ne pas confondre source modifiée et plugin effectif.
14. Tester sur le GUI existant après refresh, avec un projet bac à sable explicitement choisi, fournisseur réel autorisé et effets externes simulés d’abord.
15. Vérifier les 13 permissions une à une, pause/Stop accessibles, raisons lisibles et rapport de chaque effet. Puis scénario autonome prolongé avec redémarrage contrôlé.

**Critère final** : aucune fonction annoncée seulement décorative ; cycle complet proposition → contrôle → effet → receipt → rapport → reprise. L’acceptation humaine finale et les actions critiques restent des frontières explicites. L’audit seul ne permet pas de déclarer le produit corrigé ou entièrement autonome.

## Annexe — Blocage Windows rencontré pendant l’audit

Le premier lancement PowerShell confiné échouait avant la commande lors de la préparation des droits du workspace. Le diagnostic autorisé hors confinement a observé `WRITE_DAC=true`, `WRITE_OWNER=false` sur le workspace, ajouté une entrée FullControl pour l’utilisateur courant à ce seul dossier autorisé, puis vérifié les deux droits. Aucun propriétaire ni contenu de fichier modifié ; aucune entrée de paquet étrangère détectée lors du scan. `git status --short` confiné a ensuite réussi. Ce problème ne démontre pas un défaut des cases de permission Agent Board.

Rapport : [journal de diagnostic](<D:/App/dsh-taskboard-permission-recovery/acl-report-4765a81538214afc9b0f6ebf48b37e2f.jsonl>).

Commande de récupération fournie par l’outil (ne pas exécuter sauf intention de restaurer les permissions antérieures) :

```powershell
pwsh -NoProfile -File 'D:\App\dsh-taskboard-permission-recovery\acl-backup-cfead2ea54a3411ab458914292c960d6.json.ps1' -Path 'D:\App\dsh-taskboard' -AllowRoot 'D:\App\dsh-taskboard' -Restore 'D:\App\dsh-taskboard-permission-recovery\acl-backup-cfead2ea54a3411ab458914292c960d6.json'
```
