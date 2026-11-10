# Rapport de livraison — Task Board 0.12.0 « synchronisation universelle »

**Date :** 2026-11-10
**Branche de travail :** `feat/universal-sync` (issue de `main`, lui-même `dev` + les deux
commits GitHub non poussés)
**Branche de référence :** `dev` (`775c1f1`, v0.10.2)
**Version :** `0.12.0` (non publiée, non taguée)
**Verdict : `PARTIAL`** — le socle P0 est livré et testé ; la couverture de toutes les
forges/plateformes demandées n'est pas complète et aucune compatibilité production n'a
été validée avec de vrais credentials.

---

## 1. Commits et état Git

| Commit | Contenu |
| --- | --- |
| `4f5aea8` | Contrat d'adaptateur v1, multi-connexions, identité canonique, write-back explicite, migration |
| `6f75d11` | Contrat public Agent Board v1, adaptateurs GitLab + Gitea/Forgejo |
| commit final | Adaptateurs Jira/Linear, preview, webhooks signés, UI multi-connexions, sécurité, docs, version 0.12.0 |

État : branche propre après le commit final ; `dev` reste l'ancêtre direct (merge
fast-forward possible). Aucun push distant, aucun tag, aucune release.

## 2. Ce qui est livré

### P0 — architecture et synchronisation

- **Contrat d'adaptateur versionné** (`ADAPTER_CONTRACT_VERSION = 1`) : opérations
  déclaratives, directions, événements, webhook, limites, autorité de champ.
  `assertProviderContract()` vérifie à l'instanciation que chaque opération déclarée est
  réellement implémentée et qu'aucune écriture n'est exposée sans déclaration.
- **Multi-connexions** : jusqu'à 10 connexions indépendantes, migration automatique de
  l'ancien fichier `{config}`, métadonnées par connexion, synchronisation ciblée,
  agrégation des compteurs et isolation des échecs.
- **Identité canonique** : `TaskRecord.externalRefs` (system/instance/kind/project/id/url/
  revision/state/provenance/primary), `task.external` restant la source de synchronisation.
- **Write-back explicite** : `direction: "inbound"` par défaut ; `bidirectional` requis
  pour écrire, en plus de la capacité `outbound` de l'adaptateur. `SyncPreview` expose ce
  qui serait créé/lié/mis à jour/en conflit/poussé **sans écrire**.
- **Conflits et autorité** : merge à trois voies, autorité configurable, conflit persistant
  qui bloque le push du champ concerné ; jamais d'écrasement d'une note humaine.
- **Anti-doublon** : adoption des cartes existantes par `#N`, première URL `/issues/N` ou
  titre normalisé ; ambiguïté signalée, jamais devinée.
- **Webhooks signés** (GitHub/GitLab/Gitea/Forgejo) : HMAC ou token partagé, déduplication
  par delivery id, charge utile **non appliquée** (déclenche un pull autoritaire), ce qui
  rend doublons et événements hors ordre inoffensifs.
- **Adaptateurs réels** : GitLab (REST v4), Gitea/Forgejo (API v1), Jira Cloud (REST v3 +
  ADF), Linear (GraphQL) ; GitHub et ZenTao/TAPD conservés.

### P0 — contrat Agent Board

- API `/dsh-taskboard/public/v1` à jeton Bearer (`DSH_TASKBOARD_PUBLIC_TOKEN`), **503 si
  non configurée**.
- Lecture : projets, tâches (filtre `eligible`), dépendances, exécutions, événements
  normalisés (`/events`, SSE `/events/stream`).
- Cycle de vie : `claim` atomique + `idempotencyKey`, binding de session, `attempts`,
  `handoff` avec `fencingToken`, `report`, `complete`, `interrupt`.
- Garanties : `done` inatteignable, exécutions `managedBy:"board"` refusées, claim lié à
  l'acteur, fencing obligatoire après handoff, événements bornés avec `resync` explicite
  après redémarrage.
- Document contractuel : `docs/AGENT-BOARD-CONTRACT.md`. Task Board fonctionne sans Agent
  Board ; aucun second registre n'est introduit.

### P1 — ergonomie, sécurité, maintenance

- Gestionnaire de connexions dans les réglages : liste, état, activation, édition,
  suppression, synchro par ligne, sens de synchronisation, capacités réelles.
- i18n zh/en/ru complété (providers et gestionnaire).
- Audit sécurité indépendant : `docs/SECURITY-REVIEW.md` (2 P1 + 7 P2), **tous corrigés**
  et couverts par des tests de non-régression.
- Documentation : `docs/ADAPTER-CONTRACT.md`, `docs/AGENT-BOARD-CONTRACT.md`,
  `docs/UNIVERSAL-SYNC-AUDIT.md`, README/README_en et changelog.

## 3. Tests et build

| Vérification | Résultat |
| --- | --- |
| `npm run typecheck` | **OK** |
| `npm run build` | **OK** (host ESM + client) |
| `npm test` | **90 fichiers, 1223 tests, 100 % verts** |
| E2E git réels | worktree/mirror/auto-commit/#94 rejoués, verts |
| Sécurité | 37 + 28 tests dédiés, verts |
| Contrat public | 12 tests dédiés + 37 tests sécurité |
| Adaptateurs | GitHub/GitLab/Gitea/Jira/Linear : suites dédiées, `fetch` factice |

> Un timeout intermittent de `tests/issue-94.spec.ts` a été observé une fois sous charge
> parallèle (5 s), puis rejoué vert seul et dans la suite complète. Il reste visible et
> n'a pas été retiré.

## 4. Connecteurs : ce qui est réellement validé

| Connecteur | Validation | Écriture | Limites connues |
| --- | --- | --- | --- |
| ZenTao | mock + validation réelle **antérieure** en lecture seule | non | mapping projet/exécution, token hérité refusé |
| TAPD | mock | non | — |
| GitHub | mock | oui (opt-in) | Issues seulement |
| GitLab | mock | oui (opt-in) | self-hosted = URL API complète ; Issues seulement |
| Gitea/Forgejo | mock | oui (opt-in) | Issues/Pull requests ignorées |
| Jira Cloud | mock | oui (opt-in) | Cloud uniquement, ADF partiel, `not_planned` non distingué |
| Linear | mock | oui (opt-in) | identifiants humains (`ENG-12`) ; résolution UUID non implémentée |

**Aucune compatibilité production n'est affirmée** pour les connecteurs validés uniquement
en simulation. Bitbucket, Azure DevOps, Trello, GitHub Projects et GitLab Boards ne sont
**pas implémentés et ne sont pas annoncés** comme supportés.

## 5. Migration et retour arrière

- Fichier de connexions : `{connections: [...]}` avec miroir `config` de la connexion
  primaire ; un fichier `{config}` 0.10/0.11 est lu et migré sans perte de credentials ni
  de métadonnées.
- Ledger : ajout purement additif (`externalRefs`, `managedBy`, `fencingToken`,
  `attempts`, `idempotencyKey`, `externalActor`) ; aucun bump de `schemaVersion`, les
  anciens ledgers restent lisibles.
- Retour arrière pragmatique : une version 0.11 peut relire la connexion primaire via le
  miroir `config`, mais **ignore les connexions supplémentaires** et les nouveaux champs
  d'exécution. Une sauvegarde du fichier de connexions et du ledger avant montée est
  recommandée. Aucune migration destructive n'est exécutée.

## 6. Installation / activation

```bash
npm run build
dsh plugin --profile web add "link:D:\App\dsh-taskboard"
# redémarrer dsh web pour la moitié host
# API Agent Board (optionnelle) :
export DSH_TASKBOARD_PUBLIC_TOKEN="long-random-token"
```

Sans jeton, l'API publique est désactivée (503) et le Kanban, le scheduler, les
exécutions, les validations et les connecteurs externes continuent de fonctionner.

## 7. Limites et travail restant

### Non livré (assumé)

- Bitbucket, Azure DevOps, Trello, GitHub Projects, GitLab Boards.
- Synchronisation des commentaires, labels, milestones, PR/MR et statuts CI.
- Circuit breaker persistant, file d'attente de synchronisation durable, historique
  complet des tours (seul le dernier résultat + erreur sont conservés).
- Validation réelle des connecteurs (aucun credential disponible).
- Webhooks : GitHub/GitLab/Gitea uniquement, pas de rejeu persistant (dédup en mémoire).

### Suites recommandées (P1/P2)

1. Valider chaque connecteur contre une instance réelle avec un compte de test dédié.
2. Ajouter Bitbucket/Azure DevOps puis Trello/GitHub Projects derrière le même contrat.
3. Persister un journal de synchronisation borné (audit multi-tours) et un circuit breaker.
4. Étendre le contrat public aux commentaires/pièces jointes si Agent Board en a besoin.

## 8. Verdict

**PARTIAL.** Le cœur P0 (contrat, multi-connexions, identité, write-back explicite,
conflits, preview, webhooks, API Agent Board) est livré, compilé, testé et audité, sans
régression connue. La mission « toutes les forges et plateformes » n'est pas achevée :
5 cibles sur 13 ne sont pas implémentées, et aucun connecteur n'a été validé en
production. Aucun P0 connu n'est ignoré ; le passage à `READY` exige la validation réelle
des connecteurs prioritaires et la couverture des cibles restantes.
