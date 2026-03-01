# Hlidacka bazaru (zdarma)

Aplikace pravidelne (kazde 2 hodiny) prohledava bazary podle tvych dotazu a uklada vysledky do repozitare.

- Planovac: **GitHub Actions** (free)
- Web: **Vercel** (free)
- Notifikace: volitelne pres **Discord webhook** + **e-mail** (free)
- Administrace: **/admin** (ulozeni konfigurace do GitHub repozitare pres API)

## Jak to funguje

1. Workflow `.github/workflows/market-watch.yml` bezi kazde 2 hodiny.
2. Spusti `npm run check` (`scripts/check-marketplaces.mjs`).
3. Skript stahne stranky z `config/watches.json`, najde nove inzeraty a porovna je s `data/state.json`.
4. Aktualni vystup zapise do:
   - `data/latest-results.json`
   - `data/last-run.md`
   - `data/state.json`
   - `data/run-history.json` (historie behu + statistiky)
5. Workflow zmeny commitne zpet do repozitare.
6. Vercel nasadi aktualni dashboard (`app/page.js`).

## Lokalni spusteni

```bash
npm install
npm run check
npm run dev
```

## Nastaveni hlidani

Uprav `config/watches.json`:

- `keywords`: vsechny vyrazy, ktere musi inzerat obsahovat
- `excludeKeywords`: vyrazy, ktere inzerat vyradi
- `sources`: seznam URL a CSS selektoru pro kazdy bazar

Priklad polozky:

```json
{
  "id": "nazev-dotazu",
  "name": "Nazev dotazu",
  "keywords": ["kolo", "20"],
  "excludeKeywords": ["rezervace", "prodano"],
  "sources": [
    {
      "id": "sbazar",
      "name": "Sbazar",
      "url": "https://www.sbazar.cz/hledej/kolo%2020",
      "itemSelector": "article",
      "titleSelector": "h3, h2, a",
      "linkSelector": "a[href]",
      "priceSelector": "[class*='price']"
    }
  ]
}
```

Pokud nechas `itemSelector` prazdny, scraper projde vsechny odkazy na strance.

## GitHub setup

1. Nahraj projekt do GitHub repozitare.
2. V `Settings -> Actions -> General` nech povolene `Read and write permissions` pro workflow token.
3. Otevri `Settings -> Secrets and variables -> Actions`.
4. V `Secrets` nastav:
   - `SMTP_USER=hlidacka1@gmail.com`
   - `SMTP_PASS=<gmail app password>`
   - (volitelne) `DISCORD_WEBHOOK_URL=<discord webhook url>`
5. V `Variables` nastav:
   - `EMAIL_ENABLED=true`
   - `EMAIL_FROM=hlidacka1@gmail.com`
   - `EMAIL_TO=jan.kostalek@gmail.com`
   - `SMTP_HOST=smtp.gmail.com`
   - `SMTP_PORT=465`
   - `SMTP_SECURE=true`
6. Spust workflow rucne pres `Actions -> Market Watch -> Run workflow`.
7. Zkontroluj log jobu `Run watcher` a potvrd, ze dorazil e-mail.

## Gmail app password (pro SMTP_PASS)

1. Prihlas se do Google uctu `hlidacka1@gmail.com`.
2. Zapni `2-Step Verification` (bez toho App Password nevznikne).
3. Otevri `Google Account -> Security -> App passwords`.
4. Vytvor nove app password (napr. nazev `Hlidacka GitHub Actions`).
5. Vygenerovany 16znakovy kod vloz do GitHub secret `SMTP_PASS`.

## Vercel setup

1. Importuj GitHub repozitar do Vercel.
2. Framework detection nech na Next.js.
3. V `Settings -> Environment Variables` nastav:
   - `ADMIN_TOKEN` (libovolne silne heslo pro admin rozhrani)
   - `GITHUB_REPO` (napr. `jmeno/repozitar`)
   - `GITHUB_TOKEN` (GitHub PAT s opravnenim `contents:write`)
   - `GITHUB_BRANCH` (typicky `main`)
4. Deploy.

Dashboard na Vercel zobrazuje posledni vysledky z `data/latest-results.json`.
Administrace na `/admin` uklada `config/watches.json` primo do GitHub repozitare.
Historie behu se cte z `data/run-history.json` a zobrazuje na hlavni strance.

## Jak funguje e-mail notifikace

- E-mail se posila jen kdyz je v behu nalezen aspon 1 novy inzerat.
- Odesilatel: `hlidacka1@gmail.com` (lze zmenit pres `EMAIL_FROM`).
- Prijemce: `jan.kostalek@gmail.com` (lze zmenit pres `EMAIL_TO`).
- Obsahuje: cas behu, souhrn a seznam novych inzeratu s odkazy.
- Implementace je v `scripts/check-marketplaces.mjs` ve funkci `sendEmailNotification`.

## Administrace

- Otevri `/admin`
- Zadej `ADMIN_TOKEN`
- Pridavej dotazy:
  - `Nazev dotazu`
  - `Co hledat (text)` pro URL vyhledavani
  - `Klicova slova (CSV)` pro filtrovani vysledku
  - `Vyloucit slova (CSV)`
  - vyber bazary (`Sbazar`, `Bazos`)
- Uloz konfiguraci

## Poznamky

- Nektere bazary mohou blokovat scraping. V tom pripade uprav selektory nebo zdroj URL.
- Pokud bazar vyzaduje JavaScript rendering, je potreba rozsirit scraper o headless browser (Playwright).
