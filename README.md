# Déploiement cloud — YOLO final

## URL publique

**https://omaghraoui21.github.io/dashboard-locaux-pharma/**

Direct :  
https://omaghraoui21.github.io/dashboard-locaux-pharma/dashboard_4_locaux_pharma.html

Repo : https://github.com/omaghraoui21/dashboard-locaux-pharma

## Supabase (projet dédié)

| Élément | Valeur |
|---------|--------|
| Projet | **trs-pharma** (`rzxnowngjudicmwzjdjo`) |
| URL | `https://rzxnowngjudicmwzjdjo.supabase.co` |
| Schéma | **`locaux_dash`** |
| Tables | rooms, activities, settings, profiles, change_log, **articles**, **stock_movements** |
| Publishable | dans le HTML (RLS actif) |

Ancien branchement `dpi-trs-tracker` : schéma `locaux_dash` y reste en place mais **n’est plus la cible front**.

## Comptes de production

Les inscriptions publiques sont désactivées. Le propriétaire de l'organisation a reçu une invitation de production et possède un profil `planner` actif dans `locaux_dash.profiles`. Avant d'inviter une adresse qui n'appartient pas à l'équipe Supabase, configurer un SMTP dédié; créer ensuite explicitement sa ligne avec le rôle `manager` ou `planner`. Aucun mot de passe ne doit être conservé dans ce dépôt.

Les trois comptes techniques de recette sont bannis; leurs sessions, refresh tokens et profils ont été supprimés. Seul le profil réel du propriétaire reste actif.

## Utilisation

1. Ouvrir l’URL Pages  
2. **Connexion** planificateur  
3. Planning, clôture, CSV, articles, stock A26  

## Redéployer

```bash
# depuis le package
cp dashboard_4_locaux_pharma.html plant-domain.js supabase-client.js index.html redirect.js /tmp/dashboard-locaux-pharma-audit/
cd /tmp/dashboard-locaux-pharma-audit && git add -A && git commit -m "update" && git push
```

## Sécurité

- Ne jamais mettre `service_role` / `sbp_` dans le HTML  
- Révoquer tout token collé en chat  
- Inscriptions Auth fermées, mot de passe minimum 12 caractères  
- SMTP Supabase natif limité au propriétaire membre de l'organisation; SMTP dédié requis avant extension à d'autres utilisateurs
- Le contrôle HaveIBeenPwned nécessite un plan Supabase compatible
- La CI `Verify static dashboard` exécute les tests Node et le smoke test à chaque push

## Rollback

```bash
git -C /tmp/dashboard-locaux-pharma revert <commit>
git -C /tmp/dashboard-locaux-pharma push
```

Pour la base, appliquer uniquement des migrations additives/réversibles et vérifier les advisors Supabase avant et après. Surveiller les logs Auth, API et Realtime après chaque mise en production.
