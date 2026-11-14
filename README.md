# Sakstavla

En digital korktavle med røde tråder og en Kanban-backlog, bygget med JavaScript, CSS og Vite. Appen starter med en tom tavle.

## Lokal kjøring

Bruk Node.js 24. Pakk ut kildekoden, åpne en terminal i mappen som inneholder package.json, og kjør

~~~sh
npm ci
npm run dev
~~~

Åpne adressen Vite skriver ut, vanligvis http://localhost:5173/. Bruk samme adresse og nettleserprofil ved senere åpninger for å finne igjen den lokale tavla.

~~~sh
npm run build
npm run preview
~~~

Bygget ligger i dist/. Relative ressursadresser og navigasjon med URL-fragmenter gjør at samme bygg kan ligge på rotnivå eller i en undermappe.

## Bruk

- Lim inn skjermbilder på tavla, slipp bilde- eller videofiler på arbeidsflaten, eller åpne tavlemenyen med høyreklikk. Dra i bildet eller øverst på andre kort for å flytte dem. Bruk håndtaket nederst til høyre for å endre størrelse. Skriv direkte på lapper.
- Aktiver «Nåler og tråder» øverst til høyre. Klikk på tavla eller et kort for å feste en nål. Dra mellom to punkter for å trekke en tråd, eller velg en eksisterende nål og deretter sluttpunktet. Nåler på kort følger kortet når du flytter det eller endrer størrelsen. Escape avslutter verktøyet. Velg en nål eller tråd for å slette den.
- Dra i ledig tavleplass for å panorere. Du kan også dra med midtre museknapp over et kort. Bruk «Tilpass alt innhold» i høyreklikkmenyen for å finne igjen alle kortene.
- Dra oppgaver til en kolonne eller mellom kortene i en kolonne. På berøringsskjerm kan du endre status i oppgavedetaljene. Bruk «Lagre og fest på tavla» for å lage en kobling til oppgaven fra korktavla.

Videokort støtter lokale filer, direkte videolenker og YouTube. Hvis YouTube-videoen har sperret innebygging, høyreklikk øverst på videoen og velg «Åpne på YouTube». Dra langs overkanten for å flytte videoen, og bruk hjørnet nederst til høyre for å skalere. Videofiler følger med i sikkerhetskopien. For en direkte videolenke lagres nettadressen.

## Tavler, grupper og historikk

- Opprett en tavle med «Ny tavle» i tavlevelgeren. Bruk velgeren for å bytte mellom tavler med egne kort, tråder og backlogger.
- Bruk «Grupper» og dra et område rundt hele kortene du vil samle. Dra gruppen etter navnet for å flytte den. Klikk på navnet for å endre eller fjerne gruppen.
- «Søk på tavla» finner lapper, kilder og oppgaver. Velg et treff for å sentrere kortet eller åpne en oppgave i backlogen.
- Velg en tråd og klikk på fargeknappen for å bytte farge. Trykk Delete for å slette tråden.
- Bruk Ctrl+Z for å angre og Ctrl+Shift+Z eller Ctrl+Y for å gjøre om. På Mac kan du bruke Command. Historikken er separat per tavle og varer til siden lastes på nytt.
- Sikkerhetskopien inneholder alle tavlene. Import erstatter arbeidsområdet etter bekreftelse. Tidligere sikkerhetskopier kan fortsatt importeres.

## Innboks og kommandopalett

- Ctrl+K eller Command+K åpner kommandopaletten. Søk etter handlinger, tavler eller oppgaver. Bruk pilene og Enter for å velge.
- Innboksen samler lapper, lenker, bilder og videoer per tavle. Aktiver innsamling i innboksen for å sende bilder og videoer fra tavla dit midlertidig. Bruk «Legg på tavla» når sporet er klart.
- Høyreklikk på et kort og velg «Gjør til oppgave». Oppgavedetaljene får en snarvei tilbake til kildesporet.
- Dobbeltklikk på en nål for å fremheve forbindelsene, og trykk Escape for å gå tilbake. 
- Klikk på gruppenavnet og velg «Brett sammen» for å skjule kortene og trådene som er festet til dem. Bruk «Åpne gruppen» for å vise dem igjen.

## Lokal lagring

Kort, oppgaver, tråder og bilder lagres automatisk i IndexedDB i nettleserprofilen du bruker. Nettleseren knytter dataene til nettstedets opprinnelse, altså protokoll, vertsnavn og port. Tavlene på localhost og GitHub Pages har derfor hver sin lagring. Bruk «Sikkerhetskopi» for å eksportere eller flytte alt. Sletting av nettstedsdata fjerner tavla i den aktuelle nettleseren.

## GitHub Pages

1. Opprett et GitHub-repo som støtter Pages. Legg filene fra denne mappen i roten av repoet, inkludert den skjulte mappen .github. Kildekoden og package-lock.json skal inn i Git.
2. På GitHub, åpne **Settings → Pages**. Under **Build and deployment**, sett **Source** til **GitHub Actions**.
3. Push til standardgrenen. Hvis koden allerede ligger der, åpne **Actions → Publiser Sakstavla → Run workflow** og velg standardgrenen.
4. Når jobben er grønn, åpne adressen i **Settings → Pages** eller i miljøet **github-pages** i den fullførte kjøringen. Et prosjektrepo får vanligvis adressen https://BRUKERNAVN.github.io/REPONAVN/.

Workflowen bygger og publiserer dist/ fra repoets standardgren. Se [GitHubs veiledning for publiseringskilde](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).

## Nettlesertester

~~~sh
npx playwright install chromium
npm run build
npm test
~~~

Testserveren eksponerer produksjonsbygget på /sakstavla/. Nettlesertesten bruker et faktisk PNG-skjermbilde i en simulert clipboard-hendelse og en separat nettleserkontekst for gjenoppretting.
