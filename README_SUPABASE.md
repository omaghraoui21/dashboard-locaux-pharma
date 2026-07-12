# Dashboard des locaux d’activité — Supabase hybride v4

Ce projet fournit un dashboard HTML multi-postes et multi-utilisateurs protégé par Supabase Auth et RLS. Le cache `localStorage` assure la continuité d'une session déjà autorisée lors d'une coupure de synchronisation.

Il s’agit d’un outil industriel de pilotage opérationnel. Il n’intègre aucune logique de conformité GxP, signature électronique ou audit trail réglementaire.

## Démarrage local avec Supabase

Le paquet de production pointe déjà vers `trs-pharma`. Une session Supabase avec un profil `manager` ou `planner` est obligatoire pour afficher les données.

```bash
cd dashboard_locaux_supabase_v4_package
./serve.sh                 # http://127.0.0.1:8765/dashboard_4_locaux_pharma.html
./smoke_check.sh           # checks HTTP + intégrité fichiers
# Arrêt: kill $(cat /tmp/pharma-dashboard.pid)
```

Voir aussi `TOKENS_ET_DEPLOIEMENT.md` (ce qui est optionnel vs obligatoire).

### Usine (v1 simple)

| Local | Rôle |
|-------|------|
| A23 | Process (pesée / mélange) |
| A27 | Géluleuse |
| A26 | Stock SF / MP (+ mouvements E/S) |
| A28 | Blistéreuse |
| D08 | Cond. sec. continuité → clôture « vers magasin » |
| D18 | Assemblage Combifor / pochettes → « vers magasin » |

- **Articles** FSF/PF/pochettes : bouton *Articles* (planificateur)
- **Import planning** : *Import CSV* (Excel → CSV UTF-8) avec relecture avant application
- **Stock A26** : entrées/sorties qté théorique (manager + planificateur)
- Clôture A23/A27 → activité stock A26 auto (corrigeable)
- Rôles Manager et Planificateur fournis uniquement par Supabase

Variables optionnelles : `PORT` (défaut `8765`), `HOST` (défaut `127.0.0.1`).

Pour le multi-postes / multi-utilisateurs, suivre les sections Supabase ci-dessous. La publishable key peut être publique ; ne jamais utiliser une clé `service_role` ou un jeton de gestion dans le navigateur.

## Fichiers

- `dashboard_4_locaux_pharma.html` : dashboard v4 intégré.
- `supabase-client.js` : authentification, CRUD Supabase, Realtime et file hors-ligne.
- `supabase_schema.sql` : schéma PostgreSQL, contraintes, RLS et publication Realtime.
- `serve.sh` : démarre le serveur HTTP local.
- `smoke_check.sh` : validation déploiement local (HTTP + cohérence).

## 1. Créer et préparer Supabase

1. Créer un projet Supabase.
2. Ouvrir **SQL Editor**.
3. Coller et exécuter entièrement `supabase_schema.sql`.
4. Exposer le schéma `locaux_dash` dans **API Settings > Exposed schemas**, puis vérifier les tables suivantes :
   - `rooms`
   - `activities`
   - `settings`
   - `profiles`
   - `change_log`
   - `articles`
   - `stock_movements`
5. Dans **Authentication**, activer l’authentification e-mail souhaitée :
   - e-mail + mot de passe ;
   - magic link.
6. Pour les magic links, renseigner le **Site URL** et les URL de redirection autorisées.

Le script ajoute les six tables partagées (hors `profiles`) à la publication `supabase_realtime`.

## 2. Créer les utilisateurs et attribuer les rôles

Créer ou inviter les utilisateurs dans **Authentication > Users**, puis créer explicitement leur profil. L'inscription publique et l'auto-provisionnement sont désactivés.

Pour attribuer le rôle Planificateur :

```sql
insert into locaux_dash.profiles (id, display_name, role)
select id, 'Planificateur', 'planner'
from auth.users
where email = 'planificateur@entreprise.tn'
on conflict (id) do update set role = excluded.role;
```

Contrôle :

```sql
select p.id, u.email, p.display_name, p.role
from locaux_dash.profiles p
join auth.users u on u.id = p.id
order by u.email;
```

Le rôle ne peut pas être modifié depuis le navigateur. Cette séparation évite qu’un utilisateur s’attribue lui-même le rôle Planificateur.

## 3. Configurer le client HTML

Dans la fin de `dashboard_4_locaux_pharma.html`, remplacer :

```js
window.PHARMA_SUPABASE_CONFIG = {
  enabled: true,
  url: 'https://VOTRE-PROJET.supabase.co',
  publishableKey: 'sb_publishable_...',
  redirectTo: 'https://votre-domaine/dashboard_4_locaux_pharma.html',
  schema: 'locaux_dash'
};
```

Utiliser uniquement une **publishable key**. Une ancienne clé `anon` fonctionne également, mais ne jamais placer une clé `secret` ou `service_role` dans le HTML.

Le client charge `@supabase/supabase-js` v2 depuis le CDN seulement lorsque `enabled` vaut `true`. Si le CDN ou Supabase est indisponible, le dashboard reste en mode local.

## 4. Servir les fichiers

Conserver au minimum ces trois fichiers dans le même dossier :

```text
dashboard_4_locaux_pharma.html
supabase-client.js
plant-domain.js
```

Pour un test local :

```bash
python -m http.server 8080
```

Puis ouvrir :

```text
http://localhost:8080/dashboard_4_locaux_pharma.html
```

Un hébergement HTTP(S) est recommandé. Les magic links nécessitent une URL de redirection HTTP(S) autorisée dans Supabase.

## 5. Première connexion

1. Ouvrir le dashboard.
2. Cliquer sur **Connexion**.
3. Se connecter par mot de passe ou demander un magic link.
4. Le rôle affiché vient de la table `profiles` :
   - Manager : lecture et mouvements de stock A26 ;
   - Planificateur : création, modification, clôture, paramètres et gestion des locaux.

Le rôle affiché est toujours fourni par Supabase. Aucun mode local ne contourne l'écran de connexion.

## 6. Fonctionnement de la synchronisation

### Écriture locale immédiate

Chaque action Planificateur met d’abord à jour le dashboard et `localStorage`. Le module compare le nouvel état avec son dernier état connu et ajoute les changements à :

```text
pharma_ops_sync_queue_v4
```

### Envoi vers Supabase

Lorsque le réseau et une session autorisée sont disponibles, la file envoie successivement :

- les locaux ;
- les paramètres ;
- les activités.
- les articles ;
- les mouvements de stock.

Les Managers peuvent envoyer uniquement leurs mouvements de stock. Les politiques RLS refusent leurs écritures sur le planning, les locaux, les réglages et les articles.

### Realtime

Le client écoute les six tables partagées et le journal `change_log`. Une modification reçue déclenche une relecture courte du snapshot serveur, puis la vue est mise à jour. Si une modale ou un champ est actif, l’application attend la fin de la saisie avant d’appliquer le snapshot.

### Conflits

La stratégie retenue est **dernière écriture reçue gagnante**. Le trigger PostgreSQL met `updated_at` à l’heure serveur à chaque modification.

La contrainte d’exclusion PostgreSQL reste prioritaire : deux activités non annulées ne peuvent pas se chevaucher dans le même local. Une opération refusée reste dans la file locale avec l’état « bloqué » jusqu’à correction.

## 7. Données locales

Clés utilisées :

```text
pharma_ops_dashboard_v2       cache principal compatible v3
pharma_ops_sync_queue_v4      opérations en attente
pharma_ops_sync_meta_v4       état de première synchronisation
```

L’export/import JSON, les exports CSV et PDF restent disponibles.

## 8. Gestion des locaux

Le profil Planificateur peut :

- ajouter un local ;
- renommer le local et sa zone ;
- désactiver ou réactiver un local ;
- supprimer un local sans activité associée.

Un local désactivé reste présent dans l’historique mais ne peut plus être choisi pour une nouvelle activité.

## 9. Contrôles après installation

### Vérifier les tables

```sql
select count(*) as rooms from locaux_dash.rooms;
select count(*) as activities from locaux_dash.activities;
select * from locaux_dash.settings;
```

### Vérifier l’absence de chevauchement

```sql
select a.id, a.room_id, a.plan_start, a.plan_end
from locaux_dash.activities a
order by a.room_id, a.plan_start;
```

Tester ensuite l’insertion de deux créneaux qui se recouvrent dans un même local : le second doit être refusé avec une erreur de contrainte d’exclusion.

### Vérifier les rôles

- connexion Manager : lecture et stock A26 possibles, écriture planning refusée ;
- connexion Planificateur : écriture possible ;
- coupure après authentification : session conservée et file locale gardée jusqu'au retour de la synchronisation ;
- rechargement sans vérification de profil possible : dashboard masqué et cache opérationnel purgé.

## 10. Limites assumées

- Le cache récupère actuellement l’ensemble des activités disponibles. Pour plusieurs années de données, ajouter une stratégie d’archivage ou une fenêtre de chargement.
- La stratégie « dernière écriture reçue gagnante » est simple ; elle ne fusionne pas deux modifications concurrentes champ par champ.
- Le mode hors-ligne utilise `localStorage`, pas IndexedDB. Il convient au volume actuel du dashboard mais pas à un très grand historique.
- Tous les postes doivent conserver une heure système correcte. Les dates sont envoyées à Supabase en ISO UTC puis affichées dans le fuseau local du navigateur.
