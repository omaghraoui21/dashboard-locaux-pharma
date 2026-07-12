# Tokens & déploiement — ce dont l’outil a besoin

## Accès requis en production

| Besoin | Obligatoire ? | Comment |
|--------|---------------|---------|
| Navigateur moderne | **Oui** | Chrome / Edge / Firefox |
| Hébergement fichiers statiques | **Oui** | GitHub Pages en production, `./serve.sh` en recette locale |
| Compte Supabase autorisé | **Oui** | Profil `manager` ou `planner`; inscription publique fermée |

→ Le serveur local utilise la même authentification Supabase que le site public. Sans session autorisée, le dashboard reste masqué.

---

## Pour le **multi-utilisateurs / multi-postes** (Supabase)

| Secret / valeur | Où le mettre | Notes |
|-----------------|--------------|--------|
| **SUPABASE_URL** | `PHARMA_SUPABASE_CONFIG.url` dans le HTML | `https://xxxx.supabase.co` |
| **SUPABASE_PUBLISHABLE_KEY** (ou anon) | `publishableKey` | **Jamais** `service_role` |
| **Site URL / redirect** | Console Auth Supabase | URL du dashboard HTTPS |
| Comptes e-mail users | Auth > Users | Invitation explicite, inscription publique fermée |
| Profil + rôle | SQL admin | `locaux_dash.profiles`, `manager` ou `planner` |
| Schéma SQL | SQL Editor | Fichier `supabase_schema.sql` |

Le runtime n'a besoin d'aucun jeton de gestion Supabase. La publishable key présente dans le HTML est publique et les données restent protégées par Auth/RLS.

---

## Optionnel selon votre stratégie d’hébergement

| Service | Token / secret | Quand |
|---------|----------------|--------|
| **GitHub** | GitHub CLI ou SSH | Versionner et déployer; ne jamais partager de PAT en conversation |
| **Render / Netlify / Cloudflare Pages / IIS / Nginx** | Compte + éventuel token deploy | Mettre le HTML en HTTPS public ou intranet |
| **Domaine / DNS** | — | URL stable pour magic links Supabase |
| **Claude CLI** (`claude -p`) | Login Anthropic / Claude | Advisor dev seulement — **pas** runtime dashboard |
| **Codex** | Compte ChatGPT | Orchestration dev seulement — **pas** runtime |
| **xAI / Grok** | — | Dev seulement |

**Le dashboard en production n’appelle ni Claude, ni Codex, ni Grok.**

---

## Ce que vous devez me laisser (ou configurer) pour « full cloud »

1. Adresses e-mail réelles à inviter  
2. Désignation des planificateurs  
3. Révocation immédiate de tout jeton de gestion partagé dans une conversation  

Sans comptes autorisés, aucune donnée opérationnelle n'est accessible.

---

## Checklist go-live simple (adhésion équipe)

1. Ouvrir l'URL GitHub Pages ou lancer `./serve.sh` pour la recette locale
2. Former : Manager = lecture + A26 E/S ; Planificateur = tout le reste  
3. Importer le template CSV planning (Excel → enregistrer CSV UTF-8)  
4. Utiliser la production Supabase déjà configurée pour le multi-postes  
5. Ne pas viser GxP / signature électronique avec cet outil  
