# Contrat d'adaptateur externe — Task Board v1

**Version de contrat :** `ADAPTER_CONTRACT_VERSION = 1` (`src/shared/external.ts`).
Toute évolution incompatible incrémente cette constante ; le registre refuse une
version inconnue.

## 1. Principe

La synchronisation externe appartient à Task Board. Un **adaptateur** possède
exclusivement le transport, l'authentification et la normalisation d'une plateforme ;
il n'écrit jamais dans le ledger. Le moteur (`ExternalSyncService`) possède les
connexions, le merge, l'autorité des champs, l'idempotence et la persistance.

Un adaptateur **déclare** ses capacités réelles. `assertProviderContract()` vérifie à
l'instanciation que chaque opération déclarée a bien une méthode, et qu'aucune surface
d'écriture n'existe sans être déclarée. Une capacité ne peut donc pas être simulée par
un simple descriptor.

## 2. Opérations (v1)

| Opération | Méthode de l'adaptateur | Sens |
| --- | --- | --- |
| `validateConnection` | `test(signal)` | test de connexion |
| `getCapabilities` | fourni par le registre | document de capacités |
| `discoverProjects` | `listProjects(signal)` | découvrir les scopes |
| `listWorkItems` | `getItems(projectId, signal, context?)` | lister (pagination) |
| `getWorkItem` | `getItem(projectId, type, id, signal)` | lire un élément |
| `createWorkItem` | `createItem(projectId, fields, signal)` | créer |
| `updateWorkItem` | `updateItem(projectId, type, id, patch, signal)` | modifier/fermer |
| `transitionWorkItem` | `transitionItem(...)` | transition de workflow |
| `listComments` / `addComment` | `listComments` / `addComment` | commentaires |
| `syncChanges` | `syncChanges(projectId, signal, cursor?)` | incrémental |

Toute capacité non déclarée est refusée par le registre. Le contrat distingue
explicitement **lecture** (`inbound`), **écriture** (`outbound`) et **actions
interdites** (aucune méthode d'écriture n'est exposée par un adaptateur lecture seule).

## 3. Matrice réellement implémentée

| Adaptateur | Famille | Types | Lecture | Écriture | Découverte | Pagination | Incrémental | Événements | Validation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `zentao` | planning | bug, story, task | oui | non | oui | page | non | poll | mock |
| `tapd` | planning | bug, story, task | oui | non | oui | cursor | non | poll | mock |
| `github` | forge | issue | oui | oui | repos | page | oui (`since`) | poll + webhook | mock |
| `gitlab` | forge | issue | oui | oui | projets | page | non | poll + webhook | mock |
| `gitea` | forge | issue | oui | oui | repos | page | non | poll + webhook | mock |
| `jira` | planning | issue | oui | oui | projets | cursor | non | poll | mock |
| `linear` | planning | issue | oui | oui | équipes | cursor | non | poll | mock |

**Non supportés et non annoncés :** Bitbucket, Azure DevOps, Trello, GitHub Projects,
GitLab Boards. Aucun descriptor factice n'est enregistré pour eux.

« Mock » signifie : validés par des serveurs simulés déterministes (`fetch` injecté,
aucun réseau). Aucun credential réel n'étant disponible, **aucune compatibilité
production n'est affirmée** au-delà des API documentées et des tests de forme.

## 4. Connexions multiples et identité canonique

- Le host peut enregistrer jusqu'à 10 connexions (`{ connections: [...] }`), chacune
  avec son provider, son scope et ses mappings projet. La connexion primaire conserve
  `status.config` pour la compatibilité des clients précédents.
- Une carte peut référencer **plusieurs** items externes via `externalRefs`
  (`system`, `instance`, `kind`, `project`, `id`, `url`, `revision`, `syncedAt`,
  `state`, `provenance`, `primary`). `task.external` reste la source qui pilote la
  synchronisation (référence `primary`).
- L'adoption (`matchExisting`) évite de créer une seconde carte pour un travail déjà
  présent (référence `#N`, URL `…/issues/N` ou titre normalisé identique).

## 5. Autorité des champs et conflits

Autorité par défaut (surchargeable par adaptateur via `capabilities.fieldAuthority`) :

| Champ | Autorité | Conséquence |
| --- | --- | --- |
| `title` | `merge` | distant si local intact, sinon **conflit** à trancher |
| `description` | `merge` | idem |
| `urgency` | `merge` | idem |
| `status` | `local` | le statut local n'est jamais écrasé par un import |
| `assignees` | `local` | jamais écrasé par un import |

Un merge à trois voies utilise `item` (dernier état distant vu) et `pushBase` (dernier
état poussé). Un conflit non résolu **persiste** entre deux tours et bloque le push du
champ concerné ; il se résout via `/external/resolve` (humain) en conservant ou non la
valeur distante. Une description ou une note humaine interne n'est jamais effacée par
un import.

## 6. Synchronisation bidirectionnelle

Le sens par défaut dépend de ce que l'adaptateur déclare :

- `direction: "bidirectional"` (**défaut** dès que l'adaptateur déclare `outbound` +
  `write` + les opérations de création/mise à jour) → le push est autorisé ;
- `direction: "inbound"` → lecture seule ; c'est le **défaut** des adaptateurs
  read-only (ZenTao, TAPD) et l'option explicite pour garder une connexion en lecture ;
- un fichier de connexions **antérieur** à ce contrat (sans `direction` stocké) est chargé
  en `inbound` : une mise à jour ne déclenche jamais d'écriture à distance à l'insu de
  l'opérateur.

La conversation de configuration passe par `GET/POST /external/preview` :
`SyncPreview` compte et échantillonne les créations, adoptions, mises à jour, conflits et
pushes **sans écrire** dans le ledger ni chez le fournisseur.

Politique de push (fail-closed) :
- uniquement les cartes liées, non supprimées, hors exécution en cours ;
- seuls les champs modifiés depuis `pushBase` sont poussés ; un champ adopté depuis le
  distant avance la base, donc un import n'est jamais ré-écrit en écho ;
- un conflit non résolu n'est jamais écrasé ;
- `done` ferme l'item distant (`completed`) et `canceled` (`not_planned`) ; aucune
  réouverture distante automatique ;
- une carte créée depuis Task Board peut être poussée une par une, avec choix du scope.

## 7. Résilience (moteur)

- Pagination bornée (pages/curseurs), limite de 1 000 pages, timeout de 30 s par requête
  et 300 s par tour ; retries sur 429/5xx avec `Retry-After` (max 2), annulation via
  `AbortSignal`.
- Une passe incomplète n'écrit **rien** : le scan complet précède la transaction.
- Idempotence : `pushBase` + diff par champ ; une carte éditée pendant un push en vol
  conserve ses modifications locales (contrôle de version).
- Aucune suppression locale déduite de l'absence d'un item distant : une suppression ou
  un archivage distant est traité comme une suppression de bruit (ignoré) et l'item est
  mémorisé pour ne pas être réimporté.
- Reprise : la configuration et les métadonnées non secrètes sont persistées
  séparément du ledger ; le ledger est écrit atomiquement et verrouillé.
- Multi-connexions : un tour synchrone traite les connexions activées séquentiellement,
  agrège les compteurs et isole les échecs.

## 7 bis. Webhooks entrants (optionnels)

GitHub, GitLab et Gitea/Forgejo implémentent un receiver signé :

`POST /dsh-taskboard/external/webhook/<connectionId>`

- GitHub : `X-Hub-Signature-256: sha256=<HMAC-SHA256 hex>`.
- Gitea/Forgejo : `X-Gitea-Signature: <HMAC-SHA256 hex>`.
- GitLab : `X-Gitlab-Token: <secret>` (comparaison à temps constant).
- Secret stocké host-only dans `credentials.webhookSecret` (jamais renvoyé ; une valeur
  explicite vide le supprime).
- **Le payload n'est jamais appliqué.** Il déclenche uniquement une synchronisation
  tirée par l'API distante, qui reste l'autorité. Un webhook dupliqué (même
  `delivery id`) est acquitté sans second pull ; un événement reçu hors ordre ne peut
  donc pas écraser un état plus récent. La mémoire de déduplication est bornée
  (1 000 ids) et non persistée : après redémarrage, un doublon peut déclencher un pull
  supplémentaire, jamais une corruption.
- `ping` est acquitté sans synchronisation ; un provider sans webhook répond `501` ;
  une connexion sans secret `503` ; une signature invalide `401`.

## 8. Sécurité

- Credentials host-only, jamais renvoyés par `status()`, les exports, les événements ou
  les erreurs.
- `baseUrl` doit être `http(s)`, sans userinfo, query ni fragment.
- Toute réponse distante est validée structurellement ; une URL d'item n'est acceptée
  que si elle est `http(s)`.
- Les corps de réponse d'erreur amont ne sont jamais relayés.
- Les titres/descriptions distants sont des **données non fiables** : jamais une
  autorisation, jamais du HTML exécutable. Les champs HTML (ZenTao/TAPD) passent par
  `trackerText` ; React échappe le rendu.
- Écritures distantes uniquement après accord explicite (`bidirectional`).

## 9. Ajouter un adaptateur

1. Implémenter `ExternalTaskProvider` (`test`, `getItems`) et, si pertinent,
   `ExternalWriteProvider`, `listProjects`, `getAccount`.
2. Créer un descriptor complet : `contractVersion: 1`, `kind`, `authModes`,
   `capabilities.operations`, `directions`, `events`, `limits`, `fieldAuthority`.
3. Fournir une `validate(config)` pour le format des scopes et des settings.
4. Enregistrer la factory dans `createBuiltinProviders()`.
5. Ajouter des tests déterministes avec `fetch` factice : lecture, pagination, écriture,
   erreurs sûres, réponses malformées, conformité `assertProviderContract`.
6. Ajouter les libellés i18n et vérifier `npm run typecheck && npm test`.
