[![npm version](https://img.shields.io/npm/v/dsh-taskboard.svg)](https://www.npmjs.com/package/dsh-taskboard)
[![License](https://img.shields.io/npm/l/dsh-taskboard.svg)](https://github.com/cloader/dsh-taskboard/blob/main/LICENSE)

[English](./README_en.md) | **Français** | [简体中文](./README.md)

# dsh-taskboard

> **Contributions et pull requests** : créez une branche depuis `dev` pour les fonctionnalités, correctifs et changements de documentation, et fixez la branche de base de votre PR sur **`dev`**. `main` est la branche de publication stable protégée ; les mainteneurs intègrent les versions via une PR `dev → main`. La CI doit passer avant toute fusion dans `main`.

Un **plugin de tableau de tâches pour DeepSeek Harness** : l'humain crée des cartes, les agents les prennent en charge et les exécutent, l'humain vérifie et valide. Les tâches sont rattachées à des projets (= espaces de travail), acceptent un choix de modèle et de preset par tâche, et peuvent s'exécuter manuellement ou selon une planification cron — une collaboration complète, de la carte à la validation.

- **Boucle fermée** : l'humain crée une carte → l'agent la prend en charge et l'exécute → rapport de passation structuré → l'humain valide (✓ terminé / ✗ renvoyé avec une raison)
- **11 outils agent `taskboard_*`** et des verrous au niveau du code : un agent ne peut jamais déplacer une tâche vers *done*, une tâche déjà tenue ne peut pas être ravie, les prises en charge hors projet sont refusées
- **Exécution** : manuelle, planifiée en une fois, ou périodique côté hôte via cron (continue même navigateur fermé) ; une tâche planifiée peut réutiliser une session existante du projet choisi ; une tâche périodique peut revenir en todo à chaque tour ou conserver un enregistrement de revue et créer la carte todo suivante
- **Isolation par worktree Git** : chaque exécution travaille dans son propre worktree et sur une branche de tâche dédiée, avec fusion en un clic à la validation ; les espaces de travail multi-dépôts parallèles sont mis en miroir dans leur ensemble (0.6.3) ; les projets non git retombent automatiquement en mode sur place
- **Validation efficace** : listes de contrôle d'acceptation (DoD) avec cases cochées et preuves, rapports d'exécution structurés (résumé / fichiers modifiés / vérifications / artefacts / risques), visualiseur de diff intégré au tableau
- **Tableau en temps réel** : rafraîchissement SSE, flux en cinq colonnes, filtres et tri persistants, import/export JSON, modèles de tâches
- **Synchronisation externe** : ZenTao, TAPD, GitHub, GitLab, Gitea/Forgejo, Jira et Linear ; connexions multiples, mappage de projets, réécriture explicite, conflits au niveau du champ, aperçu de synchronisation et webhooks signés. Voir la section Synchronisation externe ci-dessous et la matrice de capacités dans [docs/ADAPTER-CONTRACT.md](./docs/ADAPTER-CONTRACT.md).
- **Contrat public Agent Board v1** : API optionnelle authentifiée par jeton Bearer (découverte du travail, prise en charge atomique, bascule en cas d'échec, passation de session, rapports, flux d'événements). Task Board reste toujours propriétaire du registre et de l'enveloppe d'exécution, et `done` reste réservé à l'humain ; voir [docs/AGENT-BOARD-CONTRACT.md](./docs/AGENT-BOARD-CONTRACT.md).

**Zéro configuration** : installez et c'est prêt — aucun jeton, aucune clé API, aucun service ni base de données supplémentaires.

## 0.12.0 — synchronisation universelle et contrat Agent Board (branche de développement, non publiée)

Cette branche transforme Task Board en couche de synchronisation pour le travail, les forges de code, les outils de planification et les exécutions. **La 0.12.0 n'est ni taguée ni publiée** ; la version stable reste v0.10.2.

- **Contrat d'adaptateur v1** : chaque fournisseur déclare sa version, ses opérations, directions, événements et limites ; la création vérifie que les opérations déclarées sont réellement implémentées et que les surfaces d'écriture sont déclarées, et le registre refuse toute version ou opération inconnue. Nouveaux adaptateurs : GitLab, Gitea/Forgejo, Jira Cloud, Linear. ZenTao/TAPD restent en lecture seule ; Bitbucket, Azure DevOps, Trello, GitHub Projects et GitLab Boards ne sont **pas implémentés et pas revendiqués**.
- **Connexions multiples** : jusqu'à 10 connexions indépendantes, avec migration de l'ancien fichier `{config}` ; chacune possède ses propres mappages, direction, identifiants et historique de synchronisation, et peut être synchronisée, activée/désactivée, modifiée ou supprimée séparément.
- **Synchronisation bidirectionnelle explicite** : lecture seule par défaut ; les écritures sortantes exigent `direction: "bidirectional"` **et** un adaptateur capable d'écrire. `/external/preview` prévisualise les créations, associations, mises à jour, conflits et envois avant d'activer les écritures. Titre/description/urgence passent par une fusion à trois voies par défaut ; le statut et les personnes assignées restent locaux ; les conflits sont conservés et bloquent ce champ.
- **Identité externe canonique** : `externalRefs` permet à une carte de référencer plusieurs éléments distants (système, instance, type, projet, id, URL, révision, état, provenance) tandis que `task.external` reste la source pilotant la synchronisation ; les anciens registres sont migrés au chargement.
- **Webhooks signés** : GitHub/GitLab/Gitea/Forgejo vérifient les signatures HMAC/secret partagé et dédupliquent les identifiants de livraison ; la charge utile déclenche seulement une récupération, donc des livraisons dupliquées ou dans le désordre ne peuvent pas corrompre l'état.
- **API publique Agent Board v1** : `/dsh-taskboard/public/v1` utilise l'authentification Bearer `DSH_TASKBOARD_PUBLIC_TOKEN` (503 si absent) pour projets/tâches/dépendances/exécutions/événements, plus prise en charge, clés d'idempotence, tentatives, passation avec clôture (fencing), rapports et complete/interrupt. Un succès ne mène qu'à `in_review` ; `done` reste réservé à l'humain.
- **Tests** : suites de contrat d'adaptateur, de connexions multiples, d'aperçu, de webhook, d'API publique, de non-régression de sécurité et d'interface multi-connexions ; `npm run build && npm test` passe.

## Fork Rwanbt — v0.10.2

Version stable : [v0.10.2](https://github.com/Rwanbt/dsh-taskboard/releases/tag/v0.10.2). Les changements sont fusionnés dans `main` et `dev` de ce fork ; le dépôt amont `cloader/dsh-taskboard` n'est pas modifié. Le badge npm et l'installation npm ci-dessous concernent l'amont, pas ce fork ; utilisez le [guide d'installation du fork](./docs/INSTALL-FORK.md).

- **Approbation explicite par l'utilisateur (0.10.1)** : un agent peut ajouter immédiatement des prérequis, mais les retirer ou supprimer un prérequis ayant des dépendants vivants ne fait qu'enregistrer une demande avec une raison obligatoire. Le graphe reste appliqué jusqu'à l'approbation de l'utilisateur dans l'interface ; l'agent peut continuer d'autres travaux. Les demandes apparaissent dans « En attente de moi », y compris sur des tâches terminées. Les mises à jour, suppressions et déplacements d'agent hors projet sont refusés.
- **Règlement du worktree (0.10.2)** : les agents doivent valider leur travail quand c'est possible. Si les limites du bac à sable l'empêchent, l'hôte valide le travail restant sur la branche de la tâche avant de collecter les preuves, avec l'identité `dsh-taskboard`. Les échecs de hooks sont signalés sans perdre les modifications ; les dépôts miroirs imbriqués sont traités séparément.
- **Indépendant du fournisseur** : les outils du tableau sont disponibles pour les sessions DSH quel que soit leur fournisseur de modèle, sous réserve du preset de session et des permissions du projet. Les tests sur hôte réel ont exercé Claude/Anthropic, GPT/Codex, Gemini/Google, Mistral et GLM/OpenCode. Gemini a atteint son quota fournisseur après avoir correctement enregistré une demande d'approbation.
- **Validation sur hôte réel** : le verrouillage par prérequis, l'approbation/le rejet, le refus hors projet, le report/rejeu du cron périodique, l'isolation par worktree, la fusion et le nettoyage sont documentés dans le [rapport E2E](./docs/E2E-REAL-HOST-0.10.1.md). Ce sont des scénarios bornés, pas une garantie de production exhaustive.

Ce fork ajoute ce qui suit à l'amont. Conception complète : [docs/dependencies-lite.md](./docs/dependencies-lite.md), audit et critères d'acceptation : [docs/fork-audit.md](./docs/fork-audit.md), guide d'installation : [docs/INSTALL-FORK.md](./docs/INSTALL-FORK.md).

- **Dépendances entre tâches** : une tâche peut lister des prérequis du même projet (`dependsOn`) ; elle ne peut être prise en charge, exécutée ni planifiée tant que chaque prérequis n'a pas été approuvé `done` par un humain. Les cycles, auto-références et liens hors projet sont refusés. Quand un prérequis est mis à la corbeille, le lien est retiré et un commentaire d'audit est écrit, au lieu de laisser la tâche bloquée pour toujours.
- **Sous-tâches** : `parentId` construit un arbre (profondeur maximale 8, sans cycle). Les cartes affichent la progression `fait/total`, le panneau de détail montre un fil d'Ariane et la liste des enfants.
- **Sélecteur de prérequis** : combobox avec recherche et navigation clavier (titre ou identifiant), avec un avertissement pour les références introuvables.
- **Design system DSH** : chaque couleur, rayon et ombre provient des jetons `--dsw-*` (clair et sombre). Les éléments `<select>` natifs sont remplacés par un `Select` thémé et accessible (popup rendu sur `<body>`, support clavier complet). Le tableau utilise une mise en page sans bordures (ton et élévation au lieu de contours) et un jeu d'icônes SVG monochromes au lieu d'émojis.
- **Robustesse** : le verrou du registre traite désormais les erreurs Windows transitoires `EPERM`/`EACCES`/`ENOENT` comme de la contention et réessaie.

Tests : `npm run build && npm test` (90 fichiers, 1223 tests en v0.12.0 ; 74 fichiers, 1026 tests en v0.10.2). La CI est passée sur Node 22 et 26 avant publication. Couverture : `npm run test:coverage` ; le [rapport de couverture](./tests/qa/COVERAGE.md) enregistre une base antérieure à 975 tests (~88,6 % de lignes), pas une mesure fraîche de la v0.10.2.

## Captures d'écran

<p align="center"><img src="https://raw.githubusercontent.com/cloader/dsh-taskboard/main/img/board.png" alt="Tableau de tâches" width="880"></p>

<p align="center"><img src="https://raw.githubusercontent.com/cloader/dsh-taskboard/main/img/modal.png" alt="Boîte de dialogue nouvelle tâche" width="440"></p>

## Sommaire

- [Prérequis](#prérequis)
- [Installation](#installation)
- [Démarrage rapide](#démarrage-rapide)
- [Référence des outils agent](#référence-des-outils-agent)
- [Fonctionnalités](#fonctionnalités)
- [Sécurité](#sécurité)
- [Configuration et données](#configuration-et-données)
- [FAQ](#faq)
- [Développement](#développement)
- [Journal des modifications](#journal-des-modifications)

## Prérequis

| Dépendance | Exigence | Remarques |
| --- | --- | --- |
| DeepSeek Harness | ≥ 0.1.7 | Nécessite le support officiel des panneaux et le profil web |
| Node.js | ≥ 22 | Pour le développement local et les compilations depuis les sources |
| git | facultatif | Requis pour l'isolation par worktree ; en son absence, exécution sur place |

> **Exigence de panneau depuis la 0.9.8** : DSH gère l'entrée du tableau et la page via ses panneaux officiels. Mettez à jour les installations DSH antérieures avant de mettre à jour le plugin.

## Installation

Le plugin est publié sur [npm](https://www.npmjs.com/package/dsh-taskboard) avec des artefacts précompilés : aucune compilation locale n'est nécessaire.

```bash
dsh plugin --profile web add dsh-taskboard
```

Après l'installation, **redémarrez `dsh web` puis rafraîchissez la page** : vous devez voir une entrée « Task Board » dans la barre latérale. Aucune autre configuration n'est nécessaire.

Désinstallation : `dsh plugin --profile web remove dsh-taskboard` (les données du registre restent dans le répertoire de données actif — voir [Configuration et données](#configuration-et-données)).

> Les paquets officiels `@deepseek-ai/dsh-*` vont uniquement dans la liste `bundles` du profil — ne les ajoutez pas en dépendances via `plugin add` (cela évite des instances SDK dédoublées qui se masquent).

## Démarrage rapide

**Étape 1 · Créer une carte** : cliquez sur « + Nouvelle tâche » dans la barre d'outils du tableau — choisissez un projet, une urgence, un mode d'exécution (prise en charge / planifié une fois / périodique cron), un modèle et un preset, l'isolation Git et une liste de contrôle d'acceptation. Une tâche planifiée une fois peut démarrer une nouvelle session ou réutiliser une session existante du projet. Une tâche périodique choisit indépendamment une nouvelle session à chaque tour, une création puis réutilisation, ou une session existante du projet, ainsi que le retour en todo ou la création d'une carte successeure à la fin ; cochez « ⚡ Exécuter maintenant » pour lancer immédiatement.

**Étape 2 · Un agent l'exécute**, déclenché de trois manières :

1. Boutons « Exécuter maintenant » / « ↻ Reprendre » de l'interface (panneau de détail ou formulaire)
2. Planification cron (côté hôte — aucun navigateur requis)
3. Demander à n'importe quel agent, dans n'importe quelle session, de la prendre en charge avec les outils `taskboard_*` : `prends la tâche t-xxxxx du tableau et exécute-la`

**Étape 3 · Validation humaine** : dans la colonne *En revue*, « ✓ Terminé » valide en un clic ; « ✗ Renvoyer » la remet en *Todo* avec une raison facultative (les agents la lisent avant leur tour suivant).

Un workflow agent complet (le protocole ci-dessous est injecté automatiquement par le plugin au démarrage de l'exécution) :

```text
Vous : exécute la tâche de tableau t-ab12cd
agent :
  taskboard_list                # lire le tableau : tâches todo de ce projet
  taskboard_get t-ab12cd        # exigences, commentaires, liste de contrôle d'acceptation
  taskboard_move → in_progress  # prise en charge (verrou code : refuse tâches tenues / hors projet)
  ……code et tests……
  taskboard_checklist check     # cocher les éléments un par un, avec notes de preuve
  taskboard_execution_report    # rapport structuré : résumé/fichiers/vérifications/artefacts/risques
  taskboard_comment_add         # notes de passation
  taskboard_move → in_review    # déplacer vers En revue
Vous : cliquez ✓ Terminé dans la colonne En revue   # done appartient à l'humain — les appels d'agent sont refusés par le verrou code
```
## Référence des outils agent

Disponibles dans toute session. Frontière de projet : seules les sessions appartenant au projet de la tâche peuvent la prendre en charge ou l'exécuter.

| Outil | Rôle |
| --- | --- |
| `taskboard_list` | Lire le tableau (filtres par projet / statut / urgence ; résumés compacts) |
| `taskboard_get` | Lecture complète d'une carte : description, prompt, fil de commentaires, liste de contrôle, exécutions |
| `taskboard_comments` | Lister les commentaires d'une tâche (traités comme les dernières exigences — à lire avant d'agir) |
| `taskboard_create` | Créer une carte (workspaceId, urgence, checklist, preset, isolation, planification) |
| `taskboard_update` | Modifier titre / description / prompt / urgence / checklist (modèle et exécution sont en lecture seule) |
| `taskboard_move` | Déplacer une carte : todo→in_progress→in_review (**done est inatteignable**) |
| `taskboard_comment_add` | Ajouter un commentaire (passations, risques, progression) |
| `taskboard_delete` | Suppression douce (purge possible ; les exécutions en cours ne peuvent pas être supprimées) |
| `taskboard_checklist` | Liste de contrôle d'acceptation : ajouter / cocher (avec preuve) / décocher |
| `taskboard_execution_report` | Soumettre le rapport d'exécution structuré, rattaché à l'exécution courante |
| `taskboard_external_sync` | Lancer la synchronisation externe configurée (récupération, plus réécriture GitHub) ; passez `taskId` pour envoyer une seule carte |

**Argument projet (0.9.5)** : `workspaceId` dans `taskboard_list` et `taskboard_create` accepte un identifiant de projet ou le chemin absolu d'une racine de projet enregistrée (par exemple `D:\work\my-project`). Les chemins relatifs et les sous-répertoires non enregistrés n'identifient pas la racine du projet. Les tâches créées stockent toujours l'identifiant du projet. Les projets inconnus échouent avec `not_found` et des indications de correction ; les projets enregistrés sans tâche renvoient quand même zéro ligne, et l'omission du filtre projet dans la liste énumère toujours tous les projets.

## Fonctionnalités

**Collaboration sur le tableau**
- Tableau à cinq colonnes (Backlog / Todo / En cours / En revue / Terminé) + marqueurs bloqués, rafraîchissement temps réel SSE
- Les tâches appartiennent à des projets : la prise en charge valide l'appartenance de la session — aucun rapt entre projets
- Urgence en trois couleurs (urgent rouge / normal violet / relax bleu) avec filtrage et barres de couleur ; recherche (titre / identifiant) et tri dans la colonne ; filtres et tri persistants
- Pastilles colorées par statut sur les en-têtes de colonne : backlog gris / todo bleu / en cours orange / en revue violet / terminé vert / supprimé rouge
- **Groupes de projets repliables (0.8.10)** : cliquez sur la ligne d'un nom de projet pour replier ses cartes en gardant le nom et le compteur visibles ; chaque paire colonne/projet se replie indépendamment et l'état est restauré après rafraîchissement ; pris en charge sur le tableau principal et dans les colonnes annulées, archivées et mises à la corbeille, avec en-têtes collants et accès clavier conservé
- **En-têtes de groupe de projet collants pendant le défilement d'une colonne (0.8.9)** : sur les colonnes longues, l'en-tête du groupe de projet (ligne du nom d'espace de travail) se fixe en haut au lieu de défiler avec les cartes ; son fond est un empilement opaque de trois couches, donc les cartes qui glissent dessous ne transparaissent jamais
- **Repli et limite d'affichage de la colonne Terminé (0.8.8)** : les réglages du tableau peuvent limiter le nombre de cartes terminées affichées dans une colonne (50 par défaut, 10–500 ; la recherche ignore la limite) ; la colonne Terminé se replie en une bande compacte (état conservé, toujours zone de dépôt) tandis que l'hôte omet les tâches terminées de `/state` et en rapporte le total ; les tâches terminées sont triées de la plus récente à la plus ancienne, groupées par espace de travail, ce qui allège le rendu des gros historiques
- Modale de création/édition : projet, modèle (avec effort de raisonnement), urgence, mode d'exécution, cron avec validation en direct et aperçu du prochain déclenchement, politique de fin périodique et de session indépendante, bascule d'isolation, éditeur de liste de contrôle
- Panneau de détail : transitions de statut (*done* est réservé à l'humain ; terminer avec des éléments non cochés demande confirmation et affiche le nombre), fil de commentaires agent/utilisateur, historique d'exécution (du plus récent au plus ancien ; les identifiants de session ouvrent la session d'exécution au clic ; les cibles supprimées/archivées ont des messages distincts), arrêt d'exécution, bloc d'isolation par worktree (branche / commits / statistiques de changement / fusion et nettoyage), bloc de rapport d'exécution, bloc de liste de contrôle d'acceptation ; un clic sur une zone vide du tableau hors du panneau le referme (0.8.8)
- Actions rapides sur les cartes En revue : « ✓ Terminé » valide en un clic, « ✗ Renvoyer » remet en Todo avec une raison facultative que les agents lisent avant de commencer
- **Pièces jointes d'images (0.7.0)** : les descriptions de tâche et les commentaires acceptent PNG/JPEG/GIF/WebP via le sélecteur de fichiers, le collage ou le glisser-déposer, et insèrent automatiquement le Markdown ; les détails affichent des vignettes avec aperçu plein écran au clic. Les images restent dans le répertoire de données local, limitées à 5 Mio chacune
- **Formulaire de tâche large en deux colonnes + complétion slash (0.6.0)** : la modale de création/édition passe en deux colonnes (champs principaux et configuration d'exécution à gauche, description et prompt à droite) ; taper `/` dans la description/le prompt ouvre la complétion des commandes et des skills (navigation clavier ↑↓/Entrée/Tab/Échap ; les éléments découverts par l'hôte se fusionnent avec la liste intégrée) ; les images Markdown de la description/du prompt s'affichent en vignettes avec aperçu plein écran au clic
- **Permission d'exécution (0.6.0)** : permission d'exécution à trois voies par tâche (📁 écriture dans l'espace de travail / 🔒 lecture seule / ⚡ accès complet) choisie dans le formulaire, plus un réglage de permission par défaut du tableau ; badges de permission sur les cartes, dans le panneau de détail et dans la liste des modèles
- **Langue de l'interface (0.9.7 ; huit locales depuis 0.14.0)** : les huit langues livrées par DSH — chinois, anglais, russe, français, allemand, espagnol, japonais et portugais du Brésil. « Suivre DSH » est le mode par défaut : quelle que soit la langue de DSH, le tableau l'utilise, sans configuration. Réglages du tableau → Général → Langue de l'interface permet toujours d'en figer une ; un choix explicite s'applique immédiatement et est enregistré automatiquement dans le navigateur courant, et revenir à « Suivre DSH » adopte sa langue actuelle. Cela ne change que l'interface du tableau, sans toucher au réglage de langue de DSH. Sans le service de locale, le tableau retombe sur `<html lang>` de la page ou la langue du navigateur, appariée par sous-étiquette principale (`pt-PT` → pt, `zh-TW` → zh, `de-AT` → de) ; quand DSH utilise un pack de langue externe, le tableau ne traduit pas et retombe sur l'anglais exactement comme DSH. Le contenu des modèles intégrés reste livré en chinois et en anglais uniquement, donc les autres locales utilisent le contenu anglais.
- **Synchronisation automatique de sessions externes (0.5.5)** : avec « 🔄 capturer automatiquement les sessions » activé dans les réglages, les sessions créées directement dans un espace de travail génèrent automatiquement des cartes — le projet est résolu depuis le cwd de la session et le premier message utilisateur devient le titre/la description ; les sessions en cours entrent en En cours avec la session liée (saut en un clic), les tours réussis arrivent en En revue, les échecs retombent en Todo ; les sessions de sous-agents sont aussi filtrées depuis 0.6.0 ; les titres d'attente (« session xxxxxxxx ») se réconcilient automatiquement avec le vrai titre (0.8.8) ; désactivé par défaut
- **Saut en un clic vers la session (0.5.4 ; double-clic depuis 0.8.8)** : **double-cliquez une carte** pour ouvrir directement sa session d'exécution (le tableau se replie dessus ; un simple clic sélectionne toujours la carte — un délai de 250 ms sépare les deux) ; le bouton « 🤖 Aller à la session » du panneau de détail et la puce du détenteur font la même chose — directement vers la session de l'exécution en cours (ou la plus récente). Une carte créée dans une conversation et travaillée dans cette même conversation n'enregistre aucune exécution, et y retourne pourtant ; les sessions archivées / supprimées / indisponibles ont chacune un message précis
- **Mémorisation du dernier modèle (0.5.4)** : le formulaire de nouvelle tâche rappelle le dernier modèle et le dernier effort de raisonnement choisis (le préremplissage de modèle et l'édition ne sont pas affectés)
- **Listes de contrôle d'acceptation DoD (0.4.0)** : définissez les critères d'acceptation à la création (≤30 éléments) ; les agents ajoutent/cochinent des éléments via `taskboard_checklist` (avec notes de preuve) ; les utilisateurs les cochent directement dans le panneau de détail ; les éléments non cochés clignotent en rouge pendant la revue et la carte affiche un badge « ☑ n/m » (rouge tant que tout n'est pas coché) ; l'édition de la liste gère le groupe entier dans le formulaire (états cochés et preuves conservés)
- **Rapports d'exécution structurés (0.4.0)** : les agents terminent avec `taskboard_execution_report` (résumé / fichiers modifiés / vérifications / artefacts / risques restants), rattaché automatiquement à l'exécution courante ; rendu côte à côte dans le panneau de détail En revue ; le protocole d'ouverture rend l'ordre explicite (rapport → commentaire → passage en En revue)
- **Import JSON (0.4.0)** : « ⬆ Importer » dans la barre d'outils choisit un fichier de sauvegarde → aperçu à blanc (répartition ajoutés / écrasés / invalides) → fusion (upsert par identifiant) ou remplacement complet (sauvegarde automatique du registre courant d'abord + double confirmation) ; les exports JSON se restaurent directement dans le même format
- **Modèles de tâches (0.4.0)** : menu « + Nouvelle tâche ▼ » (carte vierge / modèles groupés par catégorie / gérer les modèles) qui préremplit le formulaire (titre / description / prompt / urgence / planification / isolation / preset / checklist) ; « ⌗ Enregistrer comme modèle » dans le formulaire et le détail capture vos propres presets (enregistrement direct depuis le formulaire depuis 0.8.8 ; le formulaire reste ouvert pour que vous puissiez encore créer la tâche) ; les modèles vivent à côté du registre dans le répertoire de données actif, avec renommage/catégorisation/suppression dans la boîte de gestion, édition de catégorie en ligne pour les modèles personnalisés et catégories d'usine (Développement / Opérations) pour les modèles intégrés (0.8.8)
- **Visualiseur de diff (0.4.0)** : cliquer sur une ligne de commit ou sur un fichier modifié non validé dans le bloc d'isolation déplie un diff dans le tableau (`git show` pour les commits, `git diff` pour les fichiers, plafonné à 128 Ko / 2000 lignes avec mention de troncature) ; retombe sur le dépôt principal quand le worktree a disparu (commits et diffs de plage de référence uniquement)

**Outils agent (`taskboard_*`)**
- 11 outils : tableau / création / édition / déplacement / commentaires / suppression douce / checklist / rapport d'exécution — utilisables depuis n'importe quelle session
- Verrous de protocole au niveau du code : un agent ne peut jamais atteindre *done* (pas même avec tous les éléments de la liste cochés) ; les tâches tenues ne peuvent pas être préemptées ; les champs modèle/exécution sont en lecture seule pour les agents

**Exécution**
- Les exécutions manuelles ouvrent une nouvelle session. Par défaut, une tâche planifiée crée une session à son premier tour puis continue cette conversation aux tours suivants. Vous pouvez aussi choisir une session existante du projet sélectionné pour conserver son contexte. Si cette session choisie est indisponible, la tâche signale le problème au lieu de basculer silencieusement vers une nouvelle.
- **Politiques de fin périodique (0.8.2)** : choisissez le comportement sous **Après la fin périodique** dans le formulaire. Le défaut **Créer un nouveau todo** conserve ce tour pour la revue et laisse l'hôte créer une nouvelle carte todo héritant du cron, du prompt et de la configuration. **Revenir en todo** fait réarmer la même carte par l'hôte pour la prochaine fenêtre cron. Le choix persiste sur la tâche et est hérité par les modèles et les successeurs ; le règlement l'applique sans dépendre d'un déplacement de statut par l'agent. Les tâches cron existantes sans réglage explicite utilisent le même défaut.
- **Presets par tâche (0.3.3)** : un menu « mode d'exécution (preset) » dans le formulaire de création/édition — les sessions d'exécution sont composées depuis ce preset (jeux d'outils et persona en viennent, comme l'interface compose les nouvelles sessions) ; par défaut le preset du déploiement, ou choisissez « suivre le défaut du déploiement » ; un preset cassé fait échouer l'exécution et enregistre la raison dans l'historique (pas de session à moitié composée) ; modifiable à tout moment, effectif au tour suivant
- **Exécution isolée par worktree Git (0.3.0)** : bascule par tâche (depuis 0.5.0, le défaut des nouvelles tâches vient des réglages du tableau ; le défaut d'usine exécute sur place). Chaque exécution se déroule dans un worktree dédié à `<projet>/.dsh-worktrees/<taskId>`, branche `task/<titre>+<taskId>` (figée à la première création ; renommer ne renomme pas les branches). La session d'exécution reste enracinée dans le répertoire du projet (groupement, outils et bac à sable de fichiers pleinement disponibles — DSH exige cwd de session === racine de l'espace de travail, corrigé en 0.3.2), et le chemin du worktree ainsi que les règles de frontière sont explicites dans les instructions d'ouverture. Le règlement collecte automatiquement les listes de commits / les avertissements de changements non validés / les statistiques de changement. Les projets non git ou l'absence de git dégradent proprement vers une exécution sur place (la raison est enregistrée ; le registre et le flux d'exécution n'échouent jamais à cause de git). À la validation : fusion `--no-ff` en un clic dans l'arbre de travail principal (arbre sale / conflits signalés mot pour mot, jamais résolus automatiquement), suppression du worktree (refusée s'il reste des changements non validés), suppression facultative de la branche. « ↻ Reprendre » continue sur le worktree/la branche existants (commits et modifications précédents conservés)
- **Isolation miroir multi-dépôts (0.6.3)** : quand un espace de travail contient plusieurs dépôts git parallèles (un dépôt racine plus des dépôts indépendants imbriqués), le mode worktree se transforme en miroir complet de la tâche — un balayage borné découvre chaque dépôt (profondeur ≤3, plafonné à 8, cache de 60 s ; les formes sous-module / worktree lié sont ignorées), chaque dépôt obtient son propre worktree sur la même branche de tâche monté à son chemin relatif sous `<projet>/.dsh-worktrees/<taskId>/` ; le cadrage de session liste le chemin de miroir et la branche de chaque dépôt et marque les dépôts non miroir comme « ne pas toucher » ; les preuves de commit, la visualisation de diff (`?repo=`) et la fusion (`--no-ff` par dépôt, un conflit ne bloquant jamais les autres, résumés par dépôt) fonctionnent tous par dépôt ; le nettoyage du miroir agrège les vérifications de salissure sur tous les worktrees et supprime les enfants avant la racine ; les nouveaux champs de registre `branches` / `repos` sont purement additifs — le comportement mono-dépôt et les anciennes données sont intacts ; les espaces de travail conteneurs dont le dépôt racine suit des sous-dépôts comme gitlinks (dépôts encastrés) sont aussi pleinement pris en charge — le bruit structurel que les miroirs enfants produisent dans le statut du miroir racine (répertoires non suivis / dérive de gitlink) est automatiquement exempté de la collecte de preuves, des vérifications de propreté de fusion et de la suppression des miroirs ; le formulaire de création affiche une mention « miroirs N dépôts » sur les espaces multi-dépôts, et les espaces purement conteneurs (racine non-dépôt, sous-dépôts parallèles seulement) peuvent aussi choisir l'isolation par worktree
- **Réglages du tableau** : « 🛠 Réglages » dans la barre d'outils configure le modèle par défaut, l'effort de raisonnement, le preset agent, l'isolation, la permission et la limite d'affichage de la colonne terminée pour les nouvelles tâches. L'effort est enregistré avec son modèle et revient au défaut du modèle au changement de modèle. Les choix explicites de tâche ou de modèle l'emportent ; l'interface et `taskboard_create` matérialisent les défauts du tableau sur les nouvelles tâches, donc un changement ultérieur des réglages ne réécrit jamais les tâches existantes. Sans modèle par défaut du tableau, l'interface conserve son dernier modèle mémorisé ; le formulaire peut aussi suivre explicitement les défauts du déploiement. Les réglages persistent avec le registre et prennent en charge l'import/export JSON.
  Les réglages généraux proposent aussi la langue de l'interface et le projet par défaut des nouvelles tâches. Chacun utilise un libellé à gauche et un sélecteur à droite, avec un texte d'aide en dessous ; des séparateurs horizontaux distinguent les sections. La préférence de langue est stockée séparément dans le navigateur courant et exclue des imports/exports JSON du registre. Les changements de langue sont enregistrés automatiquement ; les autres défauts de tâche demandent encore « Enregistrer les réglages ». Changer de langue conserve les brouillons non enregistrés des autres réglages.
  > L'isolation par worktree est une convention de collaboration, pas un bac à sable : les sessions d'exécution ont toutes les permissions d'outils, l'isolation repose sur la convention de branche, et elle ne convient pas à l'exécution de code non fiable.
- Planification côté hôte : se déclenche navigateur fermé ; les fenêtres manquées sont ignorées, jamais rejouées
- Concurrence optimiste (ifVersion) + attribution complète (qui a changé quoi, quelle session a exécuté)
- ⚙ Diagnostics de santé : vérifications d'intégrité du registre + worktrees orphelins (présents sur le disque mais sans propriétaire dans le registre) avec nettoyage en un clic

### Attente d'action humaine et revue de livraison

- **En attente de moi** filtre les attentes humaines dans le projet, la recherche et les filtres d'urgence courants. La reconnaissance automatique est étiquetée comme suggestion et évite les termes métier génériques comme connexion ou codes de vérification.
- Le détail d'une tâche permet de modifier la raison, de marquer explicitement, d'effacer explicitement et de restaurer la reconnaissance automatique. L'effacement explicite l'emporte sur l'inférence. L'attente humaine et le blocage générique sont indépendants ; les tâches terminales et mises à la corbeille sont exclues.
- Les agents peuvent signaler ou lever une attente avec `taskboard_update` via `waitingForHuman` et `waitingReason`. Décrivez l'action attendue sans saisir d'identifiants. Les sauvegardes JSON conservent ces champs ; les mises à jour HTTP acceptent `waitingForHuman: null` pour restaurer la reconnaissance automatique.
- Les cartes en revue/terminées résument la dernière exécution. Les détails mettent en avant son rapport et sa liste de contrôle d'acceptation, les rapports antérieurs restant dans l'historique. Les notes de vérification sont des preuves rapportées, pas une garantie de succès ; certaines tâches ne demandent aucune modification de fichier.

## Sécurité

- **L'autorité de validation appartient aux humains** : les appels d'agent déplaçant une tâche vers *done* sont refusés par le verrou de protocole au niveau du code (une suggestion de prompt ne l'est pas) ; les tâches tenues ne peuvent pas être préemptées ; les prises en charge hors projet sont refusées.
- **L'isolation par worktree est une convention, pas un bac à sable** : les sessions d'exécution ont toutes les permissions d'outils ; l'isolation repose sur la convention de branche et ne convient pas au code non fiable.
- **Données locales** : le registre, les modèles et les pièces jointes restent locaux, et les réglages du tableau peuvent migrer leur répertoire de données ; rien n'est envoyé nulle part et aucun jeton / clé API n'est requis.

## Configuration et données

Fonctionne immédiatement. La surface de configuration complète :

| Variable d'environnement | Défaut | Description |
| --- | --- | --- |
| `DSH_TASKBOARD_MAX_CONCURRENT` | `3` | Plafond global des sessions en exécution simultanée |
| `DSH_HOME` | `~/.dsh` | Dossier personnel DSH, répertoire de données par défaut et répertoire fixe du pointeur d'emplacement |
| `ATB_TRACE` | non défini | Avec `ATB_TRACE=1`, l'hôte imprime les traces d'appels d'outils (débogage) |

Le répertoire de données est par défaut `DSH_HOME` et peut être validé puis migré dans « 🛠 Réglages → Emplacement de stockage des données ». Les trois éléments de données se déplacent toujours ensemble ; désinstaller le plugin les conserve.

| Fichier | Contenu |
| --- | --- |
| `dsh-taskboard.json` | Registre des tâches (toutes les tâches / exécutions / commentaires) |
| `dsh-taskboard-templates.json` | Modèles de tâches |
| `dsh-taskboard-assets/` | Pièces jointes d'images (dédupliquées par empreinte de contenu) |
| `dsh-taskboard.json.backup-<horodatage>` | Sauvegarde automatique prise avant un import en remplacement complet |
| `DSH_HOME/dsh-taskboard-storage.json` | Pointeur d'emplacement pour un répertoire de données personnalisé ; reste toujours sous le dossier personnel DSH |
| `<projet>/.dsh-worktrees/<taskId>/` | Worktree d'exécution par tâche (espaces multi-dépôts : miroir complet de l'espace de travail avec un sous-worktree par dépôt) |

Utilisez « ⬇ JSON » dans la barre d'outils pour sauvegarder le registre, ou exportez la liste des tâches en CSV (« ⬇ Exporter », BOM inclus, s'ouvre directement dans Excel). Les images ne sont pas intégrées au JSON ; pour une sauvegarde complète, copiez `dsh-taskboard-assets/` depuis le répertoire de données affiché dans les réglages.

**Si le registre ne peut pas être chargé** : le tableau signale l'erreur et le chemin du fichier, conserve le fichier d'origine et bloque les écritures, la migration et le nettoyage des pièces jointes. Arrêtez DSH, sauvegardez tout le répertoire de données, réparez ou restaurez `dsh-taskboard.json` depuis une sauvegarde fiable, puis redémarrez. Un registre absent accompagné de fichiers `.corrupt-*` laissés par d'anciennes versions déclenche aussi la protection ; conservez ces fichiers pour la récupération ([#84](https://github.com/cloader/dsh-taskboard/issues/84)).

## FAQ

**Pas d'entrée « Task Board » dans la barre latérale ?**
Rafraîchissez la page. Toujours rien ? Vérifiez que le plugin est installé dans le profil courant et redémarrez `dsh web` (la moitié hôte se charge au démarrage du processus). Les trois générations de shell sont prises en charge : `data-pane` (dev), noms de classes hachés (mise en page officielle, depuis 0.4.2) et le cadre étendu non compatible DSH Desktop (depuis 0.5.2).

**Où sont stockées les données des tâches ? Comment les sauvegarder ?**
Voir [Configuration et données](#configuration-et-données). « ⬇ JSON » exporte et restaure le registre ; les pièces jointes d'images nécessitent aussi une sauvegarde du dossier `dsh-taskboard-assets/`.

**Les tâches planifiées se déclenchent-elles encore navigateur fermé ?**
Oui. La planification vit dans le processus hôte et est indépendante du navigateur ; les fenêtres manquées sont ignorées, pas rejouées.

**Pourquoi ma tâche périodique s'arrête-t-elle en En revue, et comment continuer automatiquement ?**
Par défaut, le système conserve ce tour pour la revue et crée la carte todo suivante. Dans le formulaire, choisissez **Revenir en todo** pour réutiliser la carte à la prochaine fenêtre cron. Les deux politiques sont appliquées par l'hôte ; les tâches cron existantes sans réglage explicite utilisent aussi le comportement par défaut de création d'un successeur.

**Mon projet n'est pas un dépôt git — est-ce que ça fonctionne quand même ?**
Oui. L'isolation par worktree dégrade automatiquement vers une exécution sur place, la raison étant enregistrée dans l'historique d'exécution ; le reste n'est pas affecté.

**Comment plusieurs projets coopèrent-ils ?**
Les tâches sont rattachées à des projets (= espaces de travail DSH). La prise en charge valide l'appartenance de la session : seules les sessions à l'intérieur du projet de la tâche peuvent la prendre en charge/l'exécuter — aucun rapt hors projet.

**Un agent peut-il marquer lui-même une tâche « Terminé » ?**
Non. C'est un verrou de protocole au niveau du code (pas une convention de prompt) : les appels `taskboard_move` visant *done* sont refusés d'emblée ; la validation est toujours effectuée par un humain sur le tableau.

**Les boutons de droite de la barre d'outils sont masqués quand dsh-better-sidebar est installé ?**
Corrigé depuis 0.6.5 avec un retrait automatique : tant que le panneau droit de better-sidebar est replié, son groupe persistant dans le coin (« agrandir le panneau du bas » / « agrandir la barre latérale ») occupe les 10-70 px en haut à droite de la fenêtre ; le tableau actif réserve désormais cette bande à droite de sa barre d'outils (en miroir du contrat de retrait de better-sidebar pour l'en-tête de session natif de DSH), donc ils ne se chevauchent plus à aucune largeur de fenêtre. Aucun effet quand better-sidebar est absent ou que son panneau est ouvert ([#19](https://github.com/cloader/dsh-taskboard/issues/19)).

**Les contrôles de légende de DSH Desktop sous Windows chevauchent la barre d'outils du tableau ?**
Le correctif 0.6.6 réserve un espace sous les contrôles de légende natifs selon la position réelle du tableau dans la fenêtre. Les mises en page avec barre de titre séparée gardent leur espacement normal ; le redimensionnement de la fenêtre et les changements de mise en page déclenchent un recalcul. Vérifié sous Windows Desktop ([commentaire #20](https://github.com/cloader/dsh-taskboard/issues/20#issuecomment-5597498727)).

**Les cases à cocher DoD prennent la ligne d'édition et repoussent le champ de texte ?**
La 0.6.6 exclut les cases à cocher des styles d'entrée pleine largeur de la modale, ce qui restaure la largeur de 15 px de la case et la zone de texte ([#20](https://github.com/cloader/dsh-taskboard/issues/20)).

## Développement

```bash
git clone https://github.com/cloader/dsh-taskboard.git
cd dsh-taskboard
npm install && npm run build    # double build : hôte ESM + client CJS
npm test                        # suite vitest complète (dont les tests d'intégration miroir sur git réel)
npm run test:coverage           # couverture v8 (text-summary + json-summary)
node tests/manual-git-e2e.mjs   # test manuel de bout en bout sur git réel (chaîne worktree complète + reprise + visualiseur de diff)
```

`npm run build` nettoie les fichiers obsolètes de `lib/` avant de générer les modules ESM de l'hôte et le module d'enregistrement du client, `lib/client.js`. `npm run build:host` et `npm run build:client` ne reconstruisent que leur moitié respective et préservent la sortie de l'autre ; lancez la compilation complète avant de publier.

Pour le développement local, compilez d'abord, puis liez le dépôt local avec `dsh plugin --profile web add "link:/path/to/dsh-taskboard"`. Recompilez et rafraîchissez la page après des changements côté client ; les changements côté hôte nécessitent aussi un redémarrage de `dsh web`.

**Ajouter une langue / modifier les textes** : les textes de l'interface vivent dans `src/client/i18n/<locale>.ts`, un dictionnaire par locale dont l'ensemble de clés doit être exactement identique à `zh.ts` (une clé manquante ou en trop est une erreur de compilation). Ajouter une locale signifie un nouveau dictionnaire plus une entrée dans `runtime.ts` (`SHIPPED_LOCALES`, `LOCALE_LABELS`, `DICTS`) ; `tests/i18n.spec.ts` vérifie chaque clé, chaque jeu d'espaces réservés (`{n}`, `{{lastExecution}}`, …), les valeurs vides et les caractères de largeur nulle, et scanne chaque littéral `t('…')` du client — une traduction manquante fait échouer la CI.

## Synchronisation externe

ZenTao prend en charge le mappage de projets ou d'exécutions/itérations pour les Bugs, Stories et Tâches. TAPD prend en charge les Bugs, Stories et Tâches. GitHub, GitLab et Gitea/Forgejo synchronisent les Issues ; Jira Cloud et Linear synchronisent les Issues. Les deux modes de ZenTao ont passé des vérifications de déploiement réel en lecture seule ; TAPD, GitHub, GitLab, Gitea, Jira et Linear restent validés localement avec des mocks (aucun identifiant réel ; la compatibilité de production n'est pas revendiquée).

Les réglages stockent **jusqu'à 10 connexions**, chacune avec son fournisseur, son authentification, sa portée, ses mappages de projets et sa direction de synchronisation. La liste des connexions affiche l'état d'activation, la dernière synchronisation/l'erreur et propose synchronisation, activation/désactivation, édition et suppression par connexion. Les anciens fichiers mono-connexion sont migrés automatiquement.


1. Ouvrez **Synchronisation externe** dans les réglages. ZenTao utilise l'URL de son installation sans `/api.php/v1`, plus un nom d'utilisateur et un mot de passe. Réutilisez par défaut l'identifiant de connexion comme personne assignée, ou saisissez-en une autre. TAPD utilise une authentification Basic API ou un jeton Bearer et un pseudo de membre séparé.
2. Sélectionnez la **Portée de synchronisation** (Bugs, Stories, Tâches), la destination d'import (Backlog ou Todo) et l'intervalle de scrutation (0 désactive la scrutation ; sinon 5 à 1440 minutes).
3. Choisissez **Lier les projets** (par défaut) ou **Lier les exécutions/itérations**, puis **Synchroniser la liste des projets/exécutions**. La découverte liste toutes les entrées lisibles pour ce mode, indépendamment des types d'éléments sélectionnés.
4. Chaque ligne affiche le nom, l'identifiant et le sélecteur de projet local ; les noms d'exécution incluent leur projet parent. Les lignes **Non liées** sont exclues par défaut. Le rafraîchissement conserve les associations et signale les entrées précédemment liées qui ne sont plus lisibles. Changer de mode efface le brouillon de mappage ; la configuration enregistrée reste active jusqu'à un enregistrement explicite.
5. **Tester la connexion** utilise le formulaire courant sans enregistrer. Enregistrez la configuration, puis synchronisez les tâches. Les mappages vides peuvent être enregistrés ; ils n'importent rien sauf si la synchronisation des éléments non liés est activée. La scrutation nécessite un hôte démarré et utilise les réglages enregistrés.

Le mode projet lit les Bugs/Stories du projet et agrège les Tâches de toutes les exécutions du projet, en dédupliquant au sein de ce projet. Le mode exécution lit directement les types sélectionnés depuis l'exécution. Les nouveaux imports filtrent par personne assignée et par état terminal. Une même Story peut créer des cartes distinctes sous des mappages d'exécution distincts. Les modes de mappage conservent des identités de source indépendantes ; les anciennes cartes ne sont ni fusionnées ni supprimées. Les destinations locales non vides et les états d'exécution existants sont préservés. Le contenu passe par une fusion à trois voies et les protections existantes d'exécution/terminal ; les exclusions de suppression restent limitées à chaque mappage.

**Synchroniser les projets non liés** / **Synchroniser les exécutions/itérations non liées** est désactivé par défaut. Une fois activé, chaque scan découvre toutes les portées lisibles, y compris les entrées nouvellement créées et les lignes sans association locale. Les nouvelles cartes de ces portées n'ont pas de projet local ; les portées liées conservent leur destination configurée. Après qu'une portée est associée et enregistrée, la synchronisation suivante remplit les destinations vides des cartes sans créer de doublons. Les destinations non vides, les cartes archivées et les cartes à la corbeille sont préservées. Enregistrer sans association est possible dans ce mode. Le désactiver arrête les futurs scans non liés sans supprimer de cartes.

### GitHub Issues

Sélectionnez **GitHub**, l'URL de base de l'API (`https://api.github.com`, ou `https://<hôte>/api/v3` sur GitHub Enterprise) et un jeton : un PAT classique avec `repo` (ou `public_repo` pour les dépôts publics) ou un jeton finement granulaire avec **Issues: read and write**. Le compte de synchronisation est l'identifiant GitHub utilisé pour filtrer les issues importées ; **Identifier le compte courant** le remplit depuis le jeton. Choisissez le type d'élément **Issues**, une date de début, une destination d'import et un intervalle de scrutation (0 désactive la scrutation), puis **Synchroniser la liste des projets** et mappez chaque dépôt `owner/repo` vers un projet local. Les pull requests renvoyées par le point de terminaison des issues sont ignorées.

Hormis les pull requests, la synchronisation importe les issues ouvertes **assignées au compte de synchronisation** dans la destination choisie sous forme de cartes non exécutables ; les synchronisations suivantes mettent à jour les cartes liées. Modifier à distance le titre/corps d'une issue suit les mêmes règles de fusion à trois voies et de conflit que ZenTao. Décochez **Importer uniquement les éléments assignés au compte de synchronisation** pour importer toutes les issues du dépôt (les issues sont souvent non assignées).

**Réutiliser les cartes existantes** (activé par défaut pour GitHub, déclaré par le fournisseur) évite les doublons quand des cartes existent déjà pour ces issues : une carte dont le titre nomme l'issue (`#123` ou `(#123)`), dont la **première** URL d'issue de la description y pointe, ou dont le titre normalisé égale le titre de l'issue est liée à cette issue au lieu d'être copiée. Les URL suivantes dans une description sont traitées comme des liens croisés et ignorées, plusieurs cartes correspondantes sont départagées par similarité de titre, et un élément réellement ambigu est ignoré et signalé plutôt que deviné. La formulation propre de la carte est enregistrée comme référence d'envoi, donc les cartes adoptées ne sont jamais réécrites à distance tant que leur titre ou description n'est pas modifié dans le tableau.

La réécriture est opt-in par synchronisation et s'exécute à la fin de chaque synchronisation, uniquement pour les cartes déjà liées à une issue — y compris les cartes adoptées : un titre ou une description modifiés sont envoyés, `done` ferme l'issue en *completed* et `canceled` la ferme en *not planned*, mais seulement si le statut de la carte a changé depuis le dernier envoi réussi. Elle ne rouvre jamais une issue distante, n'envoie jamais tant qu'une carte a une exécution en cours, et n'écrase jamais un conflit non résolu. Les cartes sans lien peuvent être envoyées une par une depuis le panneau de détail (**Créer l'issue externe**, avec un sélecteur de dépôt cible quand plusieurs dépôts correspondent au projet), et les agents peuvent appeler `taskboard_external_sync` (connexion entière) ou `taskboard_external_sync` avec `taskId` (carte unique). Les commentaires, personnes assignées, étiquettes et fermetures distantes autres que les états terminaux du tableau ne sont pas réécrits ; la synchronisation rapporte les compteurs récupérés/créés/liés/ambigus/envoyés.

### GitLab, Gitea/Forgejo, Jira Cloud, Linear

- **GitLab** : la racine de l'API vaut par défaut `https://gitlab.com/api/v4` (auto-hébergé : `https://<hôte>/api/v4`), jeton d'accès personnel via `PRIVATE-TOKEN` ; mappe `group/project` (sous-groupes pris en charge), synchronise les Issues (les merge requests ne sont jamais importées) avec création/mise à jour/fermeture facultatives.
- **Gitea/Forgejo** : la racine de l'API vaut par défaut `https://gitea.com/api/v1`, authentification par jeton ; mappe `owner/repo`, ignore les pull requests, réécriture facultative.
- **Jira Cloud** : REST v3, authentification Basic (e-mail + jeton API), mappe les clés de projet (`ABC`) ; les descriptions sont converties entre ADF et texte brut, la fermeture utilise une transition de workflow dont la catégorie est `done`. Jira Cloud uniquement (le balisage wiki de Server/DC n'est pas pris en charge).
- **Linear** : GraphQL, clé API (sans `Bearer`), mappe les clés d'équipe (`ENG`) ; pagination par curseur, achèvement/annulation à partir des types d'état, création/mise à jour facultatives.

Les trois forges prennent en charge des webhooks signés facultatifs sur `POST /dsh-taskboard/external/webhook/<connectionId>` : `X-Hub-Signature-256` pour GitHub, `X-Gitea-Signature` pour Gitea/Forgejo, et `X-Gitlab-Token` pour GitLab. Un webhook ne déclenche qu'une récupération (l'API distante reste la référence) ; les identifiants de livraison dupliqués sont écartés et des événements dans le désordre ne peuvent pas écraser un état plus récent. Le secret du webhook vit dans `credentials.webhookSecret` (jamais renvoyé au client).

### Réécriture, aperçu et conflits

Chaque connexion est en lecture seule par défaut (`inbound`). La réécriture ne s'exécute que si la synchronisation bidirectionnelle est explicitement sélectionnée **et** que le fournisseur déclare la capacité d'écriture ; seuls le titre/la description modifiés depuis le dernier envoi réussi sont envoyés, `done` ferme en *completed*, `canceled` en *not planned*, les issues distantes ne sont jamais rouvertes, les cartes en cours ne sont jamais envoyées, et les champs en conflit non résolu ne sont jamais écrasés. `POST /dsh-taskboard/external/preview` prévisualise les créations/associations/mises à jour/conflits/envois sans rien écrire d'un côté ni de l'autre.

Les anciennes connexions ZenTao sans mode de mappage conservent identifiants et tâches mais suspendent la synchronisation automatique et exigent une réassociation. Les identifiants de produit ne sont jamais réinterprétés comme des identifiants de projet. Rafraîchissez, associez et enregistrez pour reprendre.

Les identifiants restent dans le fichier en clair réservé à l'hôte `dsh-taskboard-external.json` sous le DSH_HOME actif (mode `0600`) ; protégez ce fichier. Mots de passe, jetons et secrets de webhook sont exclus du statut public, des exports de tâches, des erreurs et des journaux. ZenTao obtient des jetons en mémoire ; les anciennes configurations à jeton seul ne sont pas prises en charge. La persistance des tâches et des métadonnées de synchronisation est atomique. Les captures/pièces jointes et la synchronisation bidirectionnelle des commentaires sont exclues ; Bitbucket, Azure DevOps, Trello, GitHub Projects et GitLab Boards ne sont pas implémentés.

La validation en déploiement réel du 16/10/2026 a lu 4 Bugs, 4 Stories liées et 8 Tâches en mode projet, avec les résultats d'exécution correspondants. Chaque mode a importé 2 Bugs et 2 Tâches pour l'administrateur ; les scans répétés n'ont rien créé ni mis à jour. Aucune Story n'était assignée à ce compte, donc l'import des Stories assignées reste couvert par les tests avec mocks. Seuls des registres locaux temporaires ont été écrits ; les données métier du suivi n'ont pas été modifiées.

## Contrat public Agent Board (v1)

Task Board reste le seul propriétaire du registre des tâches et de l'enveloppe d'exécution ; Agent Board (ou tout orchestrateur autorisé) est un consommateur contrôlé qui ne peut pas lire les fichiers du registre ni déplacer une tâche vers `done`.

```bash
# À définir avant de démarrer l'hôte ; sans cela l'API publique renvoie 503 et tout le reste fonctionne normalement.
export DSH_TASKBOARD_PUBLIC_TOKEN="long-random-token"

curl -H "Authorization: Bearer $DSH_TASKBOARD_PUBLIC_TOKEN" \
  http://127.0.0.1:<port>/dsh-taskboard/public/v1/meta
curl -H "Authorization: Bearer $DSH_TASKBOARD_PUBLIC_TOKEN" \
  "http://127.0.0.1:<port>/dsh-taskboard/public/v1/tasks?eligible=true"
```

Points de terminaison : `/meta`, `/projects`, `/tasks`, `/tasks/:id`, `/tasks/:id/dependencies`, `/executions/:id`, `/events` (SSE : `/events/stream`) ; cycle de vie : `POST /executions/claim`, `:id/session`, `:id/attempts`, `:id/handoff`, `:id/report`, `:id/complete`, `:id/interrupt`. Champs complets, codes d'erreur, idempotence et sémantique de clôture : [docs/AGENT-BOARD-CONTRACT.md](./docs/AGENT-BOARD-CONTRACT.md). Sans Agent Board, Task Board fonctionne de manière totalement autonome ; laisser le jeton non défini désactive entièrement l'API.

## Journal des modifications

### 0.14.0

- **Interface en huit locales qui suit automatiquement la langue de l'utilisateur** : le tableau livre désormais les mêmes huit langues que DSH, en ajoutant Français / Deutsch / Español / 日本語 / Português (Brasil). « Suivre DSH » reste le défaut, donc le tableau parle la langue de DSH sans configuration ; un choix explicite peut toujours figer une locale et est enregistré dans le navigateur courant.
- **Détection alignée sur DSH** : le `lang` de la page et les langues du navigateur sont appariés par sous-étiquette principale (`pt-PT` → pt, `zh-TW` → zh, `de-AT` → de) ; quand DSH utilise un pack de langue externe, le tableau ne traduit pas et retombe sur l'anglais, exactement comme DSH.
- **Garde-fous** : les ensembles de clés et les espaces réservés sont comparés clé par clé sur les huit dictionnaires, les valeurs vides et les caractères non standard sont rejetés, et le scan des clés `t('…')` du client couvre chaque dictionnaire.

### 0.9.10

- **Isolation des tâches périodiques** : corrige les tâches périodiques configurées pour créer une carte successeure qui retombaient sur le checkout principal dès le deuxième cycle parce qu'elles héritaient d'une branche occupée. Les successeurs utilisent des branches indépendantes ; les cartes héritées retombent sur une branche disponible et enregistrent son nom réel pour les preuves, la continuation et la fusion, y compris pour les miroirs multi-dépôts ([#94](https://github.com/cloader/dsh-taskboard/issues/94)).
- **Édition des tâches planifiées une fois** : remet les tâches planifiées une fois consommées en mode prise en charge après règlement, fenêtre de déclenchement manquée ou retrait de file, et permet d'éditer les anciennes cartes consommées. Préserve les déclencheurs dus non consommés et les fenêtres en file ou en cours d'envoi lors d'éditions ordinaires, sans les annuler ni les réarmer. Une replanification explicite exige toujours un moment futur, et les badges de planification consommés sont masqués ([#95](https://github.com/cloader/dsh-taskboard/issues/95)).

Merci à [@timacek](https://github.com/timacek) pour les rapports et l'analyse de reproduction.

### 0.9.9

- **Détails de tâche sur panneaux étroits** : corrige les boutons d'action qui écrasaient les titres de tâche sur une lettre par ligne sur téléphones et panneaux de bureau étroits. Réserve un espace de titre lisible, place les actions sous le titre au besoin, et fait passer les boutons à la ligne dans le panneau. Gère les largeurs intermédiaires et les libellés russes plus longs tout en conservant la mise en page large du bureau ([#91](https://github.com/cloader/dsh-taskboard/issues/91), [#92](https://github.com/cloader/dsh-taskboard/pull/92)). Merci à [@reysonk](https://github.com/reysonk) pour le rapport et l'investigation ; implémenté par [@cloader](https://github.com/cloader).

### 0.9.8

- **Exports complets** : les sauvegardes JSON et les exports CSV récupèrent toujours le registre complet, y compris les tâches terminées quand la colonne Terminé est repliée. Les échecs de récupération affichent une erreur au lieu de produire un fichier incomplet ([#89](https://github.com/cloader/dsh-taskboard/pull/89)).
- **Arrêt des sessions externes** : arrêter une session externe capturée automatiquement annule désormais son agent actif et attend son arrêt avant de marquer l'exécution comme annulée. Les tentatives d'arrêt échouées sont réessayées, évitant des cartes qui semblent annulées alors que leurs sessions continuent ([#89](https://github.com/cloader/dsh-taskboard/pull/89)).
- **Protection des exécutions déclenchées par commentaire** : suit immédiatement une exécution déclenchée par un commentaire et réessaie les écritures de métadonnées de livraison échouées au règlement, en gardant l'exécution suivie et en empêchant la même file de commentaires d'être livrée deux fois ([#89](https://github.com/cloader/dsh-taskboard/pull/89), contribution de [@cloader](https://github.com/cloader)).
- **Protection des prises en charge** : empêche d'autres sessions de supprimer une tâche prise en charge en cours de travail, en préservant le travail en cours ([#85](https://github.com/cloader/dsh-taskboard/issues/85), [#86](https://github.com/cloader/dsh-taskboard/pull/86)).
- **Protection des données** : signale les échecs de chargement du registre, conserve le fichier d'origine et les images, et empêche un registre vide d'écraser des données existantes ([#84](https://github.com/cloader/dsh-taskboard/issues/84), [#87](https://github.com/cloader/dsh-taskboard/pull/87)).
- **Panneau du tableau** : utilise la commutation de panneaux officielle de DSH et retire l'ancienne méthode de montage. Nécessite DSH 0.1.7 ou plus récent ([#82](https://github.com/cloader/dsh-taskboard/pull/82)).
- **Aperçu d'import** : garde l'aperçu et le contenu importé cohérents lors d'un changement rapide de fichier ([#72](https://github.com/cloader/dsh-taskboard/issues/72), [#75](https://github.com/cloader/dsh-taskboard/pull/75)). Merci à [@timacek](https://github.com/timacek) pour la contribution.
- **Exécution plus fiable** : corrige des erreurs de stockage pouvant fermer DSH, et réessaie d'enregistrer les résultats d'exécution après un échec d'écriture ([#74](https://github.com/cloader/dsh-taskboard/issues/74), [#80](https://github.com/cloader/dsh-taskboard/pull/80)).
- **Protection du répertoire de travail** : arrête la suppression quand les changements ne peuvent pas être vérifiés, en préservant les fichiers non validés ([#73](https://github.com/cloader/dsh-taskboard/issues/73), [#81](https://github.com/cloader/dsh-taskboard/pull/81)).
- **Guide d'installation** : utilise npm et retire les instructions d'installation GitHub non fonctionnelles ([#76](https://github.com/cloader/dsh-taskboard/issues/76), [#79](https://github.com/cloader/dsh-taskboard/pull/79)).
- **Développement** : corrige la compatibilité des tests sur Node 26 ([#71](https://github.com/cloader/dsh-taskboard/issues/71), [#78](https://github.com/cloader/dsh-taskboard/pull/78)).

### 0.9.7

- **Préférence de langue du tableau** : les réglages généraux proposent Suivre DSH (défaut), chinois, anglais et russe. Les changements s'appliquent immédiatement et persistent dans le navigateur courant ; les choix explicites restent indépendants de DSH, et revenir à Suivre DSH adopte sa dernière langue.
- **Disposition des réglages** : la langue de l'interface et le projet par défaut utilisent chacun une ligne horizontale libellé-plus-sélecteur avec un texte d'aide en dessous. Des séparateurs horizontaux distinguent les sections, et changer de langue conserve les brouillons non enregistrés des autres réglages.
- **Interface russe (ru) ([#67](https://github.com/cloader/dsh-taskboard/pull/67), merci [@reysonk](https://github.com/reysonk))** : ajoute `src/client/i18n/ru.ts` (664 clés, ensemble identique à zh/en) ; élargit `LocaleId` à `'zh' | 'en' | 'ru'`, et accepte `ru` dans le dictionnaire ainsi que dans la détection de repli `<html lang>` / `navigator`. Le corps des modèles intégrés continue d'utiliser le contenu anglais (non traduit par cette PR).
- **Identifiant de tâche dans l'en-tête du détail ([#68](https://github.com/cloader/dsh-taskboard/pull/68), merci [@reysonk](https://github.com/reysonk))** : le panneau de détail affiche désormais l'identifiant de la tâche après la ligne « Mis à jour … · dernier changement par … », dans une puce monospace qui se copie au clic et confirme brièvement par « Copié » ou « Échec de copie ». L'interface n'affichait jamais l'identifiant, donc une carte ne pouvait pas être désignée depuis une conversation, un journal ou un rapport de bug.
- **Colonnes Backlog et To Do repliables ([#65](https://github.com/cloader/dsh-taskboard/pull/65), merci [@jw5555555555](https://github.com/jw5555555555) ; correctifs d'intégration [#69](https://github.com/cloader/dsh-taskboard/pull/69))** : replie l'une ou l'autre colonne en un rail compact avec compteurs de tâches et transitions par glisser-déposer. L'état de colonne persiste indépendamment de l'état de repli des groupes de projets, avec des libellés chinois, anglais et russes.
- **Avis de revue plus doux ([#66](https://github.com/cloader/dsh-taskboard/issues/66), [3054eba](https://github.com/cloader/dsh-taskboard/commit/3054eba6741a635966a0f5d593da8138bffc19ac))** : l'avis de vérification/validation manquant sur les cartes en attente de revue passe du rouge au bleu clair (`#78a9d6`), en conservant le texte tout en réduisant la distraction visuelle.
- **Couverture de régression** : parité des clés en trois langues, valeurs non vides, mappages d'énumérations, détection de locale et substitution d'espaces réservés, repli des modèles et scan des clés de traduction du client ; rendu de l'identifiant de tâche et retour de copie ; préférences de langue persistées, bascule entre DSH et choix explicites, stockage indisponible et brouillons de réglages conservés ; repli combiné colonne/groupe de projet et rechargement.

### 0.9.6

- **Prise en charge depuis les racines d'espaces de travail liées ([#62](https://github.com/cloader/dsh-taskboard/pull/62), merci [@reysonk](https://github.com/reysonk))** : ajoute le réglage global `allowClaimFromLinkedRoots`, désactivé par défaut. Une fois activé, les sessions peuvent prendre en charge des tâches dans les racines d'espaces de travail rattachées sans changer la propriété des tâches. Nécessite le plugin multi-racines ; les services absents ou qui lèvent une erreur retombent sur la prise en charge depuis la racine principale.
- **Protocole et périmètre** : aligne le protocole agent et les indications bilingues des réglages. Le travail inter-racines doit utiliser le répertoire du projet de la tâche et respecter les permissions de fichiers existantes. Les règles de création restent inchangées : les identifiants de projet enregistrés et les répertoires de projet résolvables sont acceptés.
- **Couverture de régression** : couvre les prises en charge depuis les racines liées, le refus par défaut, les services indisponibles, les indications d'erreur, la création hors projet et les contraintes de protocole ; les 583 tests de 44 fichiers passent.

### 0.9.5

- **Chemins de projet et indications de correction (#58 / #59)** : `taskboard_list` et `taskboard_create` acceptent le chemin absolu d'une racine de projet enregistrée comme `workspaceId`, tandis que les tâches créées stockent toujours l'identifiant du projet. Les projets inconnus continuent d'échouer avec `not_found` ; les détails d'erreur fournissent un identifiant réutilisable pour le projet de la session appelante, ou listent jusqu'à 8 identifiants de projet quand la session ne peut pas être associée. Merci à [@Ausli](https://github.com/Ausli).

### 0.9.4

- **Réveil par commentaire (#51)** : les cartes en revue gagnent un bouton « Envoyer et laisser l'agent traiter » — un clic fusionne le commentaire avec tous les commentaires utilisateur en attente en UN seul message utilisateur et réveille la conversation de la tâche (la carte revient en cours) ; une session active le reçoit immédiatement, sinon l'exécution continue la conversation de la carte ou repart de zéro avec la raison enregistrée. Les tâches isolées en worktree reprennent toujours le miroir pour que le travail revu survive. Les commentaires livrés sont marqués d'un lien vers la session ; les commentaires d'agent/système ne déclenchent jamais de livraison, et seules les cartes en revue peuvent être réveillées (appliqué aux deux verrous).
- **Attribution et lisibilité des commentaires** : les commentaires système portent leur session et sont exclus de la file de livraison, donc les anciens commentaires système ne sont plus étiquetés à tort comme retours utilisateur en attente ; les libellés d'agent mènent à leur session, et la chronologie des exécutions est repliée par défaut.

### 0.9.3

- **Récupération après plantage du registre (#53)** : les verrous orphelins laissés par un plantage de l'hôte sont récupérés immédiatement via des vérifications de vivacité du pid ; les propriétaires actifs ou indéterminés ne sont jamais récupérés selon l'âge. Un démarrage propre ne prend plus le verrou d'écriture, et les échecs de réconciliation dégradent en avertissement au lieu d'un échec fatal de chargement — corrigeant la boucle de plantage où un redémarrage échouait à nouveau.
- **Attente d'action humaine (d'après #54, merci [@monkey-sking](https://github.com/monkey-sking))** : les attentes explicites, les effacements explicites et la reconnaissance automatique sont entièrement persistés via le protocole partagé et indépendants du blocage générique. Des badges ambre et un filtre « en attente de moi » mettent en avant les cartes en attente d'humains ; les raisons heuristiques sont localisées et ne sont jamais stockées comme identifiants.
- **Revue de livraison (d'après #54)** : le dernier rapport d'exécution et la liste de contrôle sont mis en avant sur les cartes et dans les détails de tâche, avec un historique de rapports étiqueté, des marqueurs de vérification neutres et la copie du chemin en un clic.
- **Projet par défaut (#56)** : les réglages du tableau gagnent un projet par défaut ; les nouvelles tâches en partent quand aucun filtre de tableau n'est défini, et les références pendantes sont ignorées à la lecture.
- **Qualité** : la CI ajoute une vérification de types indépendante et une couverture de régression pour la récupération de verrou, l'état d'attente, les filtres, l'historique de rapports et le projet par défaut ; les compilations s'exécutent automatiquement avant publication.

### 0.9.2

- **Validation des filtres de liste (#52, merci [@Ausli](https://github.com/Ausli))** : les erreurs de filtre de `taskboard_list` remontent désormais en `not_found` / `invalid_input` au lieu de ne rien faire correspondre silencieusement.

### 0.9.1

- Mappe les projets ou exécutions/itérations ZenTao, sélectionne indépendamment Bugs/Stories/Tâches et associe les projets locaux ligne par ligne.
- Synchronise facultativement les portées non liées/nouvelles en cartes sans projet. Les anciennes configurations produit conservent identifiants/tâches et exigent une réassociation.
- Teste le formulaire courant, enregistre des mappages vides, et améliore la disposition et les textes des réglages.
- Corrige la navigation vers la session d'une carte et les réexécutions pour les cartes en cours non tenues sans exécution active (#50).

### 0.9.0

- Ajoute la synchronisation externe ZenTao/TAPD et un contrat de fournisseur partagé ; ZenTao est vérifié contre un déploiement réel. Ajoute la navigation des réglages, la réutilisation de l'assigné de connexion, la gestion des conflits, un statut de synchronisation durable et la limitation des requêtes.
- Retombe sur une nouvelle conversation quand une session liée planifiée ne peut pas être réutilisée (#49).

> 📜 Pour l'historique complet des versions antérieures, voir [changelog.md](changelog.md).
