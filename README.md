# Lærebok — digital lesebok for elever

Statisk markdown-leser laget som studieverktøy. Innhold ligger i
`content/` som vanlige `.md`-filer, organisert i mapper. Alt fungerer i
nettleseren — ingen redigering, ingen serverkrav i produksjon.

## Mappestruktur

```
Textbook_Reader/
  build.py           # bygger static/data/*.json og samler _site/
  .github/workflows/pages.yml   # publiserer automatisk til GitHub Pages
  content/           # læreboken — markdown-filer i mappehierarki
    KRLE/
      Kristendom/
        bergprekenen.md
        ...
      _assets/       # bilder o.l. (valgfritt)
  static/
    index.html
    app.js
    style.css
    sw.js
    data/            # genereres av build.py — ikke versjonsstyrt
  _site/             # ferdig nettsted (static/ + content/) — ikke versjonsstyrt
```

## Frontmatter (valgfritt, øverst i hver fil)

```yaml
---
title: Bergprekenen
order: 3
tags: [jesus, etikk]
summary: Korte sammendrag av Bergprekenens hovedbudskap.
---
```

- `title` — overstyrer filnavnet i sidemenyen og brødsmulestien.
- `order` — tall som styrer rekkefølgen for "Forrige / Neste leksjon".
  Filer uten `order` faller til slutten i alfabetisk rekkefølge.
- `tags` — vises i emnemenyen og brukes til filtrering.

## Bygg og kjør lokalt

```bash
# Bygg indeksen og samle nettstedet i _site/:
python build.py --site

# Start en enkel lokal server og åpne http://localhost:8000/
python -m http.server 8000 --directory _site
```

`python build.py` alene oppdaterer bare `static/data/`. Bruk `--watch` for å
bygge automatisk hver gang innholdet endres.

Det trengs ingen egen serverapplikasjon — Python brukes kun til å bygge
indeksfilene. Selve leseboken er ren HTML/CSS/JS.

## Publisering på GitHub Pages

Repoet er satt opp til å publisere seg selv. Etter første push:

1. Gå til **Settings → Pages** i GitHub-repoet.
2. Under **Build and deployment → Source**, velg **GitHub Actions**.

Hver gang du pusher til `main`, kjører `.github/workflows/pages.yml`:
den kjører `python build.py --site` og publiserer `_site/`. Legger du til
eller endrer en markdown-fil i `content/`, blir indeksen bygd på nytt
automatisk — du trenger ikke committe `static/data/` eller `_site/`.

Siden blir tilgjengelig på `https://<brukernavn>.github.io/<repo>/`.

Alle URL-er i appen er relative, så den fungerer både på et domenerot og
under en prosjektsti (`/<repo>/`). Vil du heller publisere manuelt til en
annen statisk webvert, kjør `python build.py --site` og last opp innholdet
i `_site/` som dokumentrot.

## Funksjoner i appen

- Markdown med wiki-lenker `[[andre side]]`, embeds `![[andre side]]`,
  callouts `> [!note] …`, fotnoter `[^1]`, matematikk (KaTeX), Mermaid,
  syntakshøydepunkter (highlight.js), `==utheving==`, `~sub~`, `^sup^`.
- Sidemeny med klikkbar mappetre, søk på tvers av alle sider, bokmerker,
  sist leste sider og emner (tags).
- **Emnesider**: klikk på en mappe i sidemenyen for å få en oversikt
  over alle leksjoner i mappen, med fremgang, sammendrag (fra
  frontmatter) og en "fortsett der du slapp"-knapp.
- **Leseframgang**: hver side spores automatisk (påbegynt → lest når du
  scroller forbi 90 %), og kan også markeres manuelt med "Marker som
  lest". Vises som ✓ / ◐ ved sidenavn i menyen og som progressindikator
  på emnesidene.
- Innholdsfortegnelse med scroll-spy.
- Tema- og skriftvelger (Mørk / Lys / Sepia / Daggry / Skog; fem fonter
  inkludert OpenDyslexic og Atkinson Hyperlegible).
- Fokuslesemodus (F11), justerbar tekststørrelse og dokumentbredde.
- Forrige/neste leksjon-navigering, delbare URL-er via `#sti/til/fil.md`
  for sider og `#@KRLE/Kristendom` for emnesider.
- **Tilgjengelig offline**: en service worker forhåndsbufrer alle filer
  ved første besøk (krever HTTPS i produksjon eller localhost i utvikling).
- Skriv ut / lagre som PDF.

### Standard startside

Ved første besøk åpner appen automatisk en "forside" hvis den finnes —
prøver `*-forside.md`, `forside.md`, `index.md`, `welcome.md` og
`start.md` i den rekkefølgen. Ellers landingssiden viser "Velkommen!"

## Hurtigtaster

- `Ctrl+K` eller `/` — fokuser søk
- `Ctrl+B` — vis/skjul sidemenyen
- `Alt + ←` / `Alt + →` — forrige / neste leksjon
- `F11` — fokusmodus
- `Esc` — avslutt fokusmodus / tøm søk
