# Lærebok — digital lesebok for elever

Statisk markdown-leser laget som studieverktøy. Innhold ligger i
`content/` som vanlige `.md`-filer, organisert i mapper. Alt fungerer i
nettleseren — ingen redigering, ingen serverkrav i produksjon.

## Mappestruktur

```
Textbook_Reader/
  build.py           # bygger static/data/index.json + search.json
  serve_dev.py       # lokal utviklingsserver
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
    data/            # genereres av build.py — ikke versjonsstyrt
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

## Bygg og kjør

```bash
# Bygg indeksen (gjør dette hver gang innholdet endres):
python build.py

# Eller la den bygge automatisk:
python build.py --watch

# Start utviklingsserveren (åpner nettleseren):
python serve_dev.py
```

## Distribusjon

Hele appen er statiske filer. For å publisere:

1. Kjør `python build.py` slik at `static/data/` er oppdatert.
2. Kopier mappene `static/` og `content/` til hvilken som helst statisk
   webvert (GitHub Pages, skolens LMS, en mappe på en USB-stikke, osv.).
3. Sett opp slik at `static/index.html` er rotsiden, og at både
   `/content/...` og `/data/...` peker tilbake til riktige mapper.

På GitHub Pages vil et prosjektoppsett som dette fungere:

```
docs/
  index.html  ← kopiert fra static/index.html
  app.js
  style.css
  icon.svg
  data/...    ← kopiert fra static/data/
  content/... ← kopiert fra content/
```

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
