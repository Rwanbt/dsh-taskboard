# Revue de sécurité indépendante — `feat/universal-sync`

| | |
|---|---|
| **Projet** | `D:\App\dsh-taskboard` (plugin DSH Task Board, `package.json` 0.12.0) |
| **Branche** | `feat/universal-sync` (arbre de travail, **non commité**) |
| **Auditeur** | auditeur indépendant — périmètre d'écriture : ce document + 2 fichiers de tests |
| **Date** | 2026-11-10 (Europe/Paris) |
| **Nature** | revue adverse (white-box) + tests déterministes hors ligne |
| **Périmètre code** | `src/host/public-api.ts`, `src/shared/public-api.ts`, `src/host/external-provider.ts`, `src/host/gitlab.ts`, `src/host/gitea.ts`, `src/host/external-sync.ts`, `src/host/external-config.ts`, `src/host/external-http.ts`, `src/shared/external.ts`, routes GUI `/dsh-taskboard/external/*` et `/dsh-taskboard/public/v1/*` |
| **Tests livrés** | `tests/security-public-api.spec.ts` (37 tests), `tests/security-universal.spec.ts` (28 tests) |

> **État de l'arbre.** L'audit porte sur l'**arbre de travail** (c'est lui que les tests importent), pas sur
> `HEAD` : au démarrage, `src/host/external-sync.ts`, `src/host/routes.ts`, `src/host/external-config.ts`,
> `src/host/external-provider.ts`, `src/host/external-providers.ts`, `src/shared/external.ts` étaient déjà
> modifiés et `src/host/jira.ts`, `src/host/linear.ts` non suivis. Pendant l'audit, l'équipe a continué
> d'ajouter des fonctionnalités au même arbre (webhooks entrants HMAC, Jira/Linear, UI multi-connexions).
> Les références `fichier:ligne` des fichiers **non modifiés** (`public-api.ts`, `store.ts`, `gitea.ts`,
> `gitlab.ts`, `dependencies.ts`, `shared/external.ts`) sont stables ; pour `routes.ts` et
> `external-sync.ts`, elles sont indicatives (vérifiées le 2026-11-10 à ~11:40) et doivent être relues si
> l'arbre bouge. Aucune opération git n'a été effectuée par l'auditeur.

---

## 1. Verdict (après remédiation)

**Pas de vulnérabilité P0. Aucun P1/P2 ouvert à l'issue de la revue.** La surface publique est globalement
bien construite : authentification bearer à comparaison constante, surface fermée par défaut (503),
redaction des credentials, normalisation http(s) des URL distantes, refus des exécutions pilotées par
l'hôte, `done` inatteignable, claim atomique, adaptateurs sans fuite de token ni de corps HTTP, pagination
bornée, fichier de credentials en 0600.

**9 constats ont été identifiés pendant la revue — 2 P1 et 7 P2 — et les 9 ont été corrigés dans la
branche par l'équipe pendant l'audit** (voir « Remédiation appliquée après la revue », en fin de document).
Les analyses des §3 conservent l'état **avant correctif** (avec la valeur observée à l'époque) ; chaque
fiche porte un statut mis à jour et chaque correctif est verrouillé par un test de non-régression vert
dans `tests/security-public-api.spec.ts` / `tests/security-universal.spec.ts` (les anciens `it.fails` ont
été convertis en `it('CORRIGÉ …')`, aucun test supprimé).

- **F-01 (P1) — corrigé** : le *fencing* est désormais obligatoire dès que `fencingToken > 1` (handoff /
  attempt), et `/report` vérifie le fence. Le scénario de *failover* qui laissait le « perdant » régler
  l'exécution est fermé.
- **F-02 (P1) — corrigé** : `record()` prend un seul `snapshot()` et un seul `buildDependencyIndex()` par
  notification ; plus de clones complets du ledger dans la boucle des dépendants.
- **F-03 à F-09 (P2) — corrigés** : idempotence/rejeu liés à `externalActor`, chargement du ledger avant
  réponse, préflight Bearer avant lecture du corps, index unique sur `eligible=true`, décodage de chemin
  en `400`, motifs GitHub/Gitea refusant `.`/`..`.

**Verdict : la surface est prête du point de vue sécurité**, sous les limites assumées du §5 (token unique
board-wide, `actor` déclaré par l'appelant, pas de rate limiting, SSE global) et sous réserve d'auditer les
webhooks entrants ajoutés en cours d'audit (hors périmètre, §5.5).

---

## 2. Méthode

1. **Revue ligne à ligne** des surfaces listées (auth, cycle de vie, événements, adaptateurs, sync,
   configuration, routes GUI).
2. **Tests adverses déterministes, sans réseau** : le service public est piloté via `handle()` avec des
   doubles `IncomingMessage`/`ServerResponse` en mémoire ; les routes réelles sont exercées via le handler
   de préfixe capturé par `registerTaskboardRoutes` (aucun socket) ; les adaptateurs reçoivent un `fetch`
   injecté qui enregistre URL/en-têtes/`redirect` ; les ledgers et fichiers de connexions vivent dans des
   `mkdtemp` jetables.
3. **Tests rouges pour chaque défaut (méthode d'audit)** : `it.fails` vérifiait la propriété de sécurité
   **manquante**. La suite restait verte ; le correctif faisait passer le test de « rouge attendu » à
   « vert ». Chaque test rouge a été exécuté sans le marqueur pour vérifier qu'il échoue **pour la bonne
   raison** (valeurs observées reportées ci-dessous). **Après la remédiation, les tests sont devenus des
   tests de non-régression verts (`it('CORRIGÉ …')`) : ils échouent si un correctif est retiré.**
4. **Analyse statique ciblée** quand le comportement n'est pas observable de l'extérieur (comparaison
   timing-safe, `redirect:'error'`, `mode: 0o600`, absence de `dangerouslySetInnerHTML`, ordre
   lecture-du-corps / authentification).

### Commandes et résultats

```
npm run typecheck                                     → OK (0 erreur)
npx vitest run tests/security-public-api.spec.ts       → 37 passed
npx vitest run tests/security-universal.spec.ts        → 28 passed
npx vitest run                                         → 90 fichiers / 1223 tests passed
```

> Les compteurs de la suite complète sont un instantané : l'arbre de travail est partagé et l'équipe y
> ajoutait des tests pendant l'audit (1222 puis 1223 entre deux exécutions). Les 65 tests de cette revue
> font partie de ce total. **Run final après remédiation : 65/65 tests de sécurité passent, typecheck OK.**

---

## 3. Constats

### 3.1 P0 — aucun

Aucune prise de contrôle sans authentification, aucune fuite de secret exploitable, aucun contournement
complet de l'autorisation, aucune exécution de code, aucun accès inter-utilisateurs (le modèle est un
token unique par tableau — cf. §5).

> **Statut des fiches.** Les neuf constats ci-dessous ont été **corrigés dans la branche pendant la revue**
> (correctifs détaillés dans « Remédiation appliquée après la revue », en fin de document). Les fiches
> conservent l'analyse et les valeurs observées **avant correctif** — elles documentent la faille et son
> exploitation — et leur ligne « Statut » indique l'état actuel. Chaque correctif est verrouillé par un test
> de non-régression vert (`it('CORRIGÉ …')`).

### 3.2 P1 — intégrité / disponibilité

#### F-01 — Le fencing est facultatif et le claim n'est pas transféré au handoff

| | |
|---|---|
| **Sévérité** | P1 — intégrité du contrat d'exécution |
| **Emplacement** | `src/host/public-api.ts:371-373` (`checkFence`), `:383-389` (`ifFencingToken` optionnel), `:447-477` (`handoff`), `:496-503` (`complete`), `:534-557` (`report`), `:366-370` (`requireExternal`) |
| **Statut** | **Corrigé dans la branche pendant l'audit** — `checkFence` exige le token dès `fencingToken > 1` ; `/report` vérifie le fence. Test de non-régression vert. |

**Description.** `ifFencingToken` est optionnel sur toutes les routes de cycle de vie. `handoff` incrémente
`execution.fencingToken` mais **ne transfère pas** `task.claimedBy` : l'acteur d'origine reste « propriétaire »
de la carte alors que la session courante est devenue `s-2`. Le moteur qui vient de céder l'exécution (processus
encore vivant, modèle en échec) peut donc appeler `complete` sans `ifFencingToken` et régler l'exécution
avec ses propres preuves ; il peut aussi appeler `report` (qui ne consulte **ni** le fence **ni** l'état
`running`) et réécrire le rapport de la tentative en cours.

**Exploitabilité.** Préconditions : porter le token bearer (unique, cf. §5) et être l'acteur qui a fait le
claim — c'est-à-dire le scénario nominal de *failover* du contrat. Aucune action humaine requise : un
moteur stale qui termine son travail après le handoff suffit. Conséquence : carte acceptée en `in_review`
sur des preuves périmées, travail du moteur actif orphelin, piste d'audit faussée. Corollaire (analyse) :
`report` n'exigeant pas l'état `running`, une session d'une tentative antérieure peut aussi réécrire un
rapport **après** règlement.

**Preuve (avant correctif — aujourd'hui test de non-régression vert).**

- `tests/security-public-api.spec.ts > CORRIGÉ P1 — fencing obligatoire : après un handoff, la session perdante est refusée (409 stale_execution)`
  → avant correctif : attendu `409`, **observé `200`** (`complete` accepté sans fence après handoff).
- `tests/security-public-api.spec.ts > CORRIGÉ P1 — après un handoff, une session périmée ne peut pas réécrire le rapport (409)`
  → avant correctif : attendu `409`, **observé `200`** (`report` avec `sessionId` périmé + `ifFencingToken:1` accepté).
- Contrôle positif (vert, inchangé) : le même fence **fourni** est bien refusé → `409 stale_execution`
  (`refuse un token de fencing périmé quand il est fourni`).

**Correctif proposé.**

1. **Minimal** : rendre le fence **obligatoire** dès que `execution.fencingToken > 1` sur
   `complete|interrupt|attempts|handoff|report` (refus `409 stale_execution` si absent). Le claim renvoie
   déjà le token ; la première tentative n'en a pas besoin.
2. **Modèle** : persister l'acteur propriétaire sur l'exécution (`execution.actor` au claim), faire du
   handoff un transfert de propriété (nouvel acteur/session), et faire vérifier `requireExternal` contre
   cet acteur courant plutôt que contre `task.claimedBy` (qui n'est pas mis à jour).
3. Appliquer `checkFence` **et** le contrôle `outcome === 'running'` dans `report` (ou réserver `report`
   à l'état courant avec un `ifFencingToken` obligatoire).

---

#### F-02 — `record()` clone le ledger complet une fois par dépendant d'une transition `done`

| | |
|---|---|
| **Sévérité** | P1 — disponibilité (déni de service local, usage normal) |
| **Emplacement** | `src/host/public-api.ts:596-605` (boucle des dépendants), `:164` (abonnement), `src/host/store.ts:251-254` (`snapshot()` = `deepFreeze(structuredClone(ledger))`), `:311-316` (notification sous le verrou d'écriture) |
| **Statut** | **Corrigé dans la branche pendant l'audit** — test de non-régression vert (voir « Remédiation appliquée », fin de document). |

**Description.** À chaque mutation, `record()` est appelé. Pour une carte qui passe à `done`, il parcourt
**tous** les dépendants et appelle `this.options.store.snapshot()` **dans la boucle** (une fois pour
l'itérateur, une fois par dépendant pour `dependencyState`). Or `snapshot()` clone **et gèle** la totalité
du ledger. Le service est abonné **dès sa construction** (`index.ts:310-316`), même quand
`DSH_TASKBOARD_PUBLIC_TOKEN` est absent : toute instance du plugin paie ce coût.

**Exploitabilité.** Aucune attaque requise : une seule transition `done` sur un tableau de N cartes avec N
dépendants déclenche N+1 clones complets **synchrones**, à l'intérieur du verrou d'écriture du store
(les écritures suivantes attendent). Sur un ledger de quelques milliers de cartes (comments/executions),
cela représente des gigaoctets d'allocation et un gel de la boucle d'événements. Un agent qui crée un lot
de cartes dépendantes puis en termine une suffit à provoquer l'incident.

**Preuve (avant correctif — aujourd'hui test de non-régression vert).** `tests/security-public-api.spec.ts > CORRIGÉ P1 — record() réutilise un snapshot et un index uniques`
→ avant correctif : 40 dépendants, **41 `snapshot()` observés** (attendu ≤ 2), message : `record() deep-cloned the ledger 41 times for 40 dependants`. Après correctif : 1 clone.

**Correctif proposé.** Prendre **un seul** snapshot avant la boucle et réutiliser un index :

```ts
const tasks = this.options.store.snapshot().tasks
const index = buildDependencyIndex(tasks)          // déjà exporté par shared/dependencies.ts
// ...
if (!task.blocked && task.status === 'todo' && dependencyState(task, tasks, index).ready) push(task, 'task.ready')
for (const dependent of tasks) { /* ... */ dependencyState(dependent, tasks, index) }
```

(`routes.ts` fait déjà exactement cela pour `/state`, cf. `buildDependencyIndex` — c'est le motif à
répliquer.) Optionnel : ne recalculer `task.ready` que lorsque la mutation peut changer la readiness.

---

### 3.3 P2 — durcissement / robustesse

#### F-03 — Le rejeu idempotent n'est pas lié à l'acteur

| | |
|---|---|
| **Sévérité** | P2 — divulgation inter-acteurs / confusion de claim |
| **Emplacement** | `src/host/public-api.ts:328-331` (recherche sur la seule `idempotencyKey`, dans la carte) |
| **Statut** | **Corrigé dans la branche pendant l'audit** — test de non-régression vert (voir « Remédiation appliquée », fin de document). |

`claim` cherche la clé d'idempotence sur la **tâche** uniquement. Tout porteur du token qui rejoue le même
`taskId` + `idempotencyKey` reçoit **l'enveloppe du premier acteur** (`executionId`, `sessions`,
`worktreePath`, `attempts`) avec **201**, au lieu d'un conflit. Un orchestrateur peut ainsi lire l'identité
de session d'un autre moteur ou croire qu'il détient un claim qu'il n'a pas.

**Preuve.** `CORRIGÉ P2 — le rejeu idempotent est lié à l'acteur (409 already_claimed)` (le titre d'origine de la fiche est conservé dans le test) → avant correctif : attendu `409`, **observé `201`** ; après correctif : `409`, et le rejeu du propriétaire reste idempotent (`201`, même enveloppe).

**Correctif.** Persister l'acteur au claim (`execution.actor`) et n'accepter le rejeu que si
`execution.actor === request.actor` ; sinon `409 already_claimed` (ou `403`). À défaut, inclure l'acteur
dans la clé d'idempotence réservée à la tâche.

---

#### F-04 — Le rejeu d'une exécution déjà réglée ignore l'acteur

| | |
|---|---|
| **Sévérité** | P2 — divulgation inter-acteurs |
| **Emplacement** | `src/host/public-api.ts:496-503` (retour « déjà réglé » **avant** le contrôle `task.claimedBy === actor`) |
| **Statut** | **Corrigé dans la branche pendant l'audit** — test de non-régression vert (voir « Remédiation appliquée », fin de document). |

Si l'exécution est déjà réglée avec le **même** outcome, `complete` renvoie `200` avec la vue complète
(sessions, `worktreePath`, rapport) à **n'importe quel** acteur : le contrôle d'acteur est sous ce retour
anticipé.

**Preuve.** `CORRIGÉ P2 — le rejeu d'une exécution réglée est réservé à l'acteur propriétaire (403)` → avant correctif : attendu `403`, **observé `200`** ; après correctif : `403`, rejeu du propriétaire `200` (idempotent).

**Correctif.** Enregistrer le propriétaire du règlement (`execution.actor` / `settledBy`) et vérifier
l'acteur **avant** le retour idempotent ; sinon `403`.

---

#### F-05 — Un GET public sur un store non chargé répond une board vide

| | |
|---|---|
| **Sévérité** | P2 — disponibilité / intégrité de lecture (pas de confidentialité) |
| **Emplacement** | `src/host/routes.ts:478-482` (dispatch du préfixe public **avant** `options.ready?.()`), `src/host/public-api.ts:238-240` (`liveTasks`), `src/host/store.ts:251-254` (`snapshot()` ne charge pas) |
| **Statut** | **Corrigé dans la branche pendant l'audit** — test de non-régression vert (voir « Remédiation appliquée », fin de document). |

La branche publique est dispatchée **avant** la barrière de readiness, et le service n'appelle jamais
`store.load()`. Or `snapshot()` renvoie le ledger **en mémoire** (vide au démarrage) sans charger le
fichier. Conséquences : juste après un redémarrage, `GET /tasks` répond `{tasks: []}` (un orchestrateur
peut conclure que le tableau est vide et s'arrêter) ; un ledger corrompu **pas encore chargé** est masqué
comme « vide » au lieu d'échouer fermé.

**Preuve.** `CORRIGÉ P2 — un GET sur un store non chargé répond une board vide au lieu de lire le ledger`
→ attendu `['t-persisted']`, **observé `[]`**.

**Correctif.** `await this.options.store.load()` (ou `await options.ready?.()`) avant `publicApi.handle`,
et mapper un échec de chargement sur une erreur typée `503 ledger_unavailable` (message générique, sans
chemin hôte).

---

#### F-06 — Le corps public (≤ 5 Mio) est lu et parsé avant l'authentification

| | |
|---|---|
| **Sévérité** | P2 — durcissement DoS (borné) |
| **Emplacement** | `src/host/routes.ts:478-482` (`await readBody(req)` puis `publicApi.handle`), `src/host/public-api.ts:174-180` (`authorised` à l'intérieur du service), `src/host/routes.ts:72,217-232` (cap 5 Mio), `:498` (413 côté GUI seulement) |
| **Statut** | **Corrigé dans la branche pendant l'audit** — test de non-régression vert (voir « Remédiation appliquée », fin de document). |

Le body est **intégralement bufferisé et parsé** avant que le bearer ne soit vérifié. Un appelant **non
authentifié** peut donc forcer un `JSON.parse` de 5 Mio par requête (amplification CPU/mémoire à
l'interface). L'exposition reste **bornée** par `MAX_BODY_BYTES` (5 Mio) : ce n'est pas un puits sans
limite, d'où P2. Effet de bord : sur la route publique, un corps trop gros remonte au `catch` global en
**500** (`internal`) au lieu du **413** de la route GUI.

**Preuve.** `CORRIGÉ P2 — un POST public non authentifié fait lire et parser le corps avant le 401` (titre d'origine ; le test vérifie désormais l'ordre inverse) :
le handler de route réel est exercé avec un corps de 4 Mio streamé ; réponse `401` (correcte) mais
**tous les chunks ont été consommés avant le contrôle du bearer** (attendu : 0 chunk). Le test
`le transport borne le corps HTTP (MAX_BODY_BYTES)` verrouille la borne existante.

**Correctif.** Authentifier avant de lire : soit exposer un `publicApi.authorise(req)` appelé par
`routes.ts` avant `readBody`, soit laisser le service lire lui-même un corps borné (et renvoyer `413`).
Mapper le dépassement sur `413 invalid_input` sur le chemin public.

---

#### F-07 — `/tasks?eligible=true` reconstruit l'index de dépendances par tâche (O(n²))

| | |
|---|---|
| **Sévérité** | P2 — disponibilité (borne d'authentification requise) |
| **Emplacement** | `src/host/public-api.ts:249-254` (ligne 252 : `dependencyState(task, tasks)` sans index), `src/shared/dependencies.ts:68-70` (l'index existe et documente le piège O(n²)), `src/host/routes.ts:541,941` (motif correct) |
| **Statut** | **Corrigé dans la branche pendant l'audit** — test de non-régression vert (voir « Remédiation appliquée », fin de document). |

Pour chaque carte éligible, `dependencyState` rappelle `buildDependencyIndex(tasks)` : n constructions de
Map de n entrées par requête. Sur 10 000 cartes : ~50 M d'insertions et une réponse très lente — un
porteur de token peut saturer le host à lui seul (aucun rate limiting, cf. §5).

**Preuve.** `CORRIGÉ P2 — /tasks?eligible=true reconstruit l'index de dépendances pour chaque tâche (O(n²))` (titre d'origine ; le test vérifie désormais l'index unique) :
→ 30 cartes, **930 lectures d'id** observées (un index unique ≈ 60 ; seuil 120).

**Correctif.** `const index = buildDependencyIndex(tasks)` une fois par requête, puis
`dependencyState(task, tasks, index)`.

---

#### F-08 — Un encodage pourcenté malformé renvoie 500 au lieu de 400

| | |
|---|---|
| **Sévérité** | P2 — robustesse / masquage d'erreur |
| **Emplacement** | `src/host/public-api.ts:215,217,219,223` (`decodeURIComponent`), `:193-197` (catch générique → 500) |
| **Statut** | **Corrigé dans la branche pendant l'audit** — test de non-régression vert (voir « Remédiation appliquée », fin de document). |

`decodeURIComponent` lève une `URIError` qui n'est pas une `PublicApiError` : elle tombe dans le `catch`
générique et produit `500 internal`. Une entrée client invalide est rapportée comme une panne serveur
(bruit d'alerte, pas de fuite).

**Preuve.** `CORRIGÉ P2 — un encodage pourcenté malformé renvoie 500 au lieu de 400` (titre d'origine ; le test exige désormais `400`) → `/tasks/%C0`,
`/tasks/%C0/dependencies`, `/executions/%C0` : attendu `400 invalid_input`, **observé `500 internal`**.

**Correctif.** Encapsuler les décodages ou mapper `URIError` → `400 invalid_input` dans le `catch` de
`handle`.

---

#### F-09 — Gitea : scope `a/..` interpolé sans encodage (traversée de chemin)

| | |
|---|---|
| **Sévérité** | P2 — défense en profondeur (configuration/ledger importé) |
| **Emplacement** | `src/host/gitea.ts:6` (`GITEA_REPO_PATTERN` accepte `.`/`..`), `:44-47` (`scope`), `:116,172,183,206,219` (interpolation brute `\`/repos/${owner}/${repo}\``) ; même motif côté `github.ts:40-45` ; `src/host/external-providers.ts` (validation du mapping) |
| **Statut** | **Corrigé dans la branche pendant l'audit** — test de non-régression vert (voir « Remédiation appliquée », fin de document). |

Le motif autorise un segment `.` ou `..`. `scope('a/..')` produit `/repos/a/../issues`, que le parseur
d'URL normalise en **`/api/v1/repos/issues`** : la requête (avec le token bearer dans l'en-tête) sort du
dépôt mappé et atteint un autre endpoint du même hôte. Le scope vient de la configuration ou, pour un
push, de `task.external.item.projectId` d'un **ledger importé** (`normalizeExternalSource` ne valide pas
le `projectId` contre les mappings). GitLab est **sain** car il encode le chemin complet
(`gitlab.ts:48-51`, `encodeURIComponent`).

**Preuve.** `CORRIGÉ P2 — Gitea accepte « a/.. » et interpole le scope sans encodage (traversée)` (titre d'origine ; le test exige désormais le refus avant requête) :
chemin observé `/api/v1/repos/issues` au lieu de rester sous `/api/v1/repos/a/…`. Test vert de contrôle :
GitLab conserve `/api/v4/projects/group%2F..%2Fnested/...` (aucun segment `..`).

**Correctif.** Rejeter les segments `.`/`..` (dans `GITEA_REPO_PATTERN`, `REPO_PATTERN` GitHub, et la
validation de mapping), et encoder chaque segment (`encodeURIComponent(owner)`, `encodeURIComponent(repo)`)
en défense en profondeur. Avant un push, vérifier que `task.external.item.projectId` correspond à un
mapping de la connexion.

---

## 4. Protections vérifiées (tests verts)

### 4.1 Authentification (`tests/security-public-api.spec.ts`)

| Vérification | Résultat |
|---|---|
| Surface désactivée sans token (`undefined`, `''`, `'   '`) → **503** sur toutes les routes (y compris SSE), jamais de flux | ✅ |
| En-tête absent / vide / faux / préfixe / suffixe / `Basic` / sans schéma / `bearer` minuscule → **401** ; `Bearer` + espaces → 200 | ✅ |
| Le token attendu n'apparaît ni dans les corps (200 et 4xx) ni dans les en-têtes | ✅ |
| Comparaison **à temps constant** : SHA-256 des deux côtés + `timingSafeEqual`, aucun `===` sur le token (analyse statique) | ✅ |
| En-tête dupliqué (joint par Node) refusé | ✅ |

### 4.2 Secrets (`tests/security-public-api.spec.ts` + `tests/security-universal.spec.ts`)

| Vérification | Résultat |
|---|---|
| `status()` : aucune valeur de credential, `credentialPresent` booléens, `credentialValues` limité aux champs `secret:false` explicites (username) | ✅ |
| **Fail-closed** : un champ sensible non marqué `secret` (TAPD `apiPassword`) n'est pas exposé | ✅ |
| Aucune variable d'environnement de l'hôte (token réel via `DSH_TASKBOARD_PUBLIC_TOKEN`, marqueur) dans les projections publiques ou les frames SSE | ✅ |
| Échec de sync : message générique, ni credential ni corps distant, ni dans `lastError` | ✅ |
| Ledger (tâches, `external`, commentaires, rapports, `externalSync`) sans credential après un cycle | ✅ |
| Fichier de connexions : `mode: 0o600` + écriture temp/rename (test : bits POSIX vérifiés sur POSIX ; sur cette machine Windows, le test vérifie l'intention dans la source, les ACL n'étant pas des bits POSIX) | ✅ |

### 4.3 Autorisations du cycle de vie

| Vérification | Résultat |
|---|---|
| Exécution `managedBy:'board'` (hôte) : `session/attempts/handoff/complete/interrupt/report` → **403**, aucune écriture | ✅ |
| `done` inatteignable : succès → `in_review`, `claimedBy` libéré ; `outcome:'done'` → **400** ; carte trashée → **404** | ✅ |
| Acteur tiers (règlement, interruption, handoff, attempt, session, rapport) → **403** | ✅ |
| Claim hors périmètre projet (`workspaceId` fourni et différent) → **403** (mais frontière volontaire, cf. §5) | ✅ |
| Fencing **fourni** périmé → **409 `stale_execution`** ; token frais → 200 | ✅ |
| Fencing **obligatoire** dès `fencingToken > 1` : absence après handoff → **409** ; la session courante (token 2) passe | ✅ |
| `/report` d'une session périmée après handoff → **409** ; session courante → 200 | ✅ |
| Rejeu idempotent de l'acteur légitime → même enveloppe, 201 ; autre acteur → **409 `already_claimed`** | ✅ |
| Rejeu d'une exécution réglée : acteur propriétaire → 200 idempotent ; autre acteur → **403** | ✅ |

### 4.4 Concurrence

| Vérification | Résultat |
|---|---|
| Deux claims simultanés → exactement un `201` / un `409`, une seule exécution, `claimedBy` = gagnant, version +1 | ✅ |
| Deux complétions simultanées identiques → `200/200`, une seule transition, `in_review`, version +1 | ✅ |
| Deux complétions simultanées opposées → un `200` / un `409`, l'état de la carte suit le gagnant, aucun état partiel | ✅ |
| Claim perdu : la carte reste cohérente et le perdant ne peut pas se l'approprier par rejeu | ✅ |

### 4.5 Entrées / ressources

| Vérification | Résultat |
|---|---|
| `limit` borné (9999→100, 0→1, négatif→1, NaN→50), `cursor` négatif→0, `status` inconnu→0, `next` correct | ✅ |
| Événements : `limit` ≤ 500, `since` négatif→0, `since` futur→0, `resync:true` après redémarrage | ✅ |
| Champs trop longs / mal typés (`actor` 201, `taskId` non-string, absent) → **400** sans écriture (version inchangée) | ✅ |
| Rapport : `summary` > 2000 → **400** ; liste > 50 → **400** ; 50 acceptées | ✅ |
| `MAX_BODY_BYTES` = 5 Mio, `readBody` jette au-delà (garde-fou statique) | ✅ |
| **Préflight Bearer avant lecture du corps** : un POST non authentifié ne consomme **aucun** chunk (4 Mio streamés) | ✅ |
| Store chargé avant la première réponse : un ledger persisté n'est jamais servi comme board vide | ✅ |
| Route inconnue / méthode non gérée → **404** | ✅ |

### 4.6 SSE

| Vérification | Résultat |
|---|---|
| Sans bearer : **401** JSON, en-tête `application/json` (jamais `text/event-stream`), aucune frame après une mutation ultérieure | ✅ |
| Rejeu depuis `since`, `hello` avec `oldestSeq/latestSeq/resync`, poussée des nouveaux événements (`execution.started`) | ✅ |
| Coupure propre : `close` retire le flux, plus aucune frame ensuite | ✅ |
| `dispose()` termine tous les flux ouverts | ✅ |
| Aucun token / secret d'environnement dans les frames | ✅ |

### 4.7 Sync universel

| Vérification | Résultat |
|---|---|
| Multi-connexions : 10 max, 11ᵉ refusée, `connectionStates` isolés, identifiants inconnus refusés, aucun credential dans les 10 connexions | ✅ |
| Réutilisation des credentials **uniquement** à identité identique (provider/baseUrl/account/authMode) ; changement d'hôte sans credential → refus, état et fichier inchangés | ✅ |
| URL de base : protocoles non http(s), credentials embarqués, query, hash refusés ; slash final normalisé | ✅ |
| `direction:'bidirectional'` refusée pour un fournisseur read-only | ✅ |
| **Write-back opt-in** : capacité d'écriture seule → aucun push, `pushTask` refusé, `preview.outbound=0` ; `bidirectional` explicite → push effectif (1 mise à jour) | ✅ |
| `preview` strictement en lecture (aucun écrit local ni distant) | ✅ |
| Injection : `javascript:`/`JAVASCRIPT:`/`data:`/`file:`/`vbscript:`/URL relative → source rejetée ; titre HTML conservé **comme donnée** (échappé au rendu) | ✅ |
| `normalizeExternalReferences` : http(s) uniquement, déduplication canonique, plafond 20 | ✅ |
| `trackerText` neutralise `<script>`/`<style>`/balises et décode les entités | ✅ |
| **Prototype pollution** : `__proto__`/`constructor.prototype` dans item, enregistrements de sync et credentials → `Object.prototype` intact, clés inconnues supprimées | ✅ |
| Adaptateurs : token uniquement en en-tête (`PRIVATE-TOKEN`, `Authorization: token`), jamais dans l'URL ; `redirect:'error'` (pas de fuite vers un autre hôte) | ✅ |
| Erreurs 401/403/404/429 mappées en messages fixes, sans corps ni token ; 4xx non réessayés, 429 réessayé au plus 2 fois | ✅ |
| Scope et identifiants validés **avant** toute requête (`a/b/extra`, `7/..`, `0`, `7?x=1`, type non supporté) | ✅ |
| Gitea/GitHub : segments `.`/`..` refusés par le motif **avant toute requête** (traversée fermée) ; GitLab encode le chemin | ✅ |
| Pagination bornée : 1000 pages puis `pagination limit exceeded` (pas de lecture illimitée) | ✅ |
| Contrat d'adaptateur : opération déclarée non implémentée, write non déclaré, outbound sans write, version inconnue, `listWorkItems` manquant, IDs/opérations invalides → refus | ✅ |

### 4.8 Rendu React (`jsdom`, `ExternalSourcePanel`)

| Vérification | Résultat |
|---|---|
| Titre distant `<img onerror>` / `<script>` : aucun élément `img`/`script` créé, `globalThis.__pwned` absent, markup visible **en texte** | ✅ |
| Ancre : `href` = URL validée, `target="_blank"`, `rel="noopener noreferrer"` | ✅ |
| URL `javascript:` dans le ledger : `normalizeExternalSource` la rejette → **aucun** lien rendu (`innerHTML` vide) | ✅ |
| Aucun `dangerouslySetInnerHTML` dans `src/client/board/*.tsx` (analyse statique) ; l'ancre dérive du normaliseur | ✅ |

---

## 5. Limites assumées

Ces points ne sont **pas** des vulnérabilités dans le modèle de déploiement documenté ; ils bornent la
portée des constats et doivent être connus de l'exploitant.

1. **Token unique, board-wide, non lié à un projet.** `DSH_TASKBOARD_PUBLIC_TOKEN` authentifie un
   consommateur sur **tout** le tableau. `actor` est **déclaré par l'appelant** : tout porteur du token
   peut s'attribuer n'importe quelle identité d'acteur (le contrôle `claimedBy` protège contre les erreurs,
   pas contre un porteur malveillant). C'est la racine commune de F-03/F-04 et la raison pour laquelle
   F-01 est classé P1 (précondition : porteur du token).
2. **Frontière de projet volontaire.** `claim` refuse un `workspaceId` différent **si l'appelant le
   fournit** ; sans ce champ, n'importe quelle carte de n'importe quel projet est réclamable (comportement
   documenté par le contrat, testé comme tel). Aucun scoping par token n'existe.
3. **Pas de rate limiting** sur `/dsh-taskboard/public/v1/*` ni sur `/dsh-taskboard/external/*`. Les
   bornes sont par requête (`limit`, `since`, `MAX_BODY_BYTES`, anneau d'événements 2 000), pas par
   fréquence. Un porteur de token peut marteler les routes (cf. F-07).
4. **SSE global.** Un flux reçoit les événements de **tous** les projets ; il n'y a ni filtre par projet
   ni isolation multi-consommateurs (cohérent avec le token unique). L'anneau de 2 000 événements est
   volatile : un redémarrage renvoie `resync: true` (comportement voulu, testé).
5. **Pas de webhooks entrants dans le périmètre audité.** La surface listée n'en comportait pas au
   démarrage de l'audit ; l'équipe en a ajouté (HMAC) **pendant** l'audit, dans le même arbre. Ces routes
   (`/dsh-taskboard/external/webhook/:id`, `readRawBody`, secrets de webhook) **n'ont pas été auditées**
   et ne sont couvertes par aucun test de ce lot : à faire relire avant mise en production.
6. **Pas de credentials réels / pas de réseau.** Les adaptateurs sont exercés avec un `fetch` injecté ; les
   serveurs GitLab/Gitea/GitHub/Jira/Linear réels n'ont pas été contactés. Les comportements de rate limit
   réels, de proxy, de TLS ou de redirection HTTP ne sont pas couverts (la redirection est refusée par
   conception, `redirect:'error'`).
7. **Windows.** Les bits de permission POSIX (0600) ne sont pas applicables ; la vérification
   d'environnement se limite à l'intention du code (`mode: 0o600` + temp/rename) et à l'ACL du profil. Sur
   POSIX, le test vérifie `mode & 0o777 === 0o600`.
8. **Jira / Linear / TAPD / ZenTao / GitHub** : ajoutés ou modifiés pendant l'audit (Jira, Linear) ou hors
   nouveau périmètre. Seuls GitLab et Gitea ont été audités en profondeur (adaptateurs « nouveaux ») ;
   GitHub partage le motif de scope de Gitea (F-09) et a été vérifié par lecture.
9. **Pas de test de rendu DOM exhaustif.** Le test React couvre le panneau de provenance
   (`ExternalSourcePanel`) ; le reste de l'UI externe est couvert par la suite existante
   (`tests/external-ui.spec.tsx`) et par l'analyse statique (aucune injection HTML directe).
10. **Résidu de migration du correctif F-03/F-04.** Le contrôle d'acteur ajouté est *fail-open* pour les
   exécutions **sans** `externalActor` : `if (replay.externalActor !== undefined && replay.externalActor !== actor)`
   (`public-api.ts:355`) et le même garde sur le rejeu d'un règlement (`:535`). Une exécution créée **avant**
   le correctif (ou importée d'un ledger historique sans ce champ) reste donc rejouable par un autre acteur.
   Risque faible (exécutions historiques, token unique) ; à traiter par une migration/backfill
   (`externalActor` ← `claimedBy` de la carte) si le multi-consommateur devient réel.

---

## 6. Reproduire

```powershell
# depuis D:\App\dsh-taskboard (branche feat/universal-sync)
npm run typecheck

# Les 65 tests de la revue (déterministes, hors ligne)
npx vitest run tests/security-public-api.spec.ts tests/security-universal.spec.ts

# Suite complète
npx vitest run

# Inspecter le comportement ACTUEL d'un constat (le test devient rouge explicite) :
#   remplacer temporairement  it.fails('DÉFAUT ...  par  it('DÉFAUT ...
# puis lire le message (status/valeur observés).
```

Chaque constat porte un test nommé `DÉFAUT <sévérité> — …` dans l'un des deux fichiers ; le commentaire du
test cite le fichier:ligne, l'impact et le correctif. Aucun test ne dépend du réseau, de l'heure réelle,
d'un ordre d'exécution ou d'un état global (hors `process.env` restauré en `afterEach`).

### Matrice exigences → preuves

| Exigence | Où |
|---|---|
| Secrets absents de `status()`, exports, SSE, erreurs, logs | §4.2, F-04 |
| Auth : 503 sans token, 401 token vide/faux, timing-safe, pas de fuite | §4.1 |
| Body/DoS : tailles bornées, `limit`/`since`/`cursor` validés, pagination bornée | §4.5, F-06, F-07 |
| Injection de tickets : `javascript:`/`<script>`/HTML jamais cliquables | §4.7, §4.8, F-09 |
| Autorisations : acteur, `managedBy:'board'`, `done`, cross-workspace, idempotence, fencing | §4.3, F-01, F-03, F-04 |
| Concurrence : claims/complétions simultanés, état cohérent | §4.4 |
| Fichiers : 0600, pas de credentials dans commentaires/rapports | §4.2 |
| SSE : bearer, coupure propre, pas de fuite inter-connexions | §4.6, §5.4 |
| Adaptateurs : URL/ids validés, prototype pollution, erreurs 401/403/404/429 | §4.7, F-09 |

---

## 7. Conclusion (après remédiation)

La branche `feat/universal-sync` présente une base de sécurité **solide** : la surface publique est fermée
par défaut, l'authentification est correctement implémentée (comparaison à temps constant, préflight avant
lecture du corps), les secrets sont contenus, les URL distantes sont normalisées, les garde-fous
d'autorisation du cycle de vie (claim atomique, hôte non pilotable, `done` interdit, fencing obligatoire
après handoff) fonctionnent, et les coûts des chemins chauds sont bornés.

Les **neuf constats** identifiés par la revue — 2 P1 (fencing facultatif, clone du ledger par dépendant) et
7 P2 — ont été **corrigés dans la branche pendant l'audit** et sont désormais couverts par des tests de
non-régression verts. Aucun P0 n'a été identifié.

**Verdict final : la surface est prête du point de vue sécurité**, sous les limites assumées du §5 — token
unique board-wide et `actor` déclaré par l'appelant, frontière de projet volontaire, absence de rate
limiting, SSE global, permissions POSIX non applicables sous Windows — et sous réserve d'auditer les
webhooks entrants ajoutés en cours d'audit (hors périmètre, §5.5) et de traiter le résidu de migration
`externalActor` (§5.10).

Points de vigilance pour la suite : conserver les 65 tests de la revue dans la CI (ils verrouillent chaque
correctif), et rejouer cette revue si le modèle d'authentification évolue vers plusieurs tokens ou un
scoping par projet.

---

## 8. Remédiation appliquée après la revue (Lead, 2026-11-10)

Les 9 constats ont été corrigés dans la branche ; les tests de défense sont désormais
verts (les anciens tests `it.fails` ont été convertis en tests de non-régression
`CORRIGÉ …`). Aucun test de sécurité n'a été supprimé.

| Constat | Correctif appliqué | Preuve |
| --- | --- | --- |
| F-01 (P1) — fencing facultatif après handoff | `checkFence` refuse désormais l'absence de `ifFencingToken` dès que `fencingToken > 1` (handoff/attempt) ; `/report` vérifie aussi le fence. | `security-public-api.spec.ts` — CORRIGÉ P1 |
| F-02 (P1) — clone du ledger par dépendant | `record()` prend un seul `snapshot()` et un `buildDependencyIndex()` par notification. | CORRIGÉ P1 |
| F-03 (P2) — idempotence non liée à l'acteur | `ExecutionRecord.externalActor` est enregistré au claim ; un rejeu d'une autre identité renvoie `already_claimed`. | CORRIGÉ P2 |
| F-04 (P2) — rejeu ignorait l'acteur | un règlement déjà effectué n'est rejouable que par `externalActor`. | CORRIGÉ P2 |
| F-05 (P2) — board vide sur store non chargé | `PublicApiService` attend `store.load()` avant toute réponse ; l'échec de chargement échoue fermé. | CORRIGÉ P2 |
| F-06 (P2) — corps lu avant authentification | `preflight()` vérifie le Bearer avant toute lecture du corps ; le transport l'appelle avant `readBody`. | CORRIGÉ P2 |
| F-07 (P2) — O(n²) sur `eligible=true` | un seul `buildDependencyIndex` par requête, réutilisé par tous les `dependencyState`. | CORRIGÉ P2 |
| F-08 (P2) — encodage malformé → 500 | décodage de chemin explicite → `400 invalid_input`. | CORRIGÉ P2 |
| F-09 (P2) — `a/..` Gitea | les patterns GitHub/Gitea refusent les segments `.`/`..` avant toute requête (GitLab encodait déjà le chemin). | CORRIGÉ P2 |

**Verdict après remédiation : aucun P0/P1 ouvert.** Les P2 sont corrigés ou documentés
comme limites de durcissement ; F-06 reste borné par la limite de corps de 5 Mio même en
cas de régression du préflight.
