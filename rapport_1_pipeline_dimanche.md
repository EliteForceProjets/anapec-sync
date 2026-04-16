# RAPPORT 1 — Pipeline Automatique ANAPEC → Monday.com
## Exécution chaque Dimanche à 14h00

---

## ARCHITECTURE GLOBALE

```
DIMANCHE 14h00
│
├── [PC WINDOWS] Task Scheduler
│   ├── ÉTAPE 1 → run_all.mjs
│   ├── ÉTAPE 2 → Fusion_TAB.mjs
│   ├── ÉTAPE 3 → Export_PDF.mjs
│   ├── ÉTAPE 4 → PDF_Contrats.mjs
│   └── ÉTAPE 5 → git push → GitHub
│
└── [GITHUB ACTIONS] Déclenché par le push
    └── Fusion_TAB.mjs (re-sync confirmation)
```

---

## ÉTAPE 1 — run_all.mjs (≈ 45–90 min)
**Ce qui est exécuté :** Pipeline scraping ANAPEC + envoi Monday.com pour les 8 sociétés

### Pour chaque société dans cet ordre :
1. GRUPO_TEYEZ → grupoteyez@gmail.com
2. SIGARMOR → sigarmorgroup@gmail.com
3. EIM → ecoleimanagement@gmail.com
4. KIRKOS → groupekirkos@gmail.com
5. KIRKOS_GUARD → groupekirkosguarduim@gmail.com
6. NEISS → neissinvest@gmail.com
7. NORIA_BIANCA → yelgartili@groupekirkos.ma
8. CQ_SERVICE → info.cqservice@gmail.com

### Pour chaque société, le script fait :
1. **Nettoyage lockfiles Puppeteer** : supprime les profils Edge orphelins dans %TEMP%
2. **Lancement Edge (Puppeteer headless)** : ouvre Microsoft Edge en arrière-plan
3. **Navigation vers ANAPEC** : https://www.anapec.org/sigec-app-rv/
4. **Connexion** : sélectionne radio "Employeur", saisit email + mot de passe, appuie Entrée
5. **Scraping tableau des contrats** : parcourt toutes les pages (10 contrats/page)
   - Récupère : ref contrat, date_sig, date_fin, état ANAPEC, type, CIN, detail_id
   - Sauvegarde dans `C:\anapec\SOCIETE\contrats.json` (avec detail_id v7)
6. **Téléchargement HTML** : pour chaque contrat, accède à `/edition_ci/ID`
   - Attend que `div.printable` soit chargé (15s timeout)
   - Sauvegarde dans `C:\anapec\SOCIETE\ci_XXXXX.html`
   - Restart browser préventif toutes les 40 fiches (anti-crash Frame detached)
7. **Extraction des données** : pour chaque fichier HTML
   - `extractPrintable()` : extrait `div.printable` ou `div.arriereprintable`
   - `isArabicContent()` : détection arabe par ratio Unicode > 5%
   - **Branche ARABE** : extrait poste (تعيين), salaire (مبلغها), durée (لمدة), nom, prénom, CIN, CNSS, niveau
   - **Branche FRANÇAIS** : extrait poste (affecter au poste), salaire (fixé à X DH), durée (durée de X mois)
8. **Triple mapping** : detail_id → HTML > ref dans HTML > CIN
9. **Envoi Lambda AWS** : POST vers `https://cel7jflv4gclxqw2ozvr2b46ku0dsczq.lambda-url.eu-north-1.on.aws/`
   - Lambda récupère TOUS les items Monday (pagination cursor-based, sans limite 500)
   - Si ref existe → UPDATE l'item existant
   - Si ref nouvelle → CREATE dans le bon groupe (EN COURS ou PROJET)
10. **Résultat loggé** : `+X créés, ↻X mis à jour, ✗X erreurs`

### Outputs produits :
- `C:\anapec\SOCIETE\contrats.json` mis à jour
- `C:\anapec\SOCIETE\ci_*.html` nouveaux contrats téléchargés
- Monday.com boards mis à jour : ANAPEC_GRUPO_TEYEZ, ANAPEC_SIGARMOR, ANAPEC_EIM, ANAPEC_KIRKOS, ANAPEC_KIRKOS_GUARD, ANAPEC_NEISS, ANAPEC_NORIA_BIANCA, ANAPEC_CQ_SERVICE
- `C:\anapec\sync_log.txt` : log complet

---

## ÉTAPE 2 — Fusion_TAB.mjs (≈ 5–15 min)
**Ce qui est exécuté :** Fusion des 8 tableaux individuels → ANAPEC_GLOBAL (board 5094534887)

### Déroulement :
1. Pour chaque société, lit `contrats.json` local
2. Charge les fichiers HTML et extrait les données (même logique que run_all)
3. Triple mapping detail_id > ref > CIN
4. Nettoyage dates "---" → ""
5. Ajoute le champ `email_soc` (identifiant société source)
6. Envoie vers Lambda avec `societe: "ANAPEC_GLOBAL"`
7. Lambda met à jour le board global avec TOUS les contrats des 8 sociétés

### Outputs produits :
- Monday.com board ANAPEC_GLOBAL (5094534887) mis à jour
- `C:\anapec\fusion_log.txt` : log complet

---

## ÉTAPE 3 — Export_PDF.mjs (≈ 5–10 min)
**Ce qui est exécuté :** Génération d'un PDF global de tous les contrats non signés

### Double condition de sélection :
- **Condition 1** : État ANAPEC = `Projet` ou `En cours` dans contrats.json
  - Si contrats.json absent → fallback, accepte tout
  - Si contrats.json présent mais 0 Projet → société ignorée
  - CIN délibérément exclu du mapping (évite faux positifs sur renouvellements)
- **Condition 2** : Tableau de signatures vide dans le HTML
  - Arabe : tableau `المشغل(ة) | المتدرب(ة)` avec cellules vides
  - Français : tableau `L'employeur | Le stagiaire | VISA` avec cellules vides

### Déroulement :
1. Parcourt tous les `ci_*.html` de chaque société
2. Filtre : double condition état + signatures
3. Log `⚠️ HTML manquant` pour les contrats Projet sans fichier HTML
4. Prépare le HTML de chaque contrat :
   - Supprime `div#jGrowl` (popup "Recto verso")
   - Supprime scripts, boutons, noPrint
   - Applique direction RTL pour les contrats arabes
   - CSS : font-size 9px, line-height 1.3, max-height 257mm (1 page/contrat)
5. Génération par **lots de 20 contrats** (évite timeout Puppeteer)
6. Fusion des PDFs avec `pdf-lib` → 1 fichier final
7. Page de garde : total contrats, breakdown arabes/français, date

### Output produit :
- `C:\anapec\contrats_non_signes.pdf` : 1 couverture + 1 page/contrat

---

## ÉTAPE 4 — PDF_Contrats.mjs (≈ 30–90 min selon nombre)
**Ce qui est exécuté :** Génération d'un PDF individuel par contrat non signé

### Double condition de sélection :
- Même logique que Export_PDF.mjs (état Projet/En cours + signatures vides)
- CIN exclu du mapping

### Déroulement :
1. Détecte les contrats non signés (même double condition)
2. Log `⚠️ HTML manquant` pour les Projet sans HTML
3. Pour chaque société :
   - Lance Edge (Puppeteer visible, headless:false)
   - Connexion ANAPEC (même méthode que scraper v7)
   - Pour chaque contrat retenu :
     - Navigue vers `/edition_ci/ID` (vrai rendu ANAPEC avec logo officiel)
     - Attend que `div.printable` soit chargé
     - Masque les éléments non imprimables
     - Génère le PDF A4
   - Restart browser préventif toutes les 40 pages
   - Détection SESSION_EXPIRED + reconnexion automatique
   - Skip si PDF déjà existant (`⏭`)

### Output produit :
- `C:\anapec\PDF\SOCIETE\REF_CONTRAT.pdf` : 1 PDF par contrat
- Structure exemple : `C:\anapec\PDF\KIRKOS\AI0904261106879-1.pdf`

---

## ÉTAPE 5 — Git Push GitHub (≈ 1–2 min)
**Ce qui est exécuté :** Sauvegarde complète vers GitHub

### Déroulement :
1. `git fetch origin` : synchronise avec le remote
2. `git reset --hard origin/main` : résout les conflits
3. `git add -A` : ajoute tous les changements
4. `git commit -m "Pipeline auto - DATE HEURE"` : commit daté
5. `git push origin main` : push normal
6. Si échec → `git push origin main --force` : push forcé

### Fichiers pushés :
- Tous les `contrats.json` mis à jour
- Tous les nouveaux `ci_*.html`
- Les PDFs générés (`PDF/SOCIETE/*.pdf`)
- `contrats_non_signes.pdf`
- `sync_log.txt`, `fusion_log.txt`, `pipeline_log.txt`

---

## LOG ET MONITORING

Tous les logs sont dans `C:\anapec\pipeline_log.txt` :
```
============================================================
[16/04/2026 14:00:01] DEBUT PIPELINE AUTOMATIQUE
[16/04/2026 14:00:01] ETAPE 1/5: run_all.mjs
... (logs run_all) ...
[16/04/2026 15:30:00] OK run_all.mjs
[16/04/2026 15:30:00] ETAPE 2/5: Fusion_TAB.mjs
... etc ...
[16/04/2026 16:00:00] FIN PIPELINE
============================================================
```

---

## DURÉE TOTALE ESTIMÉE

| Étape | Durée estimée |
|-------|---------------|
| run_all.mjs | 45–90 min |
| Fusion_TAB.mjs | 5–15 min |
| Export_PDF.mjs | 5–10 min |
| PDF_Contrats.mjs | 30–90 min |
| Git push | 1–2 min |
| **TOTAL** | **~2h–3h30** |

Le pipeline se termine vers **16h30–17h30** selon le nombre de nouveaux contrats.
