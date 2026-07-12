# Dashboard des locaux pharmaceutiques

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

Les inscriptions publiques sont désactivées. Le compte du propriétaire est confirmé et possède un profil `planner` actif dans `locaux_dash.profiles`; son accès lecture/écriture/Realtime a été validé sur le site public. Avant d'inviter une adresse qui n'appartient pas à l'équipe Supabase, configurer un SMTP dédié; créer ensuite explicitement sa ligne avec le rôle `manager` ou `planner`. Aucun mot de passe ne doit être conservé dans ce dépôt.

Les trois comptes techniques de recette sont bannis; leurs sessions, refresh tokens et profils ont été supprimés. Seul le profil réel du propriétaire reste actif.

## Utilisation

1. Ouvrir l’URL Pages depuis n'importe quel réseau, téléphone ou ordinateur
2. Se connecter avec un compte autorisé par l’administrateur, par mot de passe ou magic link
3. Consulter les six locaux et le stock A26 dans la vue temps réel
4. Choisir une date/heure dans le volet A26 pour recalculer le stock historique
5. Utiliser **Exporter** pour extraire toutes les données en CSV ou sauvegarder le JSON complet

## Captures de recette

- [Vue chargée desktop](screenshots/dashboard-charge-desktop.png)
- [Stock A26 maintenant](screenshots/a26-stock-maintenant.png)
- [Stock A26 historique](screenshots/a26-stock-historique.png)
- [Premier écran mobile](screenshots/dashboard-charge-mobile-premier-ecran.png)
- [Écran de connexion](screenshots/ecran-connexion.png)

## Redéployer

```bash
# depuis le package
cp dashboard_4_locaux_pharma.html plant-domain.js supabase-client.js index.html redirect.js /tmp/dashboard-locaux-pharma-audit/
cd /tmp/dashboard-locaux-pharma-audit && git add -A && git commit -m "update" && git push
```

## Sécurité

- Ne jamais mettre `service_role` / `sbp_` dans le HTML  
- Révoquer tout token collé en chat  
- Dashboard masqué sans session et rôle `manager`/`planner`; cache, file d'attente et état mémoire purgés hors session
- GitHub Pages publie nécessairement le HTML/JS; la confidentialité des données repose sur Supabase Auth et les politiques RLS
- Inscriptions Auth fermées, mot de passe minimum 12 caractères  
- SMTP Supabase natif limité au propriétaire membre de l'organisation; SMTP dédié requis avant extension à d'autres utilisateurs
- Le contrôle HaveIBeenPwned nécessite un plan Supabase compatible
- La CI `Verify static dashboard` exécute les tests Node et le smoke test à chaque push

## Rollback

```bash
git -C /tmp/dashboard-locaux-pharma-audit revert <commit>
git -C /tmp/dashboard-locaux-pharma-audit push
```

Pour la base, appliquer uniquement des migrations additives/réversibles et vérifier les advisors Supabase avant et après. Surveiller les logs Auth, API et Realtime après chaque mise en production.
