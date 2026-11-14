# DeepSeek Pastel — UI refonte & système de coloration

Statut : **implémenté sur `feat/ui-deepseek-pastel`**, PR draft vers `dev`, **aucune fusion
avant validation visuelle de l'utilisateur**.

## 1. Références

- Maquette (source de vérité graphique) :
  `design-reference/DSH_Task_Board_DeepSeek_Pastel_Maquette_V1.html` (fournie avec la
  commande), aidée des captures `preview-dark.png`, `preview-light.png`,
  `preview-detail.png`, `preview-mobile.png`.
- Maquette **jamais importée en production** : ni son JS de simulation, ni ses données
  fictives, ni sa fausse sidebar DeepSeek. Seuls les tokens, palettes, géométries et
  hiérarchies ont été portés dans `src/client/styles.ts`.
- Validation réelle : plugin chargé dans un hôte DSH isolé (`scripts/qa/pastel-visual-host.ps1`),
  captures et métriques dans [`captures/`](captures) et
  [`visual-report.md`](visual-report.md) / [`metrics.json`](metrics.json).

## 2. Ce qui a changé

### 2.1 Cartes (P0)

| Élément de la maquette | Composant réel | Règle métier inchangée | Test |
| --- | --- | --- | --- |
| surface entièrement teintée, coins 15–18 px, ombre douce | `TaskCard.tsx` + `.dsh-atb-card` | aucune donnée modifiée | `appearance-ui.spec.tsx`, `color-modes.spec.ts` |
| projet + identifiant discrets en tête | `.dsh-atb-card-top` | `workspaceId` inchangé | `color-modes.spec.ts` / `appearance-ui` |
| titre dominant, description 2 lignes (1 en compact) | `.dsh-atb-card-title` / `.dsh-atb-card-desc` | description = donnée existante | `appearance-ui` (préférence descriptions) |
| flags métier (bloqué, approbation, attente humaine, dépendances, sous-tâches, stale, droits, checklist) | `.dsh-atb-card-flags` + `.dsh-atb-badge[data-kind]` | tous conservés | `client-approval`, `client-dependencies`, `human-review-ui` |
| livrable + checklist en revue | `.dsh-atb-card-deliverable` + `.dsh-atb-card-progress` | logique de revue inchangée | `human-review-ui` |
| séparateur + pied (priorité, catégorie, temps) | `.dsh-atb-card-divider` / `.dsh-atb-card-bottom` | priorité toujours explicite (texte + icône) | `color-modes`, `appearance-ui` |
| actions Valider / Renvoyer | `.dsh-atb-quickbtn` | **toujours** `controller.move`/`reject` (jamais de bypass) | `client.spec.ts` (quick actions) |
| badge de priorité compact + icône alerte urgent | `.dsh-atb-card-priority` | `urgency` inchangé | `color-modes` |

L'ancienne **bande de priorité à gauche** (`::before`) est supprimée ; un test l'interdit
explicitement (`::before content: none` + absence du sélecteur dans la feuille).

### 2.2 Colonnes, barre d'outils, panneaux

- Cinq colonnes conservées, en-têtes avec filet de statut, compteur exact, repli
  (`data-collapsed`), scroll indépendant, en-tête de projet **sticky opaque** (test dédié).
- Barre d'outils réorganisée en deux lignes : titre + compteur + « Par projet » +
  « Nouvelle tâche » ; puis recherche, projet, **catégorie**, tri, filtres de priorité,
  attente humaine, autres tâches, réglages, diagnostics, import, export.
- **Navigation de colonnes** (`< 760 px`) : cinq boutons accessibles qui font défiler la
  colonne correspondante, sans seconde navigation applicative.
- Détail, formulaire, réglages modernisés (rayons, espacements, sections), sans retirer
  aucune fonctionnalité ; le détail garde l'historique, les commentaires, les pièces
  jointes, les sessions, les exécutions, les contrôles Git et les approbations.
- Le panneau suit le thème hôte : `light-dark()` + tokens `--dsw-*` ; **aucun**
  attribut/style appliqué à `<html>`/`<body>` (test `does not mutate the host document`).

## 3. Système de coloration (4 modes)

Résolveur unique : `src/client/board/coloring.ts` → `resolveTaskColor({ task, categories, preferences })`.
Purement fonctionnel (aucun DOM, aucune lecture d'état, aucun aléa), donc testable sans
navigateur. Il sépare : couleur sémantique → nuances → intensité (CSS) → thème (CSS) →
variables de rendu (`--atb-card-bg`, `--atb-tone-accent`).

| Mode | Couleur | Personnalisation |
| --- | --- | --- |
| `card` | hash stable de l'id de tâche (palette 8 tons) | choix manuel par carte (détail) + réinitialisation |
| `project` | hash stable de l'id de projet | couleur par projet dans les réglages + réinitialisation globale/par projet |
| `category` (**défaut**) | couleur de la catégorie fonctionnelle | gestionnaire de catégories (ajout/renommage/suppression/réordonnancement/couleur) |
| `priority` | famille d'urgence | 3 couleurs modifiables + interrupteur « Nuancer par catégorie » + réinitialisation |

### 3.1 Palettes

Catégories (référence thème clair ; les variantes sombres sont dérivées et/ou fournies) :

| Catégorie | HEX clair |
| --- | --- |
| Développement | `#a9c8f2` |
| Bug / Correction | `#f1abb4` |
| Design / UI-UX | `#c5b2ef` |
| Documentation | `#9ed9c6` |
| Tests / QA | `#f2c09d` |
| Performance | `#eadd95` |
| Sécurité | `#d6a6c5` |
| Infrastructure / CI | `#a4d6dc` |
| Recherche / R&D | `#b8bbf0` |
| Maintenance | `#c8cdd6` |
| Général / Non classé | `#e4e7ec` |

Priorités : `urgent` `#f1abb4`, `normal` `#c5b2ef`, `relaxed` `#a9c8f2` (clair).
En sombre : `#553238`, `#40355c`, `#2f4159` — mêmes familles.

Palette « par carte / par projet » : violet `#34304d`, sky `#283d50`, mint `#2d4642`,
peach `#4a3a33`, pink `#4b3443`, ink `#323c4f`, yellow `#49412e`, lavender `#3b3454`
(thème sombre, valeurs de la maquette) et leurs équivalents clairs `#e9e3fb`, `#dfeef9`,
`#dff2e8`, `#f9e7d9`, `#f7e3ed`, `#e0e8f4`, `#f7edcf`, `#e6e0f8`.

### 3.2 Camaïeu par catégorie (mode priorité)

- La priorité décide de la **famille** ; la catégorie ne peut déplacer que
  L (± 3,5 %), S (± 5 %) et la teinte de **± 3°** max. Une tâche urgente ne peut donc
  jamais devenir bleue ou violette.
- Les décalages sont dérivés d'un hash FNV-1a de l'id de catégorie : déterministes,
  stables entre sessions, **indépendants de l'ordre** des catégories, définis pour les
  catégories personnalisées, et neutres pour « Général / Non classé ».
- Désactivé : une seule surface par urgence (exactement trois sur le board).
- Catégorie inconnue/supprimée : repli déterministe sur la couleur de base de la priorité.

### 3.3 Intensité et thème

- Trois niveaux : **Discret 45 %**, **Équilibré 75 %** (défaut), **Soutenu 100 %**.
  L'intensité mélange la couleur résolue avec la surface hôte (`color-mix` en oklab) :
  elle change la force du fond, jamais la sémantique.
- Thème : chaque couleur est produite en `light-dark(clair, sombre)` ; DSH publie
  `color-scheme` depuis son thème actif, donc le board suit le shell sans détection JS.
- Contraste vérifié sur les cartes réelles : titre ≥ 9,8:1 (pire cas, mode par catégorie,
  sombre) ; badges ≥ 6,5:1 ; textes secondaires ≥ 5,1:1 (clair) — tous ≥ AA 4,5.

## 4. Données, persistance, compatibilité

### 4.1 Catégories = données utilisateur partagées

- `BoardSettings.categories: TaskCategory[]` (`id`, `name`, `color`, `order`) voyage avec le
  ledger, le JSON export/import et les sauvegardes hôte. 11 catégories d'usine, `general`
  toujours présente et dernière ; max 64 ; validation/tri/normalisation idempotente.
- `BoardSettings.categoryLabelMap`: mapping libellé → catégorie (défauts fournis :
  feature/enhancement→development, bug/fix/defect→bug, design/ui/ux→design, docs→documentation,
  test/qa→tests, performance→performance, security→security, ci/devops→infrastructure).
- `TaskRecord.category`: id stable, optionnel. Validation à l'écriture (id **ou** nom),
  refus explicite d'une valeur inconnue, `null` = non classé. Une catégorie supprimée ne
  supprime aucune tâche : elles retombent sur « Général / Non classé ».
- Les outils agents (`taskboard_create`, `taskboard_update`, `taskboard_list`) acceptent
  et filtrent `category` ; l'import conserve une catégorie valide et ignore une valeur
  malformée ; les synchronisations externes appliquent le mapping **une seule fois** à la
  création d'une carte (jamais de reclassement, jamais d'écrasement d'un choix explicite).

### 4.2 Préférences d'affichage (locales)

`localStorage` clé `dsh-taskboard-appearance-v2` : `colorMode`, `intensity`, `density`,
`descriptions`, `group`, `tones` (par carte), `projectColors` (par projet),
`priorityColors`, `priorityNuance`. Migration automatique de la clé v1
(`vibrancy` % → niveau d'intensité, tons manuels conservés). Payload corrompu → défauts.
Aucune de ces préférences n'entre dans le ledger ni dans les outils agents.

## 5. Tests et validations

Commandes exécutées sur l'arbre final :

```
npm run typecheck   # OK
npm test            # 1282 tests / 95 fichiers — tous verts
npm run build       # OK (86 fichiers, 1,92 MB)
```

Tests dédiés ajoutés :

- `tests/color-modes.spec.ts` — 4 modes, stabilité (hash id/projet), familles de priorité
  pour 11 catégories × 3 priorités × camaïeu on/off, indépendance de l'ordre, catégorie
  inconnue, personnalisation + garde de distinction, intensités, persistance, import JSON,
  validation des réglages, mapping de libellés et précédence, création/filtrage/nettoyage
  par les outils agents.
- `tests/appearance-ui.spec.tsx` — rendu des cartes (projet/id/titre/description/flags/
  pied), préférences publiées sur la racine, bascule regroupement, navigation de colonnes,
  absence de mutation du document hôte, sélecteur de ton du détail, panneau Apparence
  (4 modes, 3 intensités, 3 densités, interrupteurs), réinitialisations.
- `tests/styles-invariants.spec.ts`, `tests/sticky-group-head.spec.ts`,
  `tests/external-ui.spec.tsx` — invariants CSS, sticky opaque, 3 onglets de réglages.

Validation visuelle réelle (hôte DSH isolé, plugin construit depuis l'arbre) : **32/32
contrôles**, captures desktop sombre/clair, détail, mobile 390×844, backlog dense, les
quatre modes, comparaison camaïeu on/off, écrans Apparence, et comparaison numérique avec
la maquette (géométrie/typographie/densités/palette). Voir
[`visual-report.md`](visual-report.md).

Reproduire :

```powershell
npm run build
pwsh -File scripts/qa/pastel-visual-host.ps1 -Label "local"
# captures + metrics.json + visual-report.md dans scripts/qa/reports/pastel-<horodatage>/
```

## 6. Limites connues / suites

- Les noms de catégories sont des **données** (français par défaut, éditables) : ils ne
  sont pas traduits automatiquement au changement de langue de l'interface.
- Le mapping de libellés est éditable en texte (`libellé = id`) ; pas d'éditeur ligne à
  ligne dédié.
- La nuance de priorité est calculée sur l'id de catégorie : deux catégories peuvent
  recevoir des nuances proches (acceptable et documenté dans la spécification).
- La palette de priorités personnalisée est **locale** (par navigateur) ; les catégories,
  elles, sont partagées. Les couleurs personnalisées ne sont validées que par la garde de
  distinction (distance RGB ≥ 60) et le contraste vérifié sur les cartes de test.
- La validation visuelle a été faite dans Brave (Chromium) ; Safari/Firefox ne sont pas
  couverts par l'outillage local (`color-mix`/`light-dark` sont supportés par les versions
  récentes des trois moteurs, mais non mesurés ici).

## 7. Tester dans DeepSeek Harness

1. `npm run build` puis recharger la fenêtre DSH (le profil lie ce dépôt).
2. Ouvrir **Task board** dans la barre latérale.
3. Réglages → **Apparence** : choisir un mode, une intensité, ouvrir le gestionnaire de
   catégories, modifier les couleurs de priorité, observer l'aperçu temps réel.
4. Fiche tâche → choisir une couleur de carte ; constater la persistance après rechargement.
5. Vérifier que les transitions restent contrôlées par le vrai contrôleur (drag/drop
   autorisé seulement, validation humaine finale).
