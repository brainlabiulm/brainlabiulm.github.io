# Portale BrainLab

Portale statico con password condivisa, pensato per la pubblicazione su GitHub Pages. La grafica riprende la palette blu notte e viola tenue, i pannelli chiari e la tipografia dell'app Tobii del laboratorio.

## Protezione e repository pubblico

La repository GitHub è pubblica. Per questo i sorgenti in chiaro stanno nella cartella locale `private/`, che è esclusa da Git. Il sito pubblicabile viene generato in `docs/` cifrando ogni file HTML con StatiCrypt e la password scelta al momento della generazione.

Non rimuovere `private/` da `.gitignore` e non aggiungere pagine in chiaro alla repository. La password non viene salvata nello script, nella configurazione o nell'output del sito. Usa una password unica di almeno 16 caratteri e condividila tramite un canale separato dal link.

Questa soluzione usa una sola password condivisa: non identifica i singoli visitatori e non consente di revocare l'accesso a una persona senza cambiare la password per tutti. Non usarla per dati clinici, personali o altrimenti sensibili. Le pagine HTML vengono cifrate; eventuali PDF, immagini, fogli di stile o altri file aggiunti separatamente non sono cifrati da questo progetto e non vanno pubblicati se riservati.

## Preparazione e generazione

Richiede Node.js 16 o successivo. Nella cartella del progetto:

```powershell
npm install
npm run build
```

Su Windows puoi avviare `build-site.cmd` con un doppio clic: installa le dipendenze se mancano, lancia il build e, se riesce, pubblica automaticamente i file generati su `origin/main`. Se `docs/` non è cambiata, non crea un commit vuoto. Lo script richiede Git installato e configurato per accedere alla repository. Non scarica pagine da GitHub; le pagine cifrate si trovano in `docs/`.

Lo script chiede la password due volte senza mostrarla, controlla che sia lunga almeno 16 caratteri e genera le pagine cifrate in `docs/`. Puoi accedere una volta e usare “Ricordami” per aprire le altre pagine dello stesso sito senza reinserirla a ogni click.

Le pagine sono organizzate in `private/pages/<nome-cartella>/`; il catalogo è `private/pages/pages.json` (puoi partire da `pages.example.json`). Per esempio:

```json
[
  {
    "nomeCartella": "analisi-dati",
    "nomeLink": "Analisi dati",
    "nomePagina": "index.html"
  }
]
```

`nomeCartella` è una cartella breve senza spazi; `nomeLink` è l'etichetta mostrata nel portale; `nomePagina` è il file HTML dentro quella cartella. Il build legge solo i file locali in `private/pages/<nomeCartella>/` e aggiorna il link nella pagina iniziale. Catalogo e sorgenti restano in `private/`, esclusi dalla repository pubblica.

Metti l'HTML e i suoi JavaScript nella cartella della pagina, conservando le sottocartelle indicate dai riferimenti `src` dell'HTML. Per esempio `private/pages/analisi-dati/index.html` e `private/pages/analisi-dati/js/app.js`.

Il foglio comune è `assets/site.css`: il builder lo collega dopo i CSS locali, così i colori, i caratteri e la scala tipografica BrainLab hanno la precedenza. Layout, griglie, spaziature e componenti restano invece definiti dal CSS di ciascuna pagina. I fogli CSS locali collegati nell'HTML vengono copiati in `docs/` mantenendo le sottocartelle. I CSS pubblicati sono visibili a tutti: non inserirvi informazioni riservate.

Gli script locali `.js` e `.mjs` referenziati nell'HTML vengono incorporati nella pagina prima della cifratura, quindi non vengono pubblicati come file separati. Gli script remoti restano remoti. I moduli JavaScript con import locali devono essere uniti in un singolo file prima del build. Gli altri file (PDF, immagini, JSON e così via) non vengono copiati automaticamente.

## Pubblicazione su GitHub Pages

1. Avvia `build-site.cmd` su Windows; il build cifra le pagine e fa commit e push di `docs/` e `.staticrypt.json` su `main`.
2. Non caricare mai `private/` nella repository pubblica.
3. In GitHub apri **Settings → Pages**, scegli **Deploy from a branch**, seleziona `main` e la cartella `/docs`.
4. Dopo la pubblicazione, visita `https://brainlabiulm.github.io/` e prova la password prima di condividere il link.

Se cambi password, rigenera tutte le pagine con `npm run build` e ripubblica la nuova cartella `docs/`. Le copie precedenti potrebbero restare nella cronologia Git: la password va quindi mantenuta riservata e ruotata se viene divulgata.
