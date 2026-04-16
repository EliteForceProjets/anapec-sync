# RAPPORT 2 — GitHub : Contenu et Étapes d'Installation Complètes

---

## PARTIE A — CE QUI DOIT SE TROUVER DANS GITHUB

### Structure complète du repo `anapec-sync`

```
anapec-sync/
│
├── .github/
│   └── workflows/
│       └── fusion_monday.yml          ← À CRÉER (GitHub Actions)
│
├── .gitignore                         ← Existant
│
├── GRUPO_TEYEZ/
│   ├── contrats.json                  ← Mis à jour chaque dimanche
│   └── ci_*.html                      ← Fichiers HTML contrats
│
├── SIGARMOR/
│   ├── contrats.json
│   └── ci_*.html
│
├── EIM/
│   ├── contrats.json
│   └── ci_*.html
│
├── KIRKOS/
│   ├── contrats.json
│   └── ci_*.html
│
├── KIRKOS_GUARD/
│   ├── contrats.json
│   └── ci_*.html
│
├── NEISS/
│   ├── contrats.json
│   └── ci_*.html
│
├── NORIA_BIANCA/
│   ├── contrats.json
│   └── ci_*.html
│
├── CQ_SERVICE/
│   ├── contrats.json
│   └── ci_*.html
│
├── PDF/
│   ├── GRUPO_TEYEZ/
│   │   └── REF-1.pdf                  ← 1 PDF par contrat non signé
│   ├── SIGARMOR/
│   ├── KIRKOS/
│   ├── KIRKOS_GUARD/
│   ├── NEISS/
│   └── NORIA_BIANCA/
│
├── lambda/
│   └── index.mjs                      ← Code Lambda AWS (à garder en sync)
│
├── run_all.mjs                        ← v8 (fix détection arabe Unicode)
├── scraper_anapec.mjs                 ← v7 (restart browser + detail_id)
├── Fusion_TAB.mjs                     ← v8 (fix détection arabe Unicode)
├── Export_PDF.mjs                     ← v9 (lots 20 + double condition)
├── PDF_Contrats.mjs                   ← v8 (double condition + jsonCharge)
├── pipeline_dimanche.bat              ← Nouveau (script Task Scheduler)
│
├── package.json                       ← Dépendances Node.js
├── package-lock.json
│
├── contrats_non_signes.pdf            ← PDF global mis à jour chaque dimanche
├── sync_log.txt                       ← Log run_all
├── fusion_log.txt                     ← Log Fusion_TAB
└── pipeline_log.txt                   ← Log pipeline complet
```

---

### Contenu de `package.json` requis

```json
{
  "name": "anapec-sync",
  "version": "1.0.0",
  "type": "module",
  "dependencies": {
    "puppeteer": "^21.0.0",
    "pdf-lib": "^1.17.1"
  }
}
```

---

### Contenu de `.github/workflows/fusion_monday.yml`

```yaml
name: ANAPEC Fusion Monday

on:
  push:
    branches: [main]
    paths:
      - '*/contrats.json'
  workflow_dispatch:
  schedule:
    - cron: '0 13 * * 0'    # dimanche 13h UTC = 14h Maroc

jobs:
  fusion-monday:
    runs-on: ubuntu-latest
    timeout-minutes: 30

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run Fusion_TAB.mjs
        env:
          MONDAY_API_KEY: ${{ secrets.MONDAY_API_KEY }}
        run: node Fusion_TAB.mjs

      - name: Commit fusion log
        run: |
          git config --global user.name "ANAPEC Bot"
          git config --global user.email "bot@anapec.com"
          git add fusion_log.txt || true
          git diff --staged --quiet || git commit -m "Fusion log $(date '+%d/%m/%Y')"
          git push || true
```

---

## PARTIE B — ÉTAPES D'INSTALLATION COMPLÈTES

---

### ÉTAPE 1 — Copier les fichiers corrigés dans `C:\anapec`

```cmd
copy "%USERPROFILE%\Downloads\run_all.mjs"            "C:\anapec\run_all.mjs" /Y
copy "%USERPROFILE%\Downloads\scraper_anapec.mjs"     "C:\anapec\scraper_anapec.mjs" /Y
copy "%USERPROFILE%\Downloads\Fusion_TAB.mjs"         "C:\anapec\Fusion_TAB.mjs" /Y
copy "%USERPROFILE%\Downloads\Export_PDF.mjs"         "C:\anapec\Export_PDF.mjs" /Y
copy "%USERPROFILE%\Downloads\PDF_Contrats.mjs"       "C:\anapec\PDF_Contrats.mjs" /Y
copy "%USERPROFILE%\Downloads\pipeline_dimanche.bat"  "C:\anapec\pipeline_dimanche.bat" /Y
```

---

### ÉTAPE 2 — Installer les dépendances Node.js

```cmd
cd C:\anapec
npm install pdf-lib
```

Vérifier que `package.json` contient bien `pdf-lib` :
```cmd
type C:\anapec\package.json
```

---

### ÉTAPE 3 — Créer le fichier GitHub Actions sur votre PC

```cmd
mkdir "C:\anapec\.github\workflows" 2>nul
copy "%USERPROFILE%\Downloads\fusion_monday.yml" "C:\anapec\.github\workflows\fusion_monday.yml" /Y
```

---

### ÉTAPE 4 — Ajouter le secret MONDAY_API_KEY sur GitHub

1. Ouvrir : `https://github.com/mastereliteforceapp-create/anapec-sync`
2. Cliquer **Settings** (en haut à droite du repo)
3. Dans le menu gauche : **Secrets and variables** → **Actions**
4. Cliquer **New repository secret**
5. Remplir :
   - **Name** : `MONDAY_API_KEY`
   - **Secret** : votre clé API Monday.com (format : `eyJhbGciOi...`)
6. Cliquer **Add secret**

> La clé API Monday se trouve dans : Monday.com → Photo profil → **Administration** → **Connexions** → **API** → Copier le token personnel

---

### ÉTAPE 5 — Déployer le Lambda v7 sur AWS

Le Lambda corrige le bug des doublons (pagination cursor-based).

1. Ouvrir : **AWS Console** → **Lambda** → votre fonction
2. Onglet **Code** → cliquer sur `index.mjs`
3. **Remplacer entièrement** le contenu par le fichier `lambda_index.mjs` téléchargé
4. Cliquer **Deploy** (bouton orange en haut)
5. Tester avec **Test** → event `{"contracts":[],"societe":"KIRKOS"}`

---

### ÉTAPE 6 — Push complet vers GitHub

```cmd
cd C:\anapec

REM Vérifier le statut Git
git status

REM Ajouter tous les fichiers
git add -A

REM Commit initial complet
git commit -m "Pipeline auto v8 - installation complete"

REM Push vers GitHub
git push origin main
```

Si erreur de push → utiliser :
```cmd
git push origin main --force
```

---

### ÉTAPE 7 — Configurer le Task Scheduler Windows

**Méthode 1 — Commande CMD (recommandée) :**
```cmd
schtasks /create /tn "ANAPEC Pipeline Dimanche" /tr "C:\anapec\pipeline_dimanche.bat" /sc WEEKLY /d SUN /st 14:00 /ru SYSTEM /f
```

**Méthode 2 — Interface graphique :**
1. Chercher **Planificateur de tâches** dans le menu Démarrer
2. Cliquer **Créer une tâche de base**
3. Nom : `ANAPEC Pipeline Dimanche`
4. Déclencheur : **Toutes les semaines** → **Dimanche** → **14:00**
5. Action : **Démarrer un programme**
6. Programme : `C:\anapec\pipeline_dimanche.bat`
7. Cocher **Exécuter avec les autorisations maximales**
8. Cliquer **OK**

**Vérifier que la tâche est bien créée :**
```cmd
schtasks /query /tn "ANAPEC Pipeline Dimanche"
```

---

### ÉTAPE 8 — Test manuel complet (avant dimanche)

```cmd
C:\anapec\pipeline_dimanche.bat
```

Suivre le log en temps réel :
```cmd
REM Dans un deuxième CMD, afficher le log en temps réel
powershell Get-Content C:\anapec\pipeline_log.txt -Wait
```

---

### ÉTAPE 9 — Vérifier GitHub Actions

Après le push :
1. Aller sur `https://github.com/mastereliteforceapp-create/anapec-sync/actions`
2. Vérifier que le workflow **ANAPEC Fusion Monday** apparaît
3. Il doit être en vert ✅ si tout fonctionne

**Déclencher manuellement pour tester :**
1. Aller sur l'onglet **Actions**
2. Cliquer sur **ANAPEC Fusion Monday**
3. Cliquer **Run workflow** → **Run workflow**
4. Attendre ~5 minutes → vérifier les logs

---

## PARTIE C — TABLEAU DE BORD : FICHIERS GITHUB vs PC

| Fichier | GitHub | PC `C:\anapec` | Rôle |
|---------|--------|----------------|------|
| `run_all.mjs` | ✅ | ✅ | Pipeline principal |
| `scraper_anapec.mjs` | ✅ | ✅ | Scraping ANAPEC |
| `Fusion_TAB.mjs` | ✅ | ✅ | Fusion → GLOBAL |
| `Export_PDF.mjs` | ✅ | ✅ | PDF global |
| `PDF_Contrats.mjs` | ✅ | ✅ | PDFs individuels |
| `pipeline_dimanche.bat` | ✅ | ✅ | Script automatisation |
| `lambda/index.mjs` | ✅ | — | Déployé sur AWS |
| `.github/workflows/fusion_monday.yml` | ✅ | ✅ | GitHub Actions |
| `*/contrats.json` | ✅ | ✅ | Données contrats |
| `*/ci_*.html` | ✅ | ✅ | HTML contrats |
| `PDF/*/**.pdf` | ✅ | ✅ | PDFs générés |
| `package.json` | ✅ | ✅ | Dépendances |

---

## PARTIE D — QUE FAIT GITHUB ACTIONS vs PC

| Tâche | PC Windows | GitHub Actions |
|-------|-----------|----------------|
| `scraper_anapec.mjs` | ✅ Nécessite Edge/Windows | ❌ Impossible |
| `run_all.mjs` | ✅ Nécessite Edge/Windows | ❌ Impossible |
| `Export_PDF.mjs` | ✅ Nécessite Edge/Windows | ❌ Impossible |
| `PDF_Contrats.mjs` | ✅ Nécessite Edge/Windows | ❌ Impossible |
| `Fusion_TAB.mjs` | ✅ | ✅ Tourne sur Linux |
| Git push | ✅ Depuis le PC | ✅ Auto après fusion |

> GitHub Actions ne peut exécuter que `Fusion_TAB.mjs` car c'est le seul script sans dépendance à un navigateur Windows.

---

## PARTIE E — VÉRIFICATIONS HEBDOMADAIRES

Chaque lundi matin, vérifier :

1. **Log pipeline** : `C:\anapec\pipeline_log.txt` → chercher les ERREUR
2. **Monday.com** : vérifier les boards mis à jour
3. **GitHub Actions** : `https://github.com/.../actions` → vert ✅
4. **PDF** : `C:\anapec\contrats_non_signes.pdf` → ouvrir et vérifier
5. **HTML manquants** : chercher `⚠️ HTML manquant` dans le log → relancer scraper si besoin

```cmd
REM Commande pour chercher les erreurs dans le log
findstr /I "ERREUR HTML manquant ❌" C:\anapec\pipeline_log.txt
```
