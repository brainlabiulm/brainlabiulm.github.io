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

Lo script chiede la password due volte senza mostrarla, controlla che sia lunga almeno 16 caratteri e genera le pagine cifrate in `docs/`. Puoi accedere una volta e usare “Ricordami” per aprire le altre pagine dello stesso sito senza reinserirla a ogni click.

Per aggiungere pagine, copia i file `.html` dentro `private/` mantenendo la struttura delle sottocartelle e inserisci i relativi link nell'elenco di `private/index.html`. Mantieni i collegamenti relativi, per esempio `pages/analisi.html`; il percorso equivalente sarà disponibile nel sito dopo la cifratura.

I file `.css`, `.js` e `.mjs` vengono copiati in `docs/` accanto alle pagine e restano pubblici. Non inserirvi password, chiavi API, dati personali o testo che deve restare riservato. La generazione cifra ogni pagina HTML, ma ignora gli altri formati (PDF, immagini, JSON e così via) per non pubblicarli per errore. Gli eventuali riferimenti a file ignorati non funzioneranno finché non saranno gestiti in modo esplicito.

## Pubblicazione su GitHub Pages

1. Esegui `npm run build` e controlla che `docs/` contenga solo pagine cifrate.
2. Aggiungi e carica la cartella `docs/` cifrata e i file di progetto; non caricare mai `private/`.
3. In GitHub apri **Settings → Pages**, scegli **Deploy from a branch**, seleziona `main` e la cartella `/docs`.
4. Dopo la pubblicazione, visita `https://brainlabiulm.github.io/` e prova la password prima di condividere il link.

Se cambi password, rigenera tutte le pagine con `npm run build` e ripubblica la nuova cartella `docs/`. Le copie precedenti potrebbero restare nella cronologia Git: la password va quindi mantenuta riservata e ruotata se viene divulgata.
